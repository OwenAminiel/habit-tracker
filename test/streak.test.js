const test = require('node:test');
const assert = require('node:assert');
const { computeStreaks } = require('../src/utils/streak');
const { dayOfWeek } = require('../src/utils/dates');

// Calendar used below (2026): Oct 25 is a Sunday, so Oct 26 = Mon, 27 = Tue, 28 = Wed, 29 = Thu, 30 = Fri, 31 = Sat.
test('the test calendar is what the comments say it is', () => {
  assert.strictEqual(dayOfWeek('2026-10-25'), 0);
  assert.strictEqual(dayOfWeek('2026-10-28'), 3);
});

test('no entries gives zeros', () => {
  assert.deepStrictEqual(computeStreaks([], '2026-10-13'), {
    current_streak: 0, longest_streak: 0, total_completed: 0, last_completed: null, streak_unit: 'day',
  });
});

test('current streak counts back from today', () => {
  const r = computeStreaks(['2026-10-11', '2026-10-12', '2026-10-13'], '2026-10-13');
  assert.strictEqual(r.current_streak, 3);
  assert.strictEqual(r.longest_streak, 3);
});

test('streak stays alive if only yesterday is logged', () => {
  assert.strictEqual(computeStreaks(['2026-10-11', '2026-10-12'], '2026-10-13').current_streak, 2);
});

test('streak breaks after a missed day, longest is kept', () => {
  const r = computeStreaks(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10'], '2026-10-13');
  assert.strictEqual(r.current_streak, 0);
  assert.strictEqual(r.longest_streak, 3);
});

test('handles month boundaries and duplicates', () => {
  const r = computeStreaks(['2026-09-30', '2026-10-01', '2026-10-01'], '2026-10-01');
  assert.strictEqual(r.current_streak, 2);
  assert.strictEqual(r.total_completed, 2);
});

test('check-ins after "today" count toward the total but not the streak', () => {
  const r = computeStreaks(['2026-10-12', '2026-10-13', '2026-10-14'], '2026-10-13');
  assert.strictEqual(r.current_streak, 2);
  assert.strictEqual(r.total_completed, 3);
});

const mwf = (today) => ({ today, frequency: 'days', days_of_week: [1, 3, 5] });

test('chosen weekdays: a pending scheduled day does not break the streak', () => {
  // Mon and Wed done, Friday (today) not done yet
  assert.strictEqual(computeStreaks(['2026-10-26', '2026-10-28'], mwf('2026-10-30')).current_streak, 2);
});

test('chosen weekdays: unscheduled days are skipped, not missed', () => {
  // Done Mon, Wed, Fri; the Tue and Thu in between do not matter
  const r = computeStreaks(['2026-10-26', '2026-10-28', '2026-10-30'], mwf('2026-10-31'));
  assert.strictEqual(r.current_streak, 3);
  assert.strictEqual(r.longest_streak, 3);
});

test('chosen weekdays: a missed scheduled day breaks the streak', () => {
  // Wednesday missed
  const r = computeStreaks(['2026-10-26', '2026-10-30'], mwf('2026-10-30'));
  assert.strictEqual(r.current_streak, 1);
  assert.strictEqual(r.longest_streak, 1);
});

test('chosen weekdays: a bonus check-in on an off day neither extends nor breaks the streak', () => {
  // Mon, Tue (bonus), Wed
  const r = computeStreaks(['2026-10-26', '2026-10-27', '2026-10-28'], mwf('2026-10-28'));
  assert.strictEqual(r.current_streak, 2);
  assert.strictEqual(r.total_completed, 3);
});

test('chosen weekdays: starting on an off day is fine', () => {
  assert.strictEqual(computeStreaks(['2026-10-27', '2026-10-28'], mwf('2026-10-28')).current_streak, 1);
});

const weekly = (today, n = 3) => ({ today, frequency: 'weekly', times_per_week: n });

test('weekly goal: streak counts weeks that met the goal', () => {
  // Weeks starting Oct 11 and Oct 18 each have 3 check-ins; this week (Oct 25) has 1 so far
  const dates = ['2026-10-11', '2026-10-13', '2026-10-15', '2026-10-18', '2026-10-20', '2026-10-22', '2026-10-26'];
  const r = computeStreaks(dates, weekly('2026-10-28'));
  assert.strictEqual(r.current_streak, 2);
  assert.strictEqual(r.longest_streak, 2);
  assert.strictEqual(r.streak_unit, 'week');
});

test('weekly goal: meeting the goal this week extends the streak', () => {
  const dates = ['2026-10-18', '2026-10-20', '2026-10-22', '2026-10-25', '2026-10-26', '2026-10-27'];
  assert.strictEqual(computeStreaks(dates, weekly('2026-10-28')).current_streak, 2);
});

test('weekly goal: a finished week below the goal breaks the streak', () => {
  // Week of Oct 11 met; week of Oct 18 only 2 of 3; this week empty
  const dates = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-19', '2026-10-20'];
  const r = computeStreaks(dates, weekly('2026-10-28'));
  assert.strictEqual(r.current_streak, 0);
  assert.strictEqual(r.longest_streak, 1);
});

test('weekly goal: weeks run Sunday to Saturday', () => {
  // Saturday Oct 24 and Sunday Oct 25 are in different weeks, so neither week has 2
  const r = computeStreaks(['2026-10-24', '2026-10-25'], weekly('2026-10-31', 2));
  assert.strictEqual(r.longest_streak, 0);
});

test('weekly goal of 1 behaves like "at least once a week"', () => {
  const r = computeStreaks(['2026-10-12', '2026-10-21'], weekly('2026-10-28', 1));
  assert.strictEqual(r.current_streak, 2); // weeks of Oct 11 and Oct 18 met, this week still pending
  assert.strictEqual(r.longest_streak, 2);
});

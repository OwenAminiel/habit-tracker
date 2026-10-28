const test = require('node:test');
const assert = require('node:assert');
const { habitStats, completionRate } = require('../src/utils/stats');

const habit = (extra = {}) => ({
  id: 1, frequency: 'daily', days_of_week: null, times_per_week: null, created_at: '2026-10-01T12:00:00Z', ...extra,
});
const TODAY = '2026-10-28'; // a Wednesday

test('completion rate: share of expected days done, with today counting only once done', () => {
  // Done every day Oct 22-28 except Oct 25
  const done = new Set(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-26', '2026-10-27', '2026-10-28']);
  assert.strictEqual(completionRate(habit(), done, '2026-10-01', TODAY, 7), 86); // 6 of 7
  done.delete('2026-10-28');
  assert.strictEqual(completionRate(habit(), done, '2026-10-01', TODAY, 7), 83); // 5 of the 6 days before today
});

test('completion rate: null when nothing has been expected yet', () => {
  assert.strictEqual(completionRate(habit(), new Set(), TODAY, TODAY, 30), null);
});

test('completion rate: a new habit is not penalised for days before it started', () => {
  const done = new Set(['2026-10-27', '2026-10-28']);
  assert.strictEqual(completionRate(habit(), done, '2026-10-27', TODAY, 30), 100);
});

test('completion rate: chosen weekdays only count the scheduled days', () => {
  const mwf = habit({ frequency: 'days', days_of_week: [1, 3, 5] });
  // Oct 22-28 has Fri 23, Mon 26, Wed 28 scheduled; two done
  const done = new Set(['2026-10-23', '2026-10-26']);
  // Today (Wed) is scheduled but not done, so it is not counted yet: 2 of 2
  assert.strictEqual(completionRate(mwf, done, '2026-10-01', TODAY, 7), 100);
  done.add('2026-10-24'); // an off-day bonus does not change the rate
  assert.strictEqual(completionRate(mwf, done, '2026-10-01', TODAY, 7), 100);
});

test('completion rate: weekly goals scale the goal to the window and cap at 100', () => {
  const three = habit({ frequency: 'weekly', times_per_week: 3 });
  const done = new Set(['2026-10-23', '2026-10-25', '2026-10-27']);
  assert.strictEqual(completionRate(three, done, '2026-10-01', TODAY, 7), 100);
  const more = new Set([...done, '2026-10-22', '2026-10-24', '2026-10-26']);
  assert.strictEqual(completionRate(three, more, '2026-10-01', TODAY, 7), 100);
  assert.strictEqual(completionRate(three, new Set(['2026-10-27']), '2026-10-01', TODAY, 7), 33);
});

test('habitStats: weekday counts, 8-week history and milestones', () => {
  const dates = ['2026-10-26', '2026-10-27', '2026-10-28']; // Mon, Tue, Wed
  const s = habitStats(habit(), dates, TODAY);
  assert.strictEqual(s.by_weekday.length, 7);
  assert.deepStrictEqual(s.by_weekday.map((d) => d.completed), [0, 1, 1, 1, 0, 0, 0]);
  assert.strictEqual(s.weekly_history.length, 8);
  const current = s.weekly_history[7];
  assert.strictEqual(current.current, true);
  assert.strictEqual(current.week_start, '2026-10-25');
  assert.strictEqual(current.completed, 3);
  assert.strictEqual(current.goal, 7);
  assert.strictEqual(current.met, false);
  assert.strictEqual(s.weekly_history[0].week_start, '2026-09-06');
  const by = Object.fromEntries(s.milestones.map((m) => [m.key, m.achieved]));
  assert.strictEqual(by['total-1'], true);
  assert.strictEqual(by['streak-3'], true);
  assert.strictEqual(by['streak-7'], false);
  assert.strictEqual(by['total-10'], false);
});

test('habitStats: goals differ by schedule and milestones use weeks for weekly habits', () => {
  assert.strictEqual(habitStats(habit({ frequency: 'days', days_of_week: [1, 3, 5] }), [], TODAY).weekly_history[7].goal, 3);
  const w = habitStats(habit({ frequency: 'weekly', times_per_week: 4 }), [], TODAY);
  assert.strictEqual(w.weekly_history[7].goal, 4);
  assert.ok(w.milestones.some((m) => m.label === '2-week streak'));
  assert.ok(!w.milestones.some((m) => m.label === '3-day streak'));
});

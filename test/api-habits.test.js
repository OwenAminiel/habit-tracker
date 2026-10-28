const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { skipReason, start, stop, call, newUser, newHabit, checkIn } = require('../test-utils/api');
const { utcToday, addDays, weekStart, dayOfWeek } = require('../src/utils/dates');

const get = (user, path) => call('GET', path, { token: user.token });
const fieldsOf = (res) => (res.body.error.details || []).map((d) => d.field);

describe('Habit schedules, lists, archive, stats and export', { skip: skipReason }, () => {
  before(start);
  after(stop);

  it('uses a calendar where 2026-03-02 is a Monday (the dates below depend on it)', () => {
    assert.strictEqual(dayOfWeek('2026-03-02'), 1);
    assert.strictEqual(dayOfWeek('2026-03-06'), 5);
  });

  describe('schedules', () => {
    it('defaults to a daily habit', async () => {
      const user = await newUser();
      const habit = await newHabit(user, 'Daily');
      assert.strictEqual(habit.frequency, 'daily');
      assert.strictEqual(habit.days_of_week, null);
      assert.strictEqual(habit.times_per_week, null);
      assert.strictEqual(habit.archived, false);
      assert.strictEqual('user_id' in habit, false, 'internal ids are not exposed');
    });

    it('stores chosen weekdays sorted and without duplicates', async () => {
      const user = await newUser();
      const habit = await newHabit(user, { name: 'Gym', frequency: 'days', days_of_week: [5, 1, 3, 1] });
      assert.deepStrictEqual(habit.days_of_week, [1, 3, 5]);
      assert.strictEqual(habit.times_per_week, null);
    });

    it('stores a weekly goal', async () => {
      const user = await newUser();
      const habit = await newHabit(user, { name: 'Run', frequency: 'weekly', times_per_week: 3 });
      assert.strictEqual(habit.times_per_week, 3);
      assert.strictEqual(habit.days_of_week, null);
    });

    it('rejects incomplete or impossible schedules with the field named', async () => {
      const user = await newUser();
      const post = (body) => call('POST', '/api/habits', { token: user.token, body });
      const noDays = await post({ name: 'x', frequency: 'days' });
      assert.strictEqual(noDays.status, 400);
      assert.deepStrictEqual(fieldsOf(noDays), ['days_of_week']);
      assert.strictEqual((await post({ name: 'x', frequency: 'days', days_of_week: [] })).status, 400);
      assert.strictEqual((await post({ name: 'x', frequency: 'days', days_of_week: [7] })).status, 400);
      assert.strictEqual((await post({ name: 'x', frequency: 'days', days_of_week: ['mon'] })).status, 400);
      const noTimes = await post({ name: 'x', frequency: 'weekly' });
      assert.deepStrictEqual(fieldsOf(noTimes), ['times_per_week']);
      assert.strictEqual((await post({ name: 'x', frequency: 'weekly', times_per_week: 0 })).status, 400);
      assert.strictEqual((await post({ name: 'x', frequency: 'weekly', times_per_week: 8 })).status, 400);
      assert.strictEqual((await post({ name: 'x', frequency: 'weekly', times_per_week: 2.5 })).status, 400);
      assert.strictEqual((await post({ name: 'x', frequency: 'monthly' })).status, 400);
    });

    it('ignores schedule details that do not apply to the chosen frequency', async () => {
      const user = await newUser();
      const habit = await newHabit(user, { name: 'Daily', frequency: 'daily', days_of_week: [1], times_per_week: 4 });
      assert.strictEqual(habit.days_of_week, null);
      assert.strictEqual(habit.times_per_week, null);
    });

    it('lets a habit change schedule, and keeps the schedule when only the name changes', async () => {
      const user = await newUser();
      const habit = await newHabit(user, { name: 'Gym', frequency: 'days', days_of_week: [1, 3] });
      const renamed = await call('PUT', `/api/habits/${habit.id}`, { token: user.token, body: { name: 'Gym time' } });
      assert.deepStrictEqual(renamed.body.habit.days_of_week, [1, 3]);

      const needsTimes = await call('PUT', `/api/habits/${habit.id}`, { token: user.token, body: { frequency: 'weekly' } });
      assert.strictEqual(needsTimes.status, 400);
      assert.deepStrictEqual(fieldsOf(needsTimes), ['times_per_week']);

      const weekly = await call('PUT', `/api/habits/${habit.id}`, { token: user.token, body: { frequency: 'weekly', times_per_week: 2 } });
      assert.strictEqual(weekly.status, 200);
      assert.strictEqual(weekly.body.habit.days_of_week, null);
      assert.strictEqual(weekly.body.habit.times_per_week, 2);

      const daily = await call('PUT', `/api/habits/${habit.id}`, { token: user.token, body: { frequency: 'daily' } });
      assert.strictEqual(daily.body.habit.times_per_week, null);
    });

    it('computes streaks according to the schedule', async () => {
      const user = await newUser();
      const mwf = await newHabit(user, { name: 'MWF', frequency: 'days', days_of_week: [1, 3, 5] });
      await checkIn(user, mwf, '2026-03-02'); // Mon
      await checkIn(user, mwf, '2026-03-04'); // Wed
      const pending = await get(user, `/api/habits/${mwf.id}/streak?today=2026-03-06`); // Fri, not done yet
      assert.strictEqual(pending.body.current_streak, 2);
      assert.strictEqual(pending.body.streak_unit, 'day');
      const missed = await get(user, `/api/habits/${mwf.id}/streak?today=2026-03-07`); // Sat: Friday was missed
      assert.strictEqual(missed.body.current_streak, 0);
      assert.strictEqual(missed.body.longest_streak, 2);

      const weekly = await newHabit(user, { name: 'Weekly', frequency: 'weekly', times_per_week: 2 });
      for (const d of ['2026-02-23', '2026-02-25', '2026-03-02', '2026-03-03']) await checkIn(user, weekly, d);
      const w = await get(user, `/api/habits/${weekly.id}/streak?today=2026-03-04`);
      assert.strictEqual(w.body.streak_unit, 'week');
      assert.strictEqual(w.body.current_streak, 2);
    });
  });

  describe('listing habits', () => {
    it('paginates with a total and page count', async () => {
      const user = await newUser();
      for (const n of [1, 2, 3, 4, 5]) await newHabit(user, `Habit ${n}`);
      const page2 = await get(user, '/api/habits?limit=2&page=2&sort=name&order=asc');
      assert.deepStrictEqual(page2.body.habits.map((h) => h.name), ['Habit 3', 'Habit 4']);
      assert.deepStrictEqual(page2.body.pagination, { page: 2, limit: 2, total: 5, total_pages: 3 });
      const beyond = await get(user, '/api/habits?limit=2&page=9');
      assert.strictEqual(beyond.status, 200);
      assert.deepStrictEqual(beyond.body.habits, []);
      assert.strictEqual(beyond.body.pagination.total, 5);
    });

    it('validates page, limit, sort and filters', async () => {
      const user = await newUser();
      for (const q of ['page=0', 'page=abc', 'limit=0', 'limit=101', 'sort=password', 'order=sideways', 'archived=maybe', 'frequency=hourly']) {
        const res = await get(user, `/api/habits?${q}`);
        assert.strictEqual(res.status, 400, q);
      }
    });

    it('sorts by name without regard to case', async () => {
      const user = await newUser();
      for (const n of ['banana', 'Apple', 'cherry']) await newHabit(user, n);
      const asc = await get(user, '/api/habits?sort=name&order=asc');
      assert.deepStrictEqual(asc.body.habits.map((h) => h.name), ['Apple', 'banana', 'cherry']);
      const desc = await get(user, '/api/habits?sort=name&order=desc');
      assert.deepStrictEqual(desc.body.habits.map((h) => h.name), ['cherry', 'banana', 'Apple']);
    });

    it('searches names and descriptions, and treats % and _ literally', async () => {
      const user = await newUser();
      await newHabit(user, { name: 'Read a book', description: 'before bed' });
      await newHabit(user, { name: 'Stretch', description: 'READ a magazine too' });
      await newHabit(user, { name: 'Drink 100% water' });
      await newHabit(user, { name: 'snake_case' });
      await newHabit(user, { name: 'Plain' });
      const read = await get(user, '/api/habits?q=read&sort=name&order=asc');
      assert.deepStrictEqual(read.body.habits.map((h) => h.name), ['Read a book', 'Stretch']);
      assert.strictEqual((await get(user, '/api/habits?q=%25')).body.habits.length, 1, '% is not a wildcard');
      assert.strictEqual((await get(user, '/api/habits?q=_')).body.habits.length, 1, '_ is not a wildcard');
      assert.strictEqual((await get(user, '/api/habits?q=zzz')).body.habits.length, 0);
    });

    it('filters by frequency', async () => {
      const user = await newUser();
      await newHabit(user, 'Daily one');
      await newHabit(user, { name: 'Weekly one', frequency: 'weekly', times_per_week: 2 });
      const weekly = await get(user, '/api/habits?frequency=weekly');
      assert.deepStrictEqual(weekly.body.habits.map((h) => h.name), ['Weekly one']);
    });
  });

  describe('archiving', () => {
    it('hides archived habits by default, and can restore them', async () => {
      const user = await newUser();
      const keep = await newHabit(user, 'Keep');
      const old = await newHabit(user, 'Old');

      const archived = await call('POST', `/api/habits/${old.id}/archive`, { token: user.token });
      assert.strictEqual(archived.status, 200);
      assert.strictEqual(archived.body.habit.archived, true);
      assert.ok(archived.body.habit.archived_at);

      assert.deepStrictEqual((await get(user, '/api/habits')).body.habits.map((h) => h.name), ['Keep']);
      assert.deepStrictEqual((await get(user, '/api/habits?archived=true')).body.habits.map((h) => h.name), ['Old']);
      assert.strictEqual((await get(user, '/api/habits?archived=all')).body.habits.length, 2);
      assert.deepStrictEqual((await get(user, '/api/habits/summary')).body.habits.map((h) => h.name), ['Keep']);
      assert.strictEqual((await get(user, `/api/habits/${old.id}`)).body.habit.archived, true, 'still readable by id');

      const restored = await call('POST', `/api/habits/${old.id}/restore`, { token: user.token });
      assert.strictEqual(restored.body.habit.archived, false);
      assert.strictEqual(restored.body.habit.archived_at, null);
      assert.strictEqual((await get(user, '/api/habits')).body.habits.length, 2);
      assert.ok(keep.id);
    });

    it('is safe to repeat and keeps the original archive time', async () => {
      const user = await newUser();
      const habit = await newHabit(user);
      const first = await call('POST', `/api/habits/${habit.id}/archive`, { token: user.token });
      const second = await call('POST', `/api/habits/${habit.id}/archive`, { token: user.token });
      assert.strictEqual(second.status, 200);
      assert.strictEqual(second.body.habit.archived_at, first.body.habit.archived_at);
      assert.strictEqual((await call('POST', `/api/habits/${habit.id}/restore`, { token: user.token })).status, 200);
      assert.strictEqual((await call('POST', `/api/habits/${habit.id}/restore`, { token: user.token })).status, 200);
    });

    it('blocks check-ins while archived but keeps the history', async () => {
      const user = await newUser();
      const habit = await newHabit(user);
      await checkIn(user, habit, '2026-03-02');
      await call('POST', `/api/habits/${habit.id}/archive`, { token: user.token });
      assert.strictEqual((await checkIn(user, habit, '2026-03-03')).status, 409);
      assert.strictEqual((await call('DELETE', `/api/habits/${habit.id}/entries/2026-03-02`, { token: user.token })).status, 409);
      assert.strictEqual((await get(user, `/api/habits/${habit.id}/entries`)).body.entries.length, 1);
      await call('POST', `/api/habits/${habit.id}/restore`, { token: user.token });
      assert.strictEqual((await checkIn(user, habit, '2026-03-03')).status, 201);
    });

    it('only works on your own habits', async () => {
      const a = await newUser();
      const b = await newUser();
      const habit = await newHabit(a);
      assert.strictEqual((await call('POST', `/api/habits/${habit.id}/archive`, { token: b.token })).status, 404);
      assert.strictEqual((await call('POST', `/api/habits/${habit.id}/restore`, { token: b.token })).status, 404);
    });
  });

  describe('entries', () => {
    it('paginates, orders and filters the history', async () => {
      const user = await newUser();
      const habit = await newHabit(user);
      for (const d of ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']) await checkIn(user, habit, d);
      await checkIn(user, habit, '2026-03-06', { completed: false });

      const page = await get(user, `/api/habits/${habit.id}/entries?order=asc&limit=2&page=2`);
      assert.deepStrictEqual(page.body.entries.map((e) => e.entry_date), ['2026-03-03', '2026-03-04']);
      assert.deepStrictEqual(page.body.pagination, { page: 2, limit: 2, total: 6, total_pages: 3 });

      const notDone = await get(user, `/api/habits/${habit.id}/entries?completed=false`);
      assert.deepStrictEqual(notDone.body.entries.map((e) => e.entry_date), ['2026-03-06']);
      const done = await get(user, `/api/habits/${habit.id}/entries?completed=true`);
      assert.strictEqual(done.body.pagination.total, 5);
    });

    it('rejects a backwards date range and bad paging', async () => {
      const user = await newUser();
      const habit = await newHabit(user);
      for (const q of ['from=2026-03-05&to=2026-03-01', 'limit=501', 'page=0', 'completed=maybe', 'order=up']) {
        assert.strictEqual((await get(user, `/api/habits/${habit.id}/entries?${q}`)).status, 400, q);
      }
    });
  });

  describe('summary for the dashboard', () => {
    it('reports required days, weekly progress and 14 days of history', async () => {
      const user = await newUser();
      const gym = await newHabit(user, { name: 'Gym', frequency: 'days', days_of_week: [1, 3, 5] });
      const run = await newHabit(user, { name: 'Run', frequency: 'weekly', times_per_week: 3 });
      await checkIn(user, gym, '2026-03-02');
      await checkIn(user, run, '2026-03-02');
      await checkIn(user, run, '2026-03-03');

      const wed = (await get(user, '/api/habits/summary?today=2026-03-04')).body;
      const [g, r] = wed.habits;
      assert.strictEqual(wed.today, '2026-03-04');
      assert.strictEqual(g.required_today, true);
      assert.strictEqual(r.required_today, false, 'weekly goals have no required days');
      assert.strictEqual(g.completed_today, false);
      assert.strictEqual(g.recent.length, 14);
      assert.strictEqual(g.recent[13].date, '2026-03-04');
      assert.strictEqual(g.recent[0].date, '2026-02-19');
      assert.deepStrictEqual(g.recent.slice(-4).map((d) => [d.date, d.required, d.completed]), [
        ['2026-03-01', false, false],
        ['2026-03-02', true, true],
        ['2026-03-03', false, false],
        ['2026-03-04', true, false],
      ]);
      assert.strictEqual(g.current_streak, 1);
      assert.strictEqual(r.week_goal, 3);
      assert.strictEqual(r.week_count, 2);
      assert.strictEqual(g.week_goal, null);
      assert.strictEqual(r.streak_unit, 'week');

      const thu = (await get(user, '/api/habits/summary?today=2026-03-05')).body;
      assert.strictEqual(thu.habits[0].required_today, false);
    });
  });

  describe('per-habit stats', () => {
    it('returns rates, weekday counts, weekly history and milestones', async () => {
      const user = await newUser();
      const habit = await newHabit(user, 'Stats');
      for (const d of ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']) await checkIn(user, habit, d);
      const res = await get(user, `/api/habits/${habit.id}/stats?today=2026-03-07`);
      assert.strictEqual(res.status, 200);
      const s = res.body;
      assert.strictEqual(s.current_streak, 0, 'Friday and Saturday are missed');
      assert.strictEqual(s.longest_streak, 5);
      assert.strictEqual(s.total_completed, 5);
      assert.strictEqual(s.started_on, '2026-03-01');
      assert.deepStrictEqual(s.completion_rate, { days_7: 83, days_30: 83, days_90: 83 }); // 5 of 6 days: today (Mar 7) is still in progress
      assert.deepStrictEqual(s.by_weekday.map((d) => d.completed), [1, 1, 1, 1, 1, 0, 0]);
      assert.strictEqual(s.weekly_history.length, 8);
      assert.deepStrictEqual(s.weekly_history[7], { week_start: '2026-03-01', completed: 5, goal: 7, met: false, current: true });
      const by = Object.fromEntries(s.milestones.map((m) => [m.key, m.achieved]));
      assert.strictEqual(by['streak-3'], true);
      assert.strictEqual(by['streak-7'], false);
      assert.strictEqual(by['total-1'], true);
    });

    it('validates the today parameter and only shows your own habits', async () => {
      const a = await newUser();
      const b = await newUser();
      const habit = await newHabit(a);
      assert.strictEqual((await get(a, `/api/habits/${habit.id}/stats?today=nope`)).status, 400);
      assert.strictEqual((await get(b, `/api/habits/${habit.id}/stats`)).status, 404);
    });
  });

  describe('overview', () => {
    it('summarises all active habits', async () => {
      const user = await newUser();
      const a = await newHabit(user, 'Alpha');
      const b = await newHabit(user, 'Beta');
      const today = utcToday();
      await checkIn(user, a, today);
      await checkIn(user, a, addDays(today, -1));

      const res = await get(user, '/api/stats/overview');
      assert.strictEqual(res.status, 200);
      const o = res.body;
      assert.strictEqual(o.today, today);
      assert.strictEqual(o.active_habits, 2);
      assert.strictEqual(o.archived_habits, 0);
      assert.strictEqual(o.checked_in_today, 1);
      assert.strictEqual(o.total_checkins, 2);
      assert.strictEqual(o.best_current_streak.name, 'Alpha');
      assert.strictEqual(o.best_current_streak.streak, 2);
      assert.strictEqual(o.by_weekday.reduce((n, d) => n + d.completed, 0), 2);
      assert.strictEqual(o.activity.length, 77 + dayOfWeek(today) + 1);
      assert.strictEqual(o.activity[o.activity.length - 1].date, today);
      assert.strictEqual(o.activity[o.activity.length - 1].count, 1);
      assert.strictEqual(o.activity[0].date, addDays(weekStart(today), -77));
      assert.deepStrictEqual(o.habits.map((h) => h.name), ['Alpha', 'Beta'], 'best completion rate first');
      assert.ok(o.completion_rate.days_30 >= 0);

      await call('POST', `/api/habits/${b.id}/archive`, { token: user.token });
      const after = (await get(user, '/api/stats/overview')).body;
      assert.strictEqual(after.active_habits, 1);
      assert.strictEqual(after.archived_habits, 1);
    });

    it('is empty and valid for a new user', async () => {
      const user = await newUser();
      const o = (await get(user, '/api/stats/overview')).body;
      assert.strictEqual(o.active_habits, 0);
      assert.strictEqual(o.best_current_streak, null);
      assert.strictEqual(o.completion_rate.days_30, null);
      assert.deepStrictEqual(o.habits, []);
    });

    it('requires login and only counts your own data', async () => {
      const a = await newUser();
      const b = await newUser();
      await checkIn(a, await newHabit(a), utcToday());
      assert.strictEqual((await call('GET', '/api/stats/overview')).status, 401);
      assert.strictEqual((await get(b, '/api/stats/overview')).body.total_checkins, 0);
    });
  });

  describe('export', () => {
    it('exports everything as JSON, including archived habits', async () => {
      const user = await newUser();
      const a = await newHabit(user, 'Active');
      const b = await newHabit(user, { name: 'Old', frequency: 'weekly', times_per_week: 2 });
      await checkIn(user, a, '2026-03-02', { note: 'first' });
      await checkIn(user, a, '2026-03-03');
      await call('POST', `/api/habits/${b.id}/archive`, { token: user.token });

      const res = await get(user, '/api/export');
      assert.strictEqual(res.status, 200);
      assert.match(res.type, /application\/json/);
      const disposition = (await fetch(require('../test-utils/api').getBase() + '/api/export', { headers: { Authorization: `Bearer ${user.token}` } })).headers.get('content-disposition');
      assert.match(disposition, /attachment; filename="habit-tracker-\d{4}-\d{2}-\d{2}\.json"/);
      assert.strictEqual(res.body.user.email, user.email);
      assert.strictEqual(res.body.habits.length, 2);
      assert.deepStrictEqual(res.body.habits[0].entries, [
        { entry_date: '2026-03-02', completed: true, note: 'first' },
        { entry_date: '2026-03-03', completed: true, note: '' },
      ]);
      assert.strictEqual(res.body.habits[1].archived, true);
      assert.strictEqual(res.body.habits[1].times_per_week, 2);
    });

    it('exports CSV that is safe to open in a spreadsheet', async () => {
      const user = await newUser();
      const a = await newHabit(user, 'Read, write');
      await newHabit(user, 'No entries yet');
      await checkIn(user, a, '2026-03-01', { note: 'said "hi", then left' });
      await checkIn(user, a, '2026-03-02', { note: '=SUM(A1)' });
      await checkIn(user, a, '2026-03-03', { note: 'line one\nline two' });
      await checkIn(user, a, '2026-03-04', { note: '-1 and +2' });

      const res = await get(user, '/api/export?format=csv');
      assert.strictEqual(res.status, 200);
      assert.match(res.type, /text\/csv/);
      const lines = res.text.split('\r\n');
      assert.strictEqual(lines[0], 'habit,frequency,archived,entry_date,completed,note');
      assert.ok(res.text.includes('"Read, write",daily,false,2026-03-01,true,"said ""hi"", then left"'));
      assert.ok(res.text.includes('"Read, write",daily,false,2026-03-02,true,\'=SUM(A1)'), 'formulas are defused');
      assert.ok(res.text.includes('2026-03-03,true,"line one\nline two"'));
      assert.ok(res.text.includes("2026-03-04,true,'-1 and +2"));
      assert.ok(res.text.includes('No entries yet,daily,false,,,'), 'habits without entries still appear');
    });

    it('validates the format, requires login, and never includes other users', async () => {
      const a = await newUser();
      const b = await newUser();
      await newHabit(a, 'Private');
      assert.strictEqual((await get(a, '/api/export?format=xml')).status, 400);
      assert.strictEqual((await call('GET', '/api/export')).status, 401);
      assert.strictEqual((await get(b, '/api/export')).body.habits.length, 0);
      assert.ok(!(await get(b, '/api/export?format=csv')).text.includes('Private'));
    });
  });
});

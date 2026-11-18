const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { skipReason, start, stop, call, newUser, newHabit, checkIn } = require('../test-utils/api');

const get = (user, path) => call('GET', path, { token: user.token });
const fieldsOf = (res) => (res.body.error.details || []).map((d) => d.field);

describe('Numeric goals', { skip: skipReason }, () => {
  before(start);
  after(stop);

  it('habits have no target by default', async () => {
    const user = await newUser();
    const habit = await newHabit(user, 'Plain');
    assert.strictEqual(habit.target, null);
    assert.strictEqual(habit.unit, null);
  });

  it('stores a target and unit, and validates them', async () => {
    const user = await newUser();
    const water = await newHabit(user, { name: 'Water', target: 8, unit: '  glasses ' });
    assert.strictEqual(water.target, 8);
    assert.strictEqual(water.unit, 'glasses');

    const post = (body) => call('POST', '/api/habits', { token: user.token, body: { name: 'x', ...body } });
    assert.strictEqual((await post({ target: 0 })).status, 400);
    assert.strictEqual((await post({ target: -3 })).status, 400);
    assert.strictEqual((await post({ target: '8' })).status, 400);
    assert.strictEqual((await post({ target: 2000000 })).status, 400);
    assert.strictEqual((await post({ target: 5, unit: 'u'.repeat(21) })).status, 400);
    assert.deepStrictEqual(fieldsOf(await post({ target: 0 })), ['target']);
    assert.strictEqual((await post({ target: 2.5, unit: 'litres' })).body.habit.target, 2.5);
  });

  it('ignores a unit when there is no target, and clears both together', async () => {
    const user = await newUser();
    assert.strictEqual((await call('POST', '/api/habits', { token: user.token, body: { name: 'x', unit: 'km' } })).body.habit.unit, null);
    const habit = await newHabit(user, { name: 'Walk', target: 5, unit: 'km' });
    const put = (body) => call('PUT', `/api/habits/${habit.id}`, { token: user.token, body });
    assert.strictEqual((await put({ name: 'Walk more' })).body.habit.unit, 'km', 'untouched when not sent');
    const cleared = (await put({ target: null })).body.habit;
    assert.strictEqual(cleared.target, null);
    assert.strictEqual(cleared.unit, null);
  });

  it('decides "completed" from the amount logged', async () => {
    const user = await newUser();
    const water = await newHabit(user, { name: 'Water', target: 8, unit: 'glasses' });
    const log = (value, date) => call('POST', `/api/habits/${water.id}/entries`, { token: user.token, body: { entry_date: date, value } });

    const partial = await log(3, '2026-03-02');
    assert.strictEqual(partial.status, 201);
    assert.strictEqual(partial.body.entry.completed, false);
    assert.strictEqual(partial.body.entry.value, 3);

    const reached = await log(8, '2026-03-02'); // same day, updated
    assert.strictEqual(reached.status, 200);
    assert.strictEqual(reached.body.entry.completed, true);

    assert.strictEqual((await log(11.5, '2026-03-03')).body.entry.completed, true, 'going over still counts');
    assert.strictEqual((await log(0, '2026-03-04')).body.entry.completed, false);
    assert.strictEqual((await log(-1, '2026-03-05')).status, 400);
    assert.strictEqual((await log('lots', '2026-03-05')).status, 400);
  });

  it('counts a plain check-in as reaching the target, and ignores "completed: true" with a smaller value', async () => {
    const user = await newUser();
    const water = await newHabit(user, { name: 'Water', target: 8 });
    const quick = await checkIn(user, water, '2026-03-02');
    assert.strictEqual(quick.body.entry.value, 8);
    assert.strictEqual(quick.body.entry.completed, true);
    const liar = await checkIn(user, water, '2026-03-03', { value: 2, completed: true });
    assert.strictEqual(liar.body.entry.completed, false, 'the amount wins');
    const undone = await checkIn(user, water, '2026-03-02', { completed: false });
    assert.strictEqual(undone.body.entry.completed, false);
    assert.strictEqual(undone.body.entry.value, null);
  });

  it('refuses a value for a habit without a target', async () => {
    const user = await newUser();
    const plain = await newHabit(user, 'Plain');
    const res = await checkIn(user, plain, '2026-03-02', { value: 5 });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(fieldsOf(res), ['value']);
  });

  it('feeds streaks and the dashboard from the amounts', async () => {
    const user = await newUser();
    const water = await newHabit(user, { name: 'Water', target: 8, unit: 'glasses' });
    await checkIn(user, water, '2026-03-02', { value: 8 });
    await checkIn(user, water, '2026-03-03', { value: 9 });
    await checkIn(user, water, '2026-03-04', { value: 4 });
    const streak = (await get(user, `/api/habits/${water.id}/streak?today=2026-03-05`)).body;
    assert.strictEqual(streak.current_streak, 0, 'a partial day does not extend the streak');
    assert.strictEqual(streak.longest_streak, 2);

    const summary = (await get(user, '/api/habits/summary?today=2026-03-04')).body.habits[0];
    assert.strictEqual(summary.value_today, 4);
    assert.strictEqual(summary.completed_today, false);
    assert.strictEqual(summary.target, 8);
    assert.strictEqual(summary.unit, 'glasses');
    assert.strictEqual((await get(user, '/api/habits/summary?today=2026-03-06')).body.habits[0].value_today, null);
  });

  it('re-judges logged amounts when the target changes', async () => {
    const user = await newUser();
    const run = await newHabit(user, { name: 'Run', target: 5, unit: 'km' });
    await checkIn(user, run, '2026-03-02', { value: 5 });
    await checkIn(user, run, '2026-03-03', { value: 3 });
    const put = (target) => call('PUT', `/api/habits/${run.id}`, { token: user.token, body: { target } });
    const done = async () => (await get(user, `/api/habits/${run.id}/entries?order=asc`)).body.entries.map((e) => e.completed);

    assert.deepStrictEqual(await done(), [true, false]);
    await put(3);
    assert.deepStrictEqual(await done(), [true, true], 'an easier goal makes 3 km count');
    await put(10);
    assert.deepStrictEqual(await done(), [false, false], 'a harder goal does not');
  });

  it('appears in exports', async () => {
    const user = await newUser();
    const water = await newHabit(user, { name: 'Water', target: 8, unit: 'glasses', category: 'Health' });
    await checkIn(user, water, '2026-03-02', { value: 6 });
    const json = (await get(user, '/api/export')).body.habits[0];
    assert.strictEqual(json.target, 8);
    assert.deepStrictEqual(json.entries[0], { entry_date: '2026-03-02', completed: false, note: '', value: 6 });
    const csv = (await get(user, '/api/export?format=csv')).text;
    assert.ok(csv.includes('Water,daily,false,2026-03-02,false,,Health,6,8,glasses'), csv);
  });
});

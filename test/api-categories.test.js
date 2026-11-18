const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { skipReason, start, stop, call, newUser, newHabit, checkIn } = require('../test-utils/api');
const { utcToday } = require('../src/utils/dates');

const get = (user, path) => call('GET', path, { token: user.token });

describe('Categories', { skip: skipReason }, () => {
  before(start);
  after(stop);

  it('habits have no category by default', async () => {
    const user = await newUser();
    const habit = await newHabit(user, 'Plain');
    assert.strictEqual(habit.category, null);
  });

  it('stores a trimmed category and lets it be changed and cleared', async () => {
    const user = await newUser();
    const habit = await newHabit(user, { name: 'Run', category: '  Health  ' });
    assert.strictEqual(habit.category, 'Health');

    const put = (body) => call('PUT', `/api/habits/${habit.id}`, { token: user.token, body });
    assert.strictEqual((await put({ category: 'Fitness' })).body.habit.category, 'Fitness');
    assert.strictEqual((await put({ name: 'Run daily' })).body.habit.category, 'Fitness', 'untouched when not sent');
    assert.strictEqual((await put({ category: '   ' })).body.habit.category, null, 'blank clears it');
    assert.strictEqual((await put({ category: 'Fitness' })).status, 200);
    assert.strictEqual((await put({ category: null })).body.habit.category, null);
  });

  it('rejects a category longer than 30 characters', async () => {
    const user = await newUser();
    const res = await call('POST', '/api/habits', { token: user.token, body: { name: 'x', category: 'y'.repeat(31) } });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.details[0].field, 'category');
  });

  it('reuses the existing spelling so a label never splits in two', async () => {
    const user = await newUser();
    await newHabit(user, { name: 'A', category: 'Health' });
    const b = await newHabit(user, { name: 'B', category: 'health' });
    assert.strictEqual(b.category, 'Health');
    const cats = (await get(user, '/api/habits/categories')).body.categories;
    assert.deepStrictEqual(cats, [{ name: 'Health', habits: 2 }]);
  });

  it('lists categories alphabetically, only for active habits, only for you', async () => {
    const user = await newUser();
    const other = await newUser();
    await newHabit(other, { name: 'Theirs', category: 'Secret' });
    await newHabit(user, { name: 'A', category: 'Study' });
    await newHabit(user, { name: 'B', category: 'health' });
    const gone = await newHabit(user, { name: 'C', category: 'Old' });
    await call('POST', `/api/habits/${gone.id}/archive`, { token: user.token });
    await newHabit(user, 'No category');

    const cats = (await get(user, '/api/habits/categories')).body.categories;
    assert.deepStrictEqual(cats.map((c) => c.name), ['health', 'Study']);
    assert.strictEqual((await call('GET', '/api/habits/categories')).status, 401);
  });

  it('filters the list by category without regard to case', async () => {
    const user = await newUser();
    await newHabit(user, { name: 'A', category: 'Health' });
    await newHabit(user, { name: 'B', category: 'Study' });
    await newHabit(user, 'C');
    const res = await get(user, '/api/habits?category=HEALTH');
    assert.deepStrictEqual(res.body.habits.map((h) => h.name), ['A']);
    assert.strictEqual((await get(user, '/api/habits?category=')).status, 400);
  });

  it('appears on the dashboard summary and in exports', async () => {
    const user = await newUser();
    await newHabit(user, { name: 'A', category: 'Health' });
    assert.strictEqual((await get(user, '/api/habits/summary')).body.habits[0].category, 'Health');
    assert.strictEqual((await get(user, '/api/export')).body.habits[0].category, 'Health');
  });

  it('adds a per-category breakdown to the overview', async () => {
    const user = await newUser();
    const a = await newHabit(user, { name: 'A', category: 'Health' });
    await newHabit(user, { name: 'B', category: 'Study' });
    await newHabit(user, 'C');
    await checkIn(user, a, utcToday());
    const o = (await get(user, '/api/stats/overview')).body;
    assert.deepStrictEqual(o.by_category.map((c) => c.category).sort(), [null, 'Health', 'Study'].sort());
    const health = o.by_category.find((c) => c.category === 'Health');
    assert.strictEqual(health.habits, 1);
    assert.strictEqual(health.checkins, 1);
    assert.strictEqual(o.habits.find((h) => h.name === 'A').category, 'Health');
  });

  it('leaves the breakdown empty when no habit has a category', async () => {
    const user = await newUser();
    await newHabit(user, 'Plain');
    assert.deepStrictEqual((await get(user, '/api/stats/overview')).body.by_category, []);
  });
});

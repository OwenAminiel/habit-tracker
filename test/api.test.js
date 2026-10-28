const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { skipReason, start, stop, call, newUser, newHabit } = require('../test-utils/api');
const { utcToday, addDays } = require('../src/utils/dates');

describe('Habit Tracker API', { skip: skipReason }, () => {
  before(start);
  after(stop);

  describe('app basics', () => {
    it('reports health', async () => {
      const res = await call('GET', '/health');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body, { status: 'ok' });
    });

    it('serves the web app at /', async () => {
      const res = await call('GET', '/');
      assert.strictEqual(res.status, 200);
      assert.match(res.type, /text\/html/);
      assert.match(res.text, /Habit Tracker/);
    });

    it('returns JSON 404 for unknown API routes', async () => {
      const res = await call('GET', '/api/nope');
      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.message);
    });

    it('returns 400 for malformed JSON', async () => {
      const res = await call('POST', '/api/auth/login', { rawBody: '{bad json' });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error.message, /invalid JSON/i);
    });
  });

  describe('authentication', () => {
    it('registers a user and never exposes the password hash', async () => {
      const email = `itest-reg-${Date.now()}@example.test`;
      const res = await call('POST', '/api/auth/register', { body: { email: email.toUpperCase(), password: 'password123' } });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.user.email, email, 'email is normalised to lower case');
      assert.ok(res.body.token);
      assert.strictEqual(res.text.includes('password'), false);
      // cleanup happens through newUser's tracking, so track this one explicitly
      const { pool } = require('../src/db');
      await pool.query('DELETE FROM users WHERE id = $1', [res.body.user.id]);
    });

    it('rejects a duplicate email with 409', async () => {
      const user = await newUser();
      const res = await call('POST', '/api/auth/register', { body: { email: user.email, password: 'password123' } });
      assert.strictEqual(res.status, 409);
    });

    it('validates email and password', async () => {
      const res = await call('POST', '/api/auth/register', { body: { email: 'nope', password: 'x' } });
      assert.strictEqual(res.status, 400);
      const fields = res.body.error.details.map((d) => d.field).sort();
      assert.deepStrictEqual(fields, ['email', 'password']);
    });

    it('logs in with the right password only', async () => {
      const user = await newUser();
      const ok = await call('POST', '/api/auth/login', { body: { email: user.email, password: 'password123' } });
      assert.strictEqual(ok.status, 200);
      assert.ok(ok.body.token);
      const bad = await call('POST', '/api/auth/login', { body: { email: user.email, password: 'wrong-password' } });
      assert.strictEqual(bad.status, 401);
      const unknown = await call('POST', '/api/auth/login', { body: { email: 'nobody@example.test', password: 'password123' } });
      assert.strictEqual(unknown.status, 401);
      assert.strictEqual(unknown.body.error.message, bad.body.error.message, 'does not reveal which emails exist');
    });

    it('protects routes and accepts only valid tokens', async () => {
      const user = await newUser();
      assert.strictEqual((await call('GET', '/api/auth/me')).status, 401);
      assert.strictEqual((await call('GET', '/api/habits')).status, 401);
      assert.strictEqual((await call('GET', '/api/habits', { token: user.token + 'x' })).status, 401);
      const me = await call('GET', '/api/auth/me', { token: user.token });
      assert.strictEqual(me.status, 200);
      assert.strictEqual(me.body.user.email, user.email);
    });
  });

  describe('habits', () => {
    it('creates, reads, updates and deletes a habit', async () => {
      const user = await newUser();
      const created = await call('POST', '/api/habits', { token: user.token, body: { name: '  Read  ', description: 'Evenings' } });
      assert.strictEqual(created.status, 201);
      assert.strictEqual(created.body.habit.name, 'Read', 'name is trimmed');
      const id = created.body.habit.id;

      const list = await call('GET', '/api/habits', { token: user.token });
      assert.strictEqual(list.body.habits.length, 1);

      const one = await call('GET', `/api/habits/${id}`, { token: user.token });
      assert.strictEqual(one.body.habit.description, 'Evenings');

      const updated = await call('PUT', `/api/habits/${id}`, { token: user.token, body: { name: 'Read more' } });
      assert.strictEqual(updated.status, 200);
      assert.strictEqual(updated.body.habit.name, 'Read more');
      assert.strictEqual(updated.body.habit.description, 'Evenings', 'untouched fields are kept');

      assert.strictEqual((await call('DELETE', `/api/habits/${id}`, { token: user.token })).status, 204);
      assert.strictEqual((await call('GET', `/api/habits/${id}`, { token: user.token })).status, 404);
    });

    it('validates input', async () => {
      const user = await newUser();
      const empty = await call('POST', '/api/habits', { token: user.token, body: { name: '   ' } });
      assert.strictEqual(empty.status, 400);
      const long = await call('POST', '/api/habits', { token: user.token, body: { name: 'x'.repeat(101) } });
      assert.strictEqual(long.status, 400);
      const habit = await newHabit(user);
      const noFields = await call('PUT', `/api/habits/${habit.id}`, { token: user.token, body: {} });
      assert.strictEqual(noFields.status, 400);
      const badId = await call('GET', '/api/habits/abc', { token: user.token });
      assert.strictEqual(badId.status, 400);
    });

    it('keeps each user\'s data private', async () => {
      const a = await newUser();
      const b = await newUser();
      const habit = await newHabit(a, 'Mine');
      await call('POST', `/api/habits/${habit.id}/entries`, { token: a.token, body: {} });

      assert.strictEqual((await call('GET', '/api/habits', { token: b.token })).body.habits.length, 0);
      assert.strictEqual((await call('GET', `/api/habits/${habit.id}`, { token: b.token })).status, 404);
      assert.strictEqual((await call('PUT', `/api/habits/${habit.id}`, { token: b.token, body: { name: 'Hacked' } })).status, 404);
      assert.strictEqual((await call('DELETE', `/api/habits/${habit.id}`, { token: b.token })).status, 404);
      assert.strictEqual((await call('GET', `/api/habits/${habit.id}/entries`, { token: b.token })).status, 404);
      assert.strictEqual((await call('POST', `/api/habits/${habit.id}/entries`, { token: b.token, body: {} })).status, 404);
      assert.strictEqual((await call('GET', `/api/habits/${habit.id}/streak`, { token: b.token })).status, 404);
      assert.strictEqual((await call('GET', '/api/habits/summary', { token: b.token })).body.habits.length, 0);

      const still = await call('GET', `/api/habits/${habit.id}`, { token: a.token });
      assert.strictEqual(still.body.habit.name, 'Mine');
    });
  });

  describe('entries and streaks', () => {
    it('records today by default and updates instead of duplicating', async () => {
      const user = await newUser();
      const habit = await newHabit(user);
      const first = await call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: { note: 'one' } });
      assert.strictEqual(first.status, 201);
      assert.strictEqual(first.body.entry.entry_date, utcToday());
      assert.strictEqual(first.body.entry.completed, true);
      const again = await call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: { note: 'two' } });
      assert.strictEqual(again.status, 200);
      assert.strictEqual(again.body.entry.note, 'two');
      const list = await call('GET', `/api/habits/${habit.id}/entries`, { token: user.token });
      assert.strictEqual(list.body.entries.length, 1);
    });

    it('rejects future and impossible dates', async () => {
      const user = await newUser();
      const habit = await newHabit(user);
      const future = await call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: { entry_date: addDays(utcToday(), 3) } });
      assert.strictEqual(future.status, 400);
      const fake = await call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: { entry_date: '2026-02-31' } });
      assert.strictEqual(fake.status, 400);
      const format = await call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: { entry_date: '10/28/2026' } });
      assert.strictEqual(format.status, 400);
    });

    it('lists history newest first, with optional from/to filters', async () => {
      const user = await newUser();
      const habit = await newHabit(user);
      const t = utcToday();
      for (const n of [-5, -3, -1]) {
        await call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: { entry_date: addDays(t, n) } });
      }
      const all = await call('GET', `/api/habits/${habit.id}/entries`, { token: user.token });
      assert.deepStrictEqual(all.body.entries.map((e) => e.entry_date), [addDays(t, -1), addDays(t, -3), addDays(t, -5)]);
      const range = await call('GET', `/api/habits/${habit.id}/entries?from=${addDays(t, -4)}&to=${addDays(t, -2)}`, { token: user.token });
      assert.deepStrictEqual(range.body.entries.map((e) => e.entry_date), [addDays(t, -3)]);
      const bad = await call('GET', `/api/habits/${habit.id}/entries?from=yesterday`, { token: user.token });
      assert.strictEqual(bad.status, 400);
    });

    it('removes an entry, and 404s when there is none', async () => {
      const user = await newUser();
      const habit = await newHabit(user);
      await call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: {} });
      const del = await call('DELETE', `/api/habits/${habit.id}/entries/${utcToday()}`, { token: user.token });
      assert.strictEqual(del.status, 204);
      const again = await call('DELETE', `/api/habits/${habit.id}/entries/${utcToday()}`, { token: user.token });
      assert.strictEqual(again.status, 404);
    });

    it('computes streaks, including the client\'s own "today"', async () => {
      const user = await newUser();
      const habit = await newHabit(user);
      const t = utcToday();
      for (const n of [-3, -2, -1]) {
        await call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: { entry_date: addDays(t, n) } });
      }
      // an incomplete day must not count
      await call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: { entry_date: t, completed: false } });

      const alive = await call('GET', `/api/habits/${habit.id}/streak`, { token: user.token });
      assert.strictEqual(alive.body.current_streak, 3, 'streak stays alive until today ends');
      assert.strictEqual(alive.body.longest_streak, 3);
      assert.strictEqual(alive.body.total_completed, 3);

      const broken = await call('GET', `/api/habits/${habit.id}/streak?today=${addDays(t, 2)}`, { token: user.token });
      assert.strictEqual(broken.body.current_streak, 0, 'two missed days break it');
      assert.strictEqual(broken.body.longest_streak, 3, 'best streak is kept');
    });

    it('summarises every habit for the dashboard in one request', async () => {
      const user = await newUser();
      const a = await newHabit(user, 'A');
      await newHabit(user, 'B');
      const t = utcToday();
      for (const n of [-1, 0]) {
        await call('POST', `/api/habits/${a.id}/entries`, { token: user.token, body: { entry_date: addDays(t, n) } });
      }
      const res = await call('GET', `/api/habits/summary?today=${t}`, { token: user.token });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.today, t);
      assert.strictEqual(res.body.habits.length, 2);
      const [first, second] = res.body.habits;
      assert.strictEqual(first.name, 'A');
      assert.strictEqual(first.completed_today, true);
      assert.strictEqual(first.current_streak, 2);
      assert.strictEqual(first.recent.length, 14);
      assert.strictEqual(first.recent[13].date, t);
      assert.strictEqual(first.recent[13].completed, true);
      assert.strictEqual(second.completed_today, false);
      assert.strictEqual(second.current_streak, 0);
      assert.strictEqual((await call('GET', '/api/habits/summary?today=bad', { token: user.token })).status, 400);
    });

    it('deletes a habit\'s entries along with it', async () => {
      const user = await newUser();
      const habit = await newHabit(user);
      await call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: {} });
      await call('DELETE', `/api/habits/${habit.id}`, { token: user.token });
      const { pool } = require('../src/db');
      const left = await pool.query('SELECT COUNT(*)::int AS n FROM entries WHERE habit_id = $1', [habit.id]);
      assert.strictEqual(left.rows[0].n, 0);
    });
  });
});

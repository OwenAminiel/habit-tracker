const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { skipReason, start, stop, call, newUser, newHabit, checkIn } = require('../test-utils/api');

const me = (token) => call('GET', '/api/auth/me', { token });

describe('Account security', { skip: skipReason }, () => {
  before(start);
  after(stop);

  it('changes the password, returns a fresh token and revokes the old one', async () => {
    const user = await newUser();
    const res = await call('PUT', '/api/auth/password', { token: user.token, body: { current_password: 'password123', new_password: 'newpassword456' } });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.token);
    assert.strictEqual((await me(user.token)).status, 401, 'old token stops working');
    assert.strictEqual((await me(res.body.token)).status, 200, 'new token works');
    assert.strictEqual((await call('POST', '/api/auth/login', { body: { email: user.email, password: 'password123' } })).status, 401);
    assert.strictEqual((await call('POST', '/api/auth/login', { body: { email: user.email, password: 'newpassword456' } })).status, 200);
  });

  it('rejects a wrong current password (403, not 401) and a reused or short new one', async () => {
    const user = await newUser();
    const put = (body) => call('PUT', '/api/auth/password', { token: user.token, body });
    assert.strictEqual((await put({ current_password: 'wrong-password', new_password: 'newpassword456' })).status, 403);
    assert.strictEqual((await put({ current_password: 'password123', new_password: 'password123' })).status, 400);
    assert.strictEqual((await put({ current_password: 'password123', new_password: 'short' })).status, 400);
    assert.strictEqual((await put({ new_password: 'newpassword456' })).status, 400);
    assert.strictEqual((await me(user.token)).status, 200, 'failed attempts keep the session');
  });

  it('logs out everywhere', async () => {
    const user = await newUser();
    const login = await call('POST', '/api/auth/login', { body: { email: user.email, password: 'password123' } });
    assert.strictEqual((await call('POST', '/api/auth/logout-all', { token: user.token })).status, 204);
    assert.strictEqual((await me(user.token)).status, 401);
    assert.strictEqual((await me(login.body.token)).status, 401);
    const again = await call('POST', '/api/auth/login', { body: { email: user.email, password: 'password123' } });
    assert.strictEqual((await me(again.body.token)).status, 200);
  });

  it('still accepts tokens issued before sessions were versioned', async () => {
    const user = await newUser();
    const legacy = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    assert.strictEqual((await me(legacy)).status, 200);
    await call('POST', '/api/auth/logout-all', { token: user.token });
    assert.strictEqual((await me(legacy)).status, 401);
  });

  it('rejects tokens for deleted users and tampered tokens', async () => {
    const user = await newUser();
    assert.strictEqual((await me(user.token + 'x')).status, 401);
    assert.strictEqual((await me('not.a.token')).status, 401);
    assert.strictEqual((await call('GET', '/api/auth/me')).status, 401);
  });

  it('deletes the account and everything in it, after confirming the password', async () => {
    const user = await newUser();
    const habit = await newHabit(user);
    await checkIn(user, habit, '2026-03-02');
    assert.strictEqual((await call('DELETE', '/api/auth/me', { token: user.token, body: { password: 'nope-nope-nope' } })).status, 403);
    assert.strictEqual((await call('DELETE', '/api/auth/me', { token: user.token, body: {} })).status, 400);
    assert.strictEqual((await me(user.token)).status, 200, 'still there after failed attempts');
    assert.strictEqual((await call('DELETE', '/api/auth/me', { token: user.token, body: { password: 'password123' } })).status, 204);
    assert.strictEqual((await me(user.token)).status, 401);
    assert.strictEqual((await call('POST', '/api/auth/login', { body: { email: user.email, password: 'password123' } })).status, 401);
    const { pool } = require('../src/db');
    const left = await pool.query('SELECT count(*)::int AS n FROM habits WHERE id = $1', [habit.id]);
    assert.strictEqual(left.rows[0].n, 0, 'habits are cascade deleted');
  });

  it('gives every response a request id, and echoes it in errors', async () => {
    const res = await call('GET', '/api/nope');
    assert.strictEqual(res.status, 404);
    assert.ok(res.body.error.request_id);
  });

  it('reports malformed JSON as 400 and oversized bodies as 413', async () => {
    const bad = await call('POST', '/api/auth/login', { rawBody: '{oops' });
    assert.strictEqual(bad.status, 400);
    const big = await call('POST', '/api/auth/login', { body: { email: 'a@b.co', password: 'x'.repeat(20000) } });
    assert.strictEqual(big.status, 413);
  });
});

// Shared helpers for the API integration tests.
//
// SAFETY: these tests only ever use TEST_DATABASE_URL, never DATABASE_URL, and they only delete the
// users they created themselves (and, through ON DELETE CASCADE, those users' habits and entries).
require('dotenv').config();

const enabled = Boolean(process.env.TEST_DATABASE_URL);
let server;
let base;
const createdUserIds = [];

process.env.NODE_ENV = 'test';

if (enabled) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  if (process.env.TEST_DATABASE_SSL !== undefined) process.env.DATABASE_SSL = process.env.TEST_DATABASE_SSL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';
}

const skipReason = enabled ? false : 'Set TEST_DATABASE_URL to run the API tests (see README).';

async function start() {
  // Bring the test database up to date, so a fresh database needs no manual setup.
  await require('../src/migrate').migrate(require('../src/db').pool, () => {});
  const app = require('../src/app');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function stop() {
  const { pool } = require('../src/db');
  if (createdUserIds.length) await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [createdUserIds]);
  await pool.end();
  await new Promise((resolve) => server.close(resolve));
}

async function call(method, path, { token, body, rawBody } = {}) {
  const headers = {};
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  return { status: res.status, type, text, body: type.includes('json') && text ? JSON.parse(text) : null };
}

let counter = 0;
async function newUser() {
  const email = `itest-${Date.now()}-${counter++}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const res = await call('POST', '/api/auth/register', { body: { email, password: 'password123' } });
  if (res.status !== 201) throw new Error(`Could not create test user: ${res.text}`);
  createdUserIds.push(res.body.user.id);
  return { email, id: res.body.user.id, token: res.body.token };
}

// newHabit(user), newHabit(user, 'Name'), or newHabit(user, { name, frequency, ... })
const newHabit = async (user, nameOrBody = 'Test habit') => {
  const body = typeof nameOrBody === 'string' ? { name: nameOrBody } : nameOrBody;
  const res = await call('POST', '/api/habits', { token: user.token, body });
  if (res.status !== 201) throw new Error(`Could not create test habit: ${res.text}`);
  return res.body.habit;
};

// Log a check-in on a specific date; returns the response.
const checkIn = (user, habit, date, extra = {}) =>
  call('POST', `/api/habits/${habit.id}/entries`, { token: user.token, body: { entry_date: date, ...extra } });

module.exports = { skipReason, start, stop, call, newUser, newHabit, checkIn, getBase: () => base };

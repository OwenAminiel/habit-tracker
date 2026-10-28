// Shared helpers for the API integration tests.
//
// SAFETY: these tests only ever use TEST_DATABASE_URL, never DATABASE_URL, and they only delete the
// users they created themselves (and, through ON DELETE CASCADE, those users' habits and entries).
require('dotenv').config();

const enabled = Boolean(process.env.TEST_DATABASE_URL);
let server;
let base;
const createdUserIds = [];

if (enabled) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  if (process.env.TEST_DATABASE_SSL !== undefined) process.env.DATABASE_SSL = process.env.TEST_DATABASE_SSL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';
}

const skipReason = enabled ? false : 'Set TEST_DATABASE_URL to run the API tests (see README).';

async function start() {
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

const newHabit = async (user, name = 'Test habit') =>
  (await call('POST', '/api/habits', { token: user.token, body: { name } })).body.habit;

module.exports = { skipReason, start, stop, call, newUser, newHabit };

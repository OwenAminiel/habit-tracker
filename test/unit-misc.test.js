const { describe, it } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { loadConfig } = require('../src/config');
const { make } = require('../src/middleware/rateLimit');

describe('config validation', () => {
  const ok = { DATABASE_URL: 'postgres://u:p@localhost/db', JWT_SECRET: 'a-long-enough-secret-value' };

  it('accepts a valid environment and applies defaults', () => {
    const r = loadConfig(ok);
    assert.deepStrictEqual(r.problems, []);
  });

  it('reports a missing database, short secret and bad port', () => {
    const r = loadConfig({ JWT_SECRET: 'short', PORT: 'abc' });
    assert.ok(r.problems.length >= 3, r.problems.join('|'));
  });

  it('rejects the placeholder secret in production only', () => {
    const env = { ...ok, JWT_SECRET: 'replace-with-a-long-random-string' };
    assert.strictEqual(loadConfig(env).problems.length, 0);
    assert.ok(loadConfig({ ...env, NODE_ENV: 'production' }).problems.length > 0);
  });
});

describe('rate limiter', () => {
  it('answers 429 JSON with a request id after the limit', async () => {
    const app = express();
    app.use((req, res, next) => { req.id = 'req-1'; next(); });
    app.use(make({ windowMs: 60000, limit: 2, skip: () => false }));
    app.get('/', (req, res) => res.json({ ok: true }));
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    try {
      assert.strictEqual((await fetch(url)).status, 200);
      assert.strictEqual((await fetch(url)).status, 200);
      const res = await fetch(url);
      assert.strictEqual(res.status, 429);
      const body = await res.json();
      assert.match(body.error.message, /Too many requests/);
      assert.strictEqual(body.error.request_id, 'req-1');
    } finally {
      server.close();
    }
  });
});

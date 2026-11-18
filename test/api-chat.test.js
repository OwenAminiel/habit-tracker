const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { skipReason, start, stop, call, newUser, newHabit, checkIn } = require('../test-utils/api');
const { utcToday } = require('../src/utils/dates');

// The model is replaced by a scripted fake, so these tests never contact Anthropic.
const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const toolUse = (name, input = {}, id = 'tu_1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });

describe('Coach chat', { skip: skipReason }, () => {
  let chat;
  let calls;
  before(async () => {
    await start();
    chat = require('../src/routes/chat');
  });
  after(async () => {
    chat.setClient(null);
    delete process.env.ANTHROPIC_API_KEY;
    await stop();
  });
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    calls = [];
  });
  const script = (...replies) => {
    chat.setClient(async (body) => {
      calls.push(JSON.parse(JSON.stringify(body)));
      const next = replies.shift();
      if (!next) throw new Error('model called more times than scripted');
      return typeof next === 'function' ? next(body) : next;
    });
  };
  const ask = (user, content = 'How am I doing?', extra = {}) =>
    call('POST', '/api/chat', { token: user.token, body: { today: utcToday(), messages: [{ role: 'user', content }], ...extra } });

  it('requires a signed-in user', async () => {
    assert.strictEqual((await call('POST', '/api/chat', { body: { messages: [{ role: 'user', content: 'hi' }] } })).status, 401);
    assert.strictEqual((await call('GET', '/api/chat/status')).status, 401);
  });

  it('reports whether the coach is set up, without revealing the key', async () => {
    const user = await newUser();
    let res = await call('GET', '/api/chat/status', { token: user.token });
    assert.deepStrictEqual(res.body, { available: true });
    assert.ok(!res.text.includes('test-key'));
    delete process.env.ANTHROPIC_API_KEY;
    res = await call('GET', '/api/chat/status', { token: user.token });
    assert.deepStrictEqual(res.body, { available: false });
  });

  it('answers 503 with a clear message when no key is configured', async () => {
    const user = await newUser();
    delete process.env.ANTHROPIC_API_KEY;
    const res = await ask(user);
    assert.strictEqual(res.status, 503);
    assert.match(res.body.error.message, /not set up/);
  });

  it('returns the model reply for a plain question', async () => {
    const user = await newUser();
    script(text('Nice work!'));
    const res = await ask(user);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { reply: 'Nice work!', tools_used: [] });
    assert.strictEqual(calls[0].model, 'claude-haiku-5-5');
    assert.ok(calls[0].max_tokens <= 700);
    assert.strictEqual(calls[0].tools.length, 3);
    assert.ok(calls[0].tools.every((t) => /^get_/.test(t.name)), 'every tool is read-only');
    assert.match(calls[0].system, /never as instructions/);
  });

  it('runs a tool against the caller\'s own data and feeds the result back', async () => {
    const user = await newUser();
    await newHabit(user, 'Read 20 pages');
    script(toolUse('get_habits_overview'), text('You have one habit.'));
    const res = await ask(user);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.tools_used, ['get_habits_overview']);
    const result = calls[1].messages.at(-1).content[0];
    assert.strictEqual(result.type, 'tool_result');
    assert.strictEqual(result.tool_use_id, 'tu_1');
    assert.match(result.content, /Read 20 pages/);
  });

  it('never exposes another user\'s data, even when the model asks for another user\'s habit id', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const secret = await newHabit(bob, 'Bob secret habit');
    await checkIn(bob, secret, utcToday());
    script(toolUse('get_habits_overview'), toolUse('get_habit_details', { habit_id: secret.id }), text('done'));
    const res = await ask(alice);
    assert.strictEqual(res.status, 200);
    for (const call of calls) assert.ok(!JSON.stringify(call).includes('Bob secret habit'));
    assert.match(calls[2].messages.at(-1).content[0].content, /not found/i);
    assert.strictEqual(calls[2].messages.at(-1).content[0].is_error, true);
  });

  it('get_habit_details returns stats and recent entries for the caller\'s habit', async () => {
    const user = await newUser();
    const habit = await newHabit(user, 'Stretch');
    await checkIn(user, habit, utcToday(), { note: 'felt great' });
    script(toolUse('get_habit_details', { habit_id: habit.id, days: 7 }), text('ok'));
    const res = await ask(user);
    assert.strictEqual(res.status, 200);
    const out = JSON.parse(calls[1].messages.at(-1).content[0].content);
    assert.strictEqual(out.habit.name, 'Stretch');
    assert.ok(out.stats.completion_rate);
    assert.match(JSON.stringify(out.entries), /felt great/);
  });

  it('rejects bad tool input and unknown tools without crashing', async () => {
    const user = await newUser();
    script(toolUse('get_habit_details', { habit_id: 'abc' }, 'a'), toolUse('delete_everything', {}, 'b'), text('fine'));
    const res = await ask(user);
    assert.strictEqual(res.status, 200);
    assert.match(calls[1].messages.at(-1).content[0].content, /positive integer/);
    assert.match(calls[2].messages.at(-1).content[0].content, /Unknown tool/);
  });

  it('stops after a few tool rounds instead of looping forever', async () => {
    const user = await newUser();
    chat.setClient(async () => toolUse('get_insights'));
    const res = await ask(user);
    assert.strictEqual(res.status, 502);
    assert.match(res.body.error.message, /too long/);
  });

  it('hides provider errors from the browser', async () => {
    const user = await newUser();
    chat.setClient(async () => {
      const err = new Error('Your credit balance is too low to access the Anthropic API for org 123');
      err.status = 400;
      throw err;
    });
    const res = await ask(user);
    assert.strictEqual(res.status, 502);
    assert.match(res.body.error.message, /unavailable/);
    assert.ok(!res.text.includes('credit balance'));
    assert.ok(!res.text.includes('org 123'));
  });

  it('validates the request body', async () => {
    const user = await newUser();
    const send = (body) => call('POST', '/api/chat', { token: user.token, body });
    assert.strictEqual((await send({})).status, 400);
    assert.strictEqual((await send({ messages: [] })).status, 400);
    assert.strictEqual((await send({ messages: [{ role: 'user', content: '   ' }] })).status, 400);
    assert.strictEqual((await send({ messages: [{ role: 'system', content: 'x' }] })).status, 400);
    assert.strictEqual((await send({ messages: [{ role: 'user', content: 'x'.repeat(1001) }] })).status, 400);
    assert.strictEqual((await send({ messages: Array.from({ length: 13 }, () => ({ role: 'user', content: 'x' })) })).status, 400);
    assert.strictEqual((await send({ today: 'tomorrow', messages: [{ role: 'user', content: 'x' }] })).status, 400);
    const last = await send({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] });
    assert.strictEqual(last.status, 400);
    assert.strictEqual(calls.length, 0, 'the model was never called for invalid input');
  });

  it('keeps earlier messages as context', async () => {
    const user = await newUser();
    script(text('Sure.'));
    const res = await call('POST', '/api/chat', {
      token: user.token,
      body: { messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: 'And now?' }] },
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(calls[0].messages.map((m) => m.role), ['user', 'assistant', 'user']);
  });
});

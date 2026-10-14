const test = require('node:test');
const assert = require('node:assert');
const { computeStreaks } = require('../src/utils/streak');

test('no entries gives zeros', () => {
  assert.deepStrictEqual(computeStreaks([], '2026-10-13'), {
    current_streak: 0, longest_streak: 0, total_completed: 0, last_completed: null,
  });
});

test('current streak counts back from today', () => {
  const r = computeStreaks(['2026-10-11', '2026-10-12', '2026-10-13'], '2026-10-13');
  assert.strictEqual(r.current_streak, 3);
  assert.strictEqual(r.longest_streak, 3);
});

test('streak stays alive if only yesterday is logged', () => {
  assert.strictEqual(computeStreaks(['2026-10-11', '2026-10-12'], '2026-10-13').current_streak, 2);
});

test('streak breaks after a missed day, longest is kept', () => {
  const r = computeStreaks(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10'], '2026-10-13');
  assert.strictEqual(r.current_streak, 0);
  assert.strictEqual(r.longest_streak, 3);
});

test('handles month boundaries and duplicates', () => {
  const r = computeStreaks(['2026-09-30', '2026-10-01', '2026-10-01'], '2026-10-01');
  assert.strictEqual(r.current_streak, 2);
  assert.strictEqual(r.total_completed, 2);
});

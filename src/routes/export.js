const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');
const { habitJson } = require('../utils/habits');
const { utcToday } = require('../utils/dates');

const router = express.Router();
router.use(requireAuth);

// Spreadsheet-safe CSV: quote cells that need it, and defuse cells a spreadsheet would run as a formula.
function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Everything the user has stored, as JSON (default) or CSV. Includes archived habits.
router.get(
  '/',
  validate(z.object({ format: z.enum(['json', 'csv'], { errorMap: () => ({ message: 'format must be json or csv.' }) }).default('json') }), 'query'),
  asyncHandler(async (req, res) => {
    const user = (await db.query('SELECT email FROM users WHERE id = $1', [req.user.id])).rows[0];
    const habits = (await db.query('SELECT * FROM habits WHERE user_id = $1 ORDER BY created_at, id', [req.user.id])).rows;
    const entries = (
      await db.query(
        `SELECT e.* FROM entries e JOIN habits h ON h.id = e.habit_id WHERE h.user_id = $1 ORDER BY e.habit_id, e.entry_date`,
        [req.user.id]
      )
    ).rows;
    const byHabit = new Map(habits.map((h) => [h.id, []]));
    for (const e of entries) byHabit.get(e.habit_id).push(e);

    const stamp = utcToday();
    res.setHeader('Cache-Control', 'no-store');

    if (req.query.format === 'csv') {
      const lines = [['habit', 'frequency', 'archived', 'entry_date', 'completed', 'note'].join(',')];
      for (const h of habits) {
        const rows = byHabit.get(h.id);
        const base = [h.name, h.frequency, h.archived_at != null];
        if (rows.length === 0) lines.push([...base, '', '', ''].map(csvCell).join(','));
        for (const e of rows) lines.push([...base, e.entry_date, e.completed, e.note].map(csvCell).join(','));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="habit-tracker-${stamp}.csv"`);
      return res.send(`${lines.join('\r\n')}\r\n`);
    }

    res.setHeader('Content-Disposition', `attachment; filename="habit-tracker-${stamp}.json"`);
    res.json({
      exported_at: new Date().toISOString(),
      user: { email: user.email },
      habits: habits.map((h) => ({
        ...habitJson(h),
        entries: byHabit.get(h.id).map((e) => ({ entry_date: e.entry_date, completed: e.completed, note: e.note })),
      })),
    });
  })
);

module.exports = router;

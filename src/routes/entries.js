const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate } = require('../middleware/validate');
const { computeStreaks } = require('../utils/streak');
const { AppError, asyncHandler } = require('../utils/errors');

// Mounted at /api/habits/:id (the habit is already loaded and ownership-checked).
const router = express.Router({ mergeParams: true });

const today = () => new Date().toISOString().slice(0, 10);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
  .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, 'Not a valid calendar date.');

const entrySchema = z.object({
  entry_date: isoDate.optional(),
  completed: z.boolean().optional().default(true),
  note: z.string().trim().max(500).optional().default(''),
});
const rangeSchema = z.object({ from: isoDate.optional(), to: isoDate.optional() });

router.post(
  '/entries',
  validate(entrySchema),
  asyncHandler(async (req, res) => {
    const { completed, note } = req.body;
    const date = req.body.entry_date || today();
    if (date > today()) throw new AppError(400, 'Cannot record progress for a future date.');

    const { rows } = await db.query(
      `INSERT INTO entries (habit_id, entry_date, completed, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (habit_id, entry_date)
       DO UPDATE SET completed = EXCLUDED.completed, note = EXCLUDED.note
       RETURNING *, (xmax = 0) AS inserted`,
      [req.habit.id, date, completed, note]
    );
    const { inserted, ...entry } = rows[0];
    res.status(inserted ? 201 : 200).json({ entry });
  })
);

router.get(
  '/entries',
  validate(rangeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const { rows } = await db.query(
      `SELECT * FROM entries
       WHERE habit_id = $1
         AND ($2::date IS NULL OR entry_date >= $2::date)
         AND ($3::date IS NULL OR entry_date <= $3::date)
       ORDER BY entry_date DESC`,
      [req.habit.id, from || null, to || null]
    );
    res.json({ entries: rows });
  })
);

router.delete(
  '/entries/:date',
  asyncHandler(async (req, res) => {
    const parsed = isoDate.safeParse(req.params.date);
    if (!parsed.success) throw new AppError(400, 'Date must be a valid YYYY-MM-DD value.');
    const result = await db.query('DELETE FROM entries WHERE habit_id = $1 AND entry_date = $2', [
      req.habit.id,
      parsed.data,
    ]);
    if (result.rowCount === 0) throw new AppError(404, 'No entry exists for that date.');
    res.status(204).end();
  })
);

router.get(
  '/streak',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      'SELECT entry_date FROM entries WHERE habit_id = $1 AND completed = TRUE ORDER BY entry_date',
      [req.habit.id]
    );
    res.json({ habit_id: req.habit.id, ...computeStreaks(rows.map((r) => r.entry_date)) });
  })
);

module.exports = router;

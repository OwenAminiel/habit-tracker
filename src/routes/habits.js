const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../utils/errors');
const { computeStreaks } = require('../utils/streak');
const { isoDate, utcToday, addDays } = require('../utils/dates');
const entriesRouter = require('./entries');

const router = express.Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100),
  description: z.string().trim().max(500).optional().default(''),
});
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

// Loads the habit and makes sure it belongs to the logged-in user.
const loadHabit = asyncHandler(async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new AppError(400, 'Habit id must be a positive integer.');
  const { rows } = await db.query('SELECT * FROM habits WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  if (!rows[0]) throw new AppError(404, 'Habit not found.');
  req.habit = rows[0];
  next();
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM habits WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json({ habits: rows });
  })
);

// One request for the dashboard: every habit with streaks, today's status and the last 14 days.
router.get(
  '/summary',
  validate(z.object({ today: isoDate.optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const today = req.query.today || utcToday();
    const { rows: habits } = await db.query('SELECT * FROM habits WHERE user_id = $1 ORDER BY created_at ASC', [
      req.user.id,
    ]);
    const { rows: entries } = await db.query(
      `SELECT e.habit_id, e.entry_date FROM entries e
       JOIN habits h ON h.id = e.habit_id
       WHERE h.user_id = $1 AND e.completed = TRUE`,
      [req.user.id]
    );
    const byHabit = new Map();
    for (const e of entries) {
      if (!byHabit.has(e.habit_id)) byHabit.set(e.habit_id, []);
      byHabit.get(e.habit_id).push(e.entry_date);
    }
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
    res.json({
      today,
      habits: habits.map((h) => {
        const dates = byHabit.get(h.id) || [];
        const done = new Set(dates);
        return {
          ...h,
          ...computeStreaks(dates, today),
          completed_today: done.has(today),
          recent: days.map((date) => ({ date, completed: done.has(date) })),
        };
      }),
    });
  })
);

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { name, description } = req.body;
    const { rows } = await db.query(
      'INSERT INTO habits (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, name, description]
    );
    res.status(201).json({ habit: rows[0] });
  })
);

router.get('/:id', loadHabit, (req, res) => res.json({ habit: req.habit }));

router.put(
  '/:id',
  loadHabit,
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const name = req.body.name ?? req.habit.name;
    const description = req.body.description ?? req.habit.description;
    const { rows } = await db.query(
      'UPDATE habits SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [name, description, req.habit.id]
    );
    res.json({ habit: rows[0] });
  })
);

router.delete(
  '/:id',
  loadHabit,
  asyncHandler(async (req, res) => {
    await db.query('DELETE FROM habits WHERE id = $1', [req.habit.id]);
    res.status(204).end();
  })
);

router.use('/:id', loadHabit, entriesRouter);

module.exports = router;

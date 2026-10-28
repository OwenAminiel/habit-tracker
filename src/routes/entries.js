const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate } = require('../middleware/validate');
const { computeStreaks } = require('../utils/streak');
const { habitStats } = require('../utils/stats');
const { isoDate, utcToday, addDays } = require('../utils/dates');
const { pageParams, pagination } = require('../utils/pagination');
const { AppError, asyncHandler } = require('../utils/errors');

// Mounted at /api/habits/:id (the habit is already loaded and ownership-checked, as req.habit).
const router = express.Router({ mergeParams: true });

const entrySchema = z.object({
  entry_date: isoDate.optional(),
  completed: z.boolean({ invalid_type_error: 'completed must be true or false.' }).optional().default(true),
  note: z.string().trim().max(500, 'Note must be 500 characters or fewer.').optional().default(''),
});

const listSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    completed: z.enum(['true', 'false'], { errorMap: () => ({ message: 'completed must be true or false.' }) }).optional(),
    order: z.enum(['asc', 'desc'], { errorMap: () => ({ message: 'order must be asc or desc.' }) }).default('desc'),
    ...pageParams(100, 500),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must be on or before "to".', path: ['from'] });

// Clients may send their own local date so streaks follow the user's time zone.
const todaySchema = z.object({ today: isoDate.optional() });

const habitOptions = (habit, today) => ({
  today,
  frequency: habit.frequency,
  days_of_week: habit.days_of_week,
  times_per_week: habit.times_per_week,
});

async function completedDates(habitId) {
  const { rows } = await db.query('SELECT entry_date FROM entries WHERE habit_id = $1 AND completed = TRUE ORDER BY entry_date', [habitId]);
  return rows.map((r) => r.entry_date);
}

router.post(
  '/entries',
  validate(entrySchema),
  asyncHandler(async (req, res) => {
    if (req.habit.archived_at) throw new AppError(409, 'This habit is archived. Restore it before logging check-ins.');
    const { completed, note } = req.body;
    const date = req.body.entry_date || utcToday();
    // Allow one day of slack so users ahead of UTC can log their own "today".
    if (date > addDays(utcToday(), 1)) throw new AppError(400, 'Cannot record progress for a future date.');

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
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to, completed, order, page, limit } = req.query;
    const where = ['habit_id = $1'];
    const params = [req.habit.id];
    if (from) { params.push(from); where.push(`entry_date >= $${params.length}::date`); }
    if (to) { params.push(to); where.push(`entry_date <= $${params.length}::date`); }
    if (completed) { params.push(completed === 'true'); where.push(`completed = $${params.length}`); }
    const clause = where.join(' AND ');
    const direction = order === 'asc' ? 'ASC' : 'DESC';

    const total = (await db.query(`SELECT COUNT(*)::int AS n FROM entries WHERE ${clause}`, params)).rows[0].n;
    const { rows } = await db.query(
      `SELECT * FROM entries WHERE ${clause} ORDER BY entry_date ${direction} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    );
    res.json({ entries: rows, pagination: pagination(page, limit, total) });
  })
);

router.delete(
  '/entries/:date',
  asyncHandler(async (req, res) => {
    const parsed = isoDate.safeParse(req.params.date);
    if (!parsed.success) throw new AppError(400, 'Date must be a valid YYYY-MM-DD value.');
    if (req.habit.archived_at) throw new AppError(409, 'This habit is archived. Restore it before changing check-ins.');
    const result = await db.query('DELETE FROM entries WHERE habit_id = $1 AND entry_date = $2', [req.habit.id, parsed.data]);
    if (result.rowCount === 0) throw new AppError(404, 'No entry exists for that date.');
    res.status(204).end();
  })
);

router.get(
  '/streak',
  validate(todaySchema, 'query'),
  asyncHandler(async (req, res) => {
    const today = req.query.today || utcToday();
    const dates = await completedDates(req.habit.id);
    res.json({ habit_id: req.habit.id, frequency: req.habit.frequency, ...computeStreaks(dates, habitOptions(req.habit, today)) });
  })
);

// Completion rates, check-ins by weekday, the last 8 weeks, and milestones reached.
router.get(
  '/stats',
  validate(todaySchema, 'query'),
  asyncHandler(async (req, res) => {
    const today = req.query.today || utcToday();
    res.json({ habit_id: req.habit.id, frequency: req.habit.frequency, ...habitStats(req.habit, await completedDates(req.habit.id), today) });
  })
);

module.exports = router;

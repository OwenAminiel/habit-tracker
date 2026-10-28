const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../utils/errors');
const { isoDate, utcToday, addDays, weekStart, eachDay } = require('../utils/dates');
const { scheduleFields, habitJson, isRequired, resolveSchedule, FREQUENCIES } = require('../utils/habits');
const { habitStats } = require('../utils/stats');
const { pageParams, pagination } = require('../utils/pagination');
const { loadHabitsWithDone } = require('../services/habitData');
const entriesRouter = require('./entries');

const router = express.Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100, 'Name must be 100 characters or fewer.'),
  description: z.string().trim().max(500, 'Description must be 500 characters or fewer.').optional().default(''),
  frequency: scheduleFields.frequency.optional(),
  days_of_week: scheduleFields.days_of_week.nullable().optional(),
  times_per_week: scheduleFields.times_per_week.nullable().optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(100, 'Name must be 100 characters or fewer.').optional(),
    description: z.string().trim().max(500, 'Description must be 500 characters or fewer.').optional(),
    frequency: scheduleFields.frequency.optional(),
    days_of_week: scheduleFields.days_of_week.nullable().optional(),
    times_per_week: scheduleFields.times_per_week.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

const listQuery = z.object({
  ...pageParams(20, 100),
  sort: z.enum(['created_at', 'updated_at', 'name'], { errorMap: () => ({ message: 'sort must be created_at, updated_at or name.' }) }).default('created_at'),
  order: z.enum(['asc', 'desc'], { errorMap: () => ({ message: 'order must be asc or desc.' }) }).default('desc'),
  q: z.string().trim().max(100).optional(),
  archived: z.enum(['true', 'false', 'all'], { errorMap: () => ({ message: 'archived must be true, false or all.' }) }).default('false'),
  frequency: z.enum(FREQUENCIES, { errorMap: () => ({ message: 'frequency must be daily, days or weekly.' }) }).optional(),
});

// Loads the habit and makes sure it belongs to the logged-in user.
const loadHabit = asyncHandler(async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new AppError(400, 'Habit id must be a positive integer.');
  const { rows } = await db.query('SELECT * FROM habits WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  if (!rows[0]) throw new AppError(404, 'Habit not found.');
  req.habit = rows[0];
  next();
});

// List habits with search, filters, sorting and pagination.
router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit, sort, order, q, archived, frequency } = req.query;
    const where = ['user_id = $1'];
    const params = [req.user.id];
    if (archived === 'true') where.push('archived_at IS NOT NULL');
    if (archived === 'false') where.push('archived_at IS NULL');
    if (frequency) {
      params.push(frequency);
      where.push(`frequency = $${params.length}`);
    }
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    // sort and order come from a fixed list (validated above), never straight from the request.
    const column = sort === 'name' ? 'LOWER(name)' : sort;
    const direction = order === 'asc' ? 'ASC' : 'DESC';
    const clause = where.join(' AND ');

    const total = (await db.query(`SELECT COUNT(*)::int AS n FROM habits WHERE ${clause}`, params)).rows[0].n;
    const { rows } = await db.query(
      `SELECT * FROM habits WHERE ${clause} ORDER BY ${column} ${direction}, id ${direction} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    );
    res.json({ habits: rows.map(habitJson), pagination: pagination(page, limit, total) });
  })
);

// One request for the dashboard: every active habit with streaks, today's status and the last 14 days.
router.get(
  '/summary',
  validate(z.object({ today: isoDate.optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const today = req.query.today || utcToday();
    const { habits, done } = await loadHabitsWithDone(req.user.id);
    const days = eachDay(addDays(today, -13), today);
    const thisWeek = eachDay(weekStart(today), addDays(weekStart(today), 6));

    res.json({
      today,
      habits: habits.map((h) => {
        const dates = done.get(h.id);
        const set = new Set(dates);
        const stats = habitStats(h, dates, today);
        return {
          ...habitJson(h),
          current_streak: stats.current_streak,
          longest_streak: stats.longest_streak,
          total_completed: stats.total_completed,
          last_completed: stats.last_completed,
          streak_unit: stats.streak_unit,
          completion_rate_30: stats.completion_rate.days_30,
          completed_today: set.has(today),
          required_today: isRequired(h, today),
          week_count: thisWeek.filter((d) => set.has(d)).length,
          week_goal: h.frequency === 'weekly' ? h.times_per_week : null,
          recent: days.map((date) => ({ date, completed: set.has(date), required: isRequired(h, date) })),
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
    const schedule = resolveSchedule(null, req.body);
    const { rows } = await db.query(
      `INSERT INTO habits (user_id, name, description, frequency, days_of_week, times_per_week)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, name, description, schedule.frequency, schedule.days_of_week, schedule.times_per_week]
    );
    res.status(201).json({ habit: habitJson(rows[0]) });
  })
);

router.get('/:id', loadHabit, (req, res) => res.json({ habit: habitJson(req.habit) }));

router.put(
  '/:id',
  loadHabit,
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const name = req.body.name ?? req.habit.name;
    const description = req.body.description ?? req.habit.description;
    const schedule = resolveSchedule(req.habit, req.body);
    const { rows } = await db.query(
      `UPDATE habits SET name = $1, description = $2, frequency = $3, days_of_week = $4, times_per_week = $5, updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [name, description, schedule.frequency, schedule.days_of_week, schedule.times_per_week, req.habit.id]
    );
    res.json({ habit: habitJson(rows[0]) });
  })
);

// Archiving hides a habit from the dashboard but keeps its whole history. Both calls are safe to repeat.
router.post(
  '/:id/archive',
  loadHabit,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('UPDATE habits SET archived_at = COALESCE(archived_at, NOW()), updated_at = NOW() WHERE id = $1 RETURNING *', [req.habit.id]);
    res.json({ habit: habitJson(rows[0]) });
  })
);

router.post(
  '/:id/restore',
  loadHabit,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('UPDATE habits SET archived_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *', [req.habit.id]);
    res.json({ habit: habitJson(rows[0]) });
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

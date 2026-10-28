const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');
const { isoDate, utcToday, addDays, weekStart, eachDay, dayOfWeek } = require('../utils/dates');
const { habitStats, WEEKDAY_NAMES } = require('../utils/stats');
const { loadHabitsWithDone } = require('../services/habitData');

const router = express.Router();
router.use(requireAuth);

const mean = (nums) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);
const inDays = (stats) => (stats.streak_unit === 'week' ? stats.current_streak * 7 : stats.current_streak);

// Everything the Insights page shows, across all active habits.
router.get(
  '/overview',
  validate(z.object({ today: isoDate.optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const today = req.query.today || utcToday();
    const { habits, done } = await loadHabitsWithDone(req.user.id);
    const archived = (await db.query('SELECT COUNT(*)::int AS n FROM habits WHERE user_id = $1 AND archived_at IS NOT NULL', [req.user.id])).rows[0].n;

    const thisWeek = new Set(eachDay(weekStart(today), addDays(weekStart(today), 6)));
    const activityStart = addDays(weekStart(today), -77); // twelve full weeks back, Sunday to Saturday
    const activity = new Map(eachDay(activityStart, today).map((d) => [d, 0]));
    const byWeekday = WEEKDAY_NAMES.map((name, day) => ({ day, name, completed: 0 }));

    let checkedInToday = 0;
    let weekCheckins = 0;
    let totalCheckins = 0;
    const perHabit = habits.map((h) => {
      const dates = done.get(h.id);
      const stats = habitStats(h, dates, today);
      for (const d of dates) {
        totalCheckins += 1;
        byWeekday[dayOfWeek(d)].completed += 1;
        if (thisWeek.has(d)) weekCheckins += 1;
        if (activity.has(d)) activity.set(d, activity.get(d) + 1);
        if (d === today) checkedInToday += 1;
      }
      return { habit: h, stats };
    });

    const best = perHabit.reduce((top, cur) => (!top || inDays(cur.stats) > inDays(top.stats) ? cur : top), null);

    res.json({
      today,
      active_habits: habits.length,
      archived_habits: archived,
      checked_in_today: checkedInToday,
      checkins_this_week: weekCheckins,
      total_checkins: totalCheckins,
      completion_rate: {
        days_7: mean(perHabit.map((p) => p.stats.completion_rate.days_7).filter((n) => n !== null)),
        days_30: mean(perHabit.map((p) => p.stats.completion_rate.days_30).filter((n) => n !== null)),
      },
      best_current_streak: best && best.stats.current_streak > 0
        ? { habit_id: best.habit.id, name: best.habit.name, streak: best.stats.current_streak, unit: best.stats.streak_unit }
        : null,
      by_weekday: byWeekday,
      activity: [...activity].map(([date, count]) => ({ date, count })),
      habits: perHabit
        .map(({ habit, stats }) => ({
          id: habit.id,
          name: habit.name,
          frequency: habit.frequency,
          current_streak: stats.current_streak,
          longest_streak: stats.longest_streak,
          streak_unit: stats.streak_unit,
          total_completed: stats.total_completed,
          rate_7: stats.completion_rate.days_7,
          rate_30: stats.completion_rate.days_30,
        }))
        .sort((a, b) => (b.rate_30 ?? -1) - (a.rate_30 ?? -1) || a.name.localeCompare(b.name)),
    });
  })
);

module.exports = router;

const { utcToday, addDays, dayOfWeek, weekStart } = require('./dates');

/**
 * Streaks for one habit, from the dates it was completed ('YYYY-MM-DD').
 *
 *  - daily:  every day counts.
 *  - days:   only the chosen weekdays count. Other days are skipped: they neither extend nor break the streak.
 *  - weekly: counts weeks (Sunday to Saturday) in which the goal was met, so the streak is measured in weeks.
 *
 * The current day (or week) is still in progress, so it never breaks a streak until it is over.
 *
 * `options` is either an object { today, frequency, days_of_week, times_per_week } or, for plain daily
 * habits, just the "today" date string.
 */
function computeStreaks(completedDates, options = {}) {
  const opts = typeof options === 'string' ? { today: options } : options;
  const today = opts.today || utcToday();
  const frequency = opts.frequency || 'daily';

  const done = new Set(completedDates);
  const sorted = [...done].sort();
  const result = {
    current_streak: 0,
    longest_streak: 0,
    total_completed: sorted.length,
    last_completed: sorted.length ? sorted[sorted.length - 1] : null,
    streak_unit: frequency === 'weekly' ? 'week' : 'day',
  };
  if (sorted.length === 0) return result;

  let run = 0;
  let longest = 0;

  if (frequency === 'weekly') {
    const goal = opts.times_per_week || 1;
    const perWeek = new Map();
    for (const d of sorted) perWeek.set(weekStart(d), (perWeek.get(weekStart(d)) || 0) + 1);
    const thisWeek = weekStart(today);
    for (let w = weekStart(sorted[0]); w <= thisWeek; w = addDays(w, 7)) {
      if ((perWeek.get(w) || 0) >= goal) {
        run += 1;
        longest = Math.max(longest, run);
      } else if (w !== thisWeek) {
        run = 0;
      }
    }
  } else {
    const days = frequency === 'days' ? new Set(opts.days_of_week) : null;
    for (let d = sorted[0]; d <= today; d = addDays(d, 1)) {
      if (days && !days.has(dayOfWeek(d))) continue;
      if (done.has(d)) {
        run += 1;
        longest = Math.max(longest, run);
      } else if (d !== today) {
        run = 0;
      }
    }
  }

  result.current_streak = run;
  result.longest_streak = longest;
  return result;
}

module.exports = { computeStreaks };

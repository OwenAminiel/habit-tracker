const { addDays, dayOfWeek, weekStart, daysBetween, eachDay } = require('./dates');
const { computeStreaks } = require('./streak');
const { isRequired } = require('./habits');

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_STREAK_BADGES = [3, 7, 14, 30, 60, 100, 365];
const WEEK_STREAK_BADGES = [2, 4, 8, 12, 26, 52];
const TOTAL_BADGES = [1, 10, 25, 50, 100, 250, 500];

const createdDay = (habit) => new Date(habit.created_at).toISOString().slice(0, 10);

/** The first day the habit could have been done: its creation day, or an earlier day if past check-ins were logged. */
function startDay(habit, sortedDone, today) {
  let start = createdDay(habit);
  if (sortedDone.length && sortedDone[0] < start) start = sortedDone[0];
  return start > today ? today : start;
}

/**
 * Percent of expected check-ins that happened in the last `windowDays` days (or since the habit began).
 * For weekly goals, the goal is scaled to the length of the window. Returns null when nothing was expected yet.
 */
function completionRate(habit, done, start, today, windowDays) {
  const from = start > addDays(today, -(windowDays - 1)) ? start : addDays(today, -(windowDays - 1));

  if (habit.frequency === 'weekly') {
    const expected = (habit.times_per_week * (daysBetween(from, today) + 1)) / 7;
    if (expected <= 0) return null;
    const count = eachDay(from, today).filter((d) => done.has(d)).length;
    return Math.min(100, Math.round((100 * count) / expected));
  }

  // Today is still in progress, so it only counts once it has been done.
  const to = isRequired(habit, today) && !done.has(today) ? addDays(today, -1) : today;
  if (from > to) return null;
  let expected = 0;
  let got = 0;
  for (const d of eachDay(from, to)) {
    if (!isRequired(habit, d)) continue;
    expected += 1;
    if (done.has(d)) got += 1;
  }
  return expected ? Math.round((100 * got) / expected) : null;
}

const weeklyGoal = (habit) => (habit.frequency === 'weekly' ? habit.times_per_week : habit.frequency === 'days' ? habit.days_of_week.length : 7);

/** The last 8 weeks (Sunday to Saturday), oldest first. */
function weeklyHistory(habit, done, today) {
  const thisWeek = weekStart(today);
  const goal = weeklyGoal(habit);
  return Array.from({ length: 8 }, (_, i) => {
    const start = addDays(thisWeek, -7 * (7 - i));
    const completed = eachDay(start, addDays(start, 6)).filter((d) => done.has(d) && (habit.frequency !== 'days' || isRequired(habit, d))).length;
    return { week_start: start, completed, goal, met: completed >= goal, current: start === thisWeek };
  });
}

function milestones(habit, streaks) {
  const unit = streaks.streak_unit;
  const streakList = (unit === 'week' ? WEEK_STREAK_BADGES : DAY_STREAK_BADGES).map((n) => ({
    key: `streak-${n}`,
    label: `${n}-${unit} streak`,
    achieved: streaks.longest_streak >= n,
  }));
  const totalList = TOTAL_BADGES.map((n) => ({
    key: `total-${n}`,
    label: n === 1 ? 'First check-in' : `${n} check-ins`,
    achieved: streaks.total_completed >= n,
  }));
  return [...streakList, ...totalList];
}

/** Everything the stats endpoints and the dashboard need to know about one habit. */
function habitStats(habit, doneDates, today) {
  const done = new Set(doneDates);
  const sorted = [...done].sort();
  const start = startDay(habit, sorted, today);
  const streaks = computeStreaks(sorted, { today, frequency: habit.frequency, days_of_week: habit.days_of_week, times_per_week: habit.times_per_week });

  const byWeekday = WEEKDAY_NAMES.map((name, day) => ({ day, name, completed: 0 }));
  for (const d of sorted) byWeekday[dayOfWeek(d)].completed += 1;

  return {
    ...streaks,
    started_on: start,
    completion_rate: {
      days_7: completionRate(habit, done, start, today, 7),
      days_30: completionRate(habit, done, start, today, 30),
      days_90: completionRate(habit, done, start, today, 90),
    },
    by_weekday: byWeekday,
    weekly_history: weeklyHistory(habit, done, today),
    milestones: milestones(habit, streaks),
  };
}

module.exports = { habitStats, completionRate, startDay, WEEKDAY_NAMES };

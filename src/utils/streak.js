const DAY_MS = 86400000;
const dayNumber = (isoDate) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);

/**
 * Compute current and longest streaks from completed dates ('YYYY-MM-DD').
 * A current streak stays alive if today has not been logged yet but yesterday was.
 */
function computeStreaks(completedDates, today = new Date().toISOString().slice(0, 10)) {
  const days = [...new Set(completedDates)].map(dayNumber).sort((a, b) => a - b);
  if (days.length === 0) {
    return { current_streak: 0, longest_streak: 0, total_completed: 0, last_completed: null };
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i] === days[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const set = new Set(days);
  let cursor = dayNumber(today);
  if (!set.has(cursor)) cursor -= 1;
  let current = 0;
  while (set.has(cursor)) {
    current += 1;
    cursor -= 1;
  }

  const lastDay = new Date(days[days.length - 1] * DAY_MS).toISOString().slice(0, 10);
  return {
    current_streak: current,
    longest_streak: longest,
    total_completed: days.length,
    last_completed: lastDay,
  };
}

module.exports = { computeStreaks };

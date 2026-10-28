const db = require('../db');

/** The user's habits (newest last) plus a Map of habit id -> dates it was completed. */
async function loadHabitsWithDone(userId, { archived = false } = {}) {
  const { rows: habits } = await db.query(
    `SELECT * FROM habits WHERE user_id = $1 AND (archived_at IS NOT NULL) = $2 ORDER BY created_at ASC, id ASC`,
    [userId, archived]
  );
  const { rows: entries } = await db.query(
    `SELECT e.habit_id, e.entry_date FROM entries e
     JOIN habits h ON h.id = e.habit_id
     WHERE h.user_id = $1 AND (h.archived_at IS NOT NULL) = $2 AND e.completed = TRUE
     ORDER BY e.entry_date`,
    [userId, archived]
  );
  const done = new Map(habits.map((h) => [h.id, []]));
  for (const e of entries) done.get(e.habit_id).push(e.entry_date);
  return { habits, done };
}

module.exports = { loadHabitsWithDone };

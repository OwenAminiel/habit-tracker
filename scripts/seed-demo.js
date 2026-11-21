// Creates a demo account with realistic habits and 10 weeks of history, for demos and screenshots.
//   npm run seed:demo
// Login: demo@example.com / demo-password-123   (re-running resets that account's data)
//
// To fill an account you already have instead (keeps its email and password, DELETES all of its current habits):
//   PowerShell:  $env:SEED_EMAIL="you@example.com"; npm run seed:demo
//   bash:        SEED_EMAIL=you@example.com npm run seed:demo
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { migrate } = require('../src/migrate');
const { utcToday, addDays, dayOfWeek } = require('../src/utils/dates');

const EMAIL = (process.env.SEED_EMAIL || 'demo@example.com').trim().toLowerCase();
const CUSTOM = Boolean(process.env.SEED_EMAIL);
const PASSWORD = 'demo-password-123';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusing to seed in production. Set ALLOW_DEMO_SEED=true if you really mean it.');
  process.exit(1);
}

// Small deterministic random generator so the demo looks the same every time.
let seed = 42;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

const HABITS = [
  { name: 'Read for 20 minutes', description: 'Evenings, before bed', category: 'Study', frequency: 'daily', chance: (age) => (age < 14 ? 0.95 : 0.72) },
  { name: 'Gym', description: 'Push, pull, legs', category: 'Health', frequency: 'days', days: [1, 3, 5], chance: () => 0.85, onlyDays: true },
  { name: 'Run', description: '', category: 'Health', frequency: 'weekly', times: 3, chance: () => 0.42 },
  { name: 'Practice Swahili', description: 'Flashcards on the bus', category: 'Study', frequency: 'daily', chance: (age) => (age < 5 ? 1 : 0.55) },
  { name: 'Drink water', description: 'Keep a bottle at your desk', category: 'Health', frequency: 'daily', target: 8, unit: 'glasses', chance: () => 0.8 },
  { name: 'Old journaling habit', description: 'Archived example', frequency: 'daily', chance: () => 0.5, archived: true },
];
const NOTES = ['Felt great', 'Short session', 'Finished a chapter', 'Tired but did it', ''];

(async () => {
  await migrate(pool);
  let userId;
  const existing = CUSTOM ? await pool.query('SELECT id FROM users WHERE email = $1', [EMAIL]) : { rows: [] };
  if (existing.rows[0]) {
    // Your own account: keep the user and password, replace only the habits (entries go with them).
    userId = existing.rows[0].id;
    await pool.query('DELETE FROM habits WHERE user_id = $1', [userId]);
  } else {
    await pool.query('DELETE FROM users WHERE email = $1', [EMAIL]);
    const user = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [EMAIL, await bcrypt.hash(PASSWORD, 10)]);
    userId = user.rows[0].id;
  }
  const today = utcToday();
  let entries = 0;

  for (const h of HABITS) {
    const created = `${addDays(today, -70)}T12:00:00Z`;
    const res = await pool.query(
      `INSERT INTO habits (user_id, name, description, category, target, unit, frequency, days_of_week, times_per_week, archived_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [userId, h.name, h.description, h.category || null, h.target || null, h.unit || null, h.frequency, h.days || null, h.times || null, h.archived ? new Date() : null, created]
    );
    for (let age = 69; age >= 0; age--) {
      const date = addDays(today, -age);
      if (h.onlyDays && !h.days.includes(dayOfWeek(date))) continue;
      if (rnd() > h.chance(age)) continue;
      // Habits with a goal get a realistic amount: usually the target or a bit over.
      const value = h.target ? Math.max(1, Math.round(h.target * (0.85 + rnd() * 0.45))) : null;
      await pool.query('INSERT INTO entries (habit_id, entry_date, completed, note, value) VALUES ($1,$2,$3,$4,$5)', [res.rows[0].id, date, h.target ? value >= h.target : true, NOTES[Math.floor(rnd() * NOTES.length)], value]);
      entries++;
    }
  }
  console.log(existing.rows[0]
    ? `Filled ${EMAIL} with ${HABITS.length} habits and ${entries} check-ins. Its password is unchanged.`
    : `Demo account ready: ${EMAIL} / ${PASSWORD} (${HABITS.length} habits, ${entries} check-ins)`);
  await pool.end();
})().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});

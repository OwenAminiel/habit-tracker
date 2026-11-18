// Creates a demo account with realistic habits and 10 weeks of history, for demos and screenshots.
//   npm run seed:demo
// Login: demo@example.com / demo-password-123   (re-running resets that account's data)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { migrate } = require('../src/migrate');
const { utcToday, addDays, dayOfWeek } = require('../src/utils/dates');

const EMAIL = 'demo@example.com';
const PASSWORD = 'demo-password-123';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusing to seed in production. Set ALLOW_DEMO_SEED=true if you really mean it.');
  process.exit(1);
}

// Small deterministic random generator so the demo looks the same every time.
let seed = 42;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

const HABITS = [
  { name: 'Read for 20 minutes', description: 'Evenings, before bed', frequency: 'daily', chance: (age) => (age < 14 ? 0.95 : 0.72) },
  { name: 'Gym', description: 'Push, pull, legs', frequency: 'days', days: [1, 3, 5], chance: () => 0.85, onlyDays: true },
  { name: 'Run', description: '', frequency: 'weekly', times: 3, chance: () => 0.42 },
  { name: 'Practice Swahili', description: 'Flashcards on the bus', frequency: 'daily', chance: (age) => (age < 5 ? 1 : 0.55) },
  { name: 'Old journaling habit', description: 'Archived example', frequency: 'daily', chance: () => 0.5, archived: true },
];
const NOTES = ['Felt great', 'Short session', 'Finished a chapter', 'Tired but did it', ''];

(async () => {
  await migrate(pool);
  await pool.query('DELETE FROM users WHERE email = $1', [EMAIL]);
  const user = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [EMAIL, await bcrypt.hash(PASSWORD, 10)]);
  const userId = user.rows[0].id;
  const today = utcToday();
  let entries = 0;

  for (const h of HABITS) {
    const created = `${addDays(today, -70)}T12:00:00Z`;
    const res = await pool.query(
      `INSERT INTO habits (user_id, name, description, frequency, days_of_week, times_per_week, archived_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [userId, h.name, h.description, h.frequency, h.days || null, h.times || null, h.archived ? new Date() : null, created]
    );
    for (let age = 69; age >= 0; age--) {
      const date = addDays(today, -age);
      if (h.onlyDays && !h.days.includes(dayOfWeek(date))) continue;
      if (rnd() > h.chance(age)) continue;
      await pool.query('INSERT INTO entries (habit_id, entry_date, completed, note) VALUES ($1,$2,true,$3)', [res.rows[0].id, date, NOTES[Math.floor(rnd() * NOTES.length)]]);
      entries++;
    }
  }
  console.log(`Demo account ready: ${EMAIL} / ${PASSWORD} (${HABITS.length} habits, ${entries} check-ins)`);
  await pool.end();
})().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});

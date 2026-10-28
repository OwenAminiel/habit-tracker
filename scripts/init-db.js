// Applies any database migrations that have not been applied yet (safe to run as often as you like).
require('dotenv').config();
const { pool } = require('../src/db');
const { migrate } = require('../src/migrate');

(async () => {
  const applied = await migrate(pool);
  console.log(applied.length ? 'Database schema is ready.' : 'Database schema is already up to date.');
  await pool.end();
})().catch((err) => {
  console.error('Failed to update the database:', err.message);
  process.exit(1);
});

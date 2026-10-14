require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Database schema is ready.');
  await pool.end();
})().catch((err) => {
  console.error('Failed to initialise database:', err.message);
  process.exit(1);
});

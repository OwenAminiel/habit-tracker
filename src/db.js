const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings (avoids timezone shifts).
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'migrations');
const LOCK_ID = 727274; // arbitrary number shared by every process that migrates this database

const migrationFiles = () => fs.readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

// `db` is anything with a .query() method: a pool or a single client.
async function ensureTable(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

/** Names of migration files that have not been applied to this database yet. */
async function pending(db) {
  await ensureTable(db);
  const { rows } = await db.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  return migrationFiles().filter((f) => !done.has(f));
}

/**
 * Apply every pending migration, each in its own transaction. Returns the names applied.
 * A database lock makes it safe if two processes (for example parallel test files) migrate at the same time.
 */
async function migrate(pool, log = console.log) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    const todo = await pending(client);
    for (const name of todo) {
      const sql = fs.readFileSync(path.join(DIR, name), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        log(`Applied ${name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${err.message}`);
      }
    }
    return todo;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { pending, migrate };

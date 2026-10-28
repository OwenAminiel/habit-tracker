const { loadConfig } = require('./config');

const { config, problems, warnings } = loadConfig();
warnings.forEach((w) => console.warn(`Warning: ${w}`));
if (problems.length) {
  console.error('The server can’t start. Fix these in your .env file:');
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

const app = require('./app');
const { pool } = require('./db');
const { pending } = require('./migrate');

(async () => {
  try {
    const todo = await pending(pool);
    if (todo.length) {
      console.error(`The database needs ${todo.length} update(s): ${todo.join(', ')}\nRun this once, then start the server again:\n  npm run db:init`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Can’t reach the database: ${err.message}\nCheck DATABASE_URL and DATABASE_SSL in your .env file.`);
    process.exit(1);
  }

  const port = config.PORT;
  const server = app.listen(port, () => console.log(`Habit Tracker listening on http://localhost:${port}  (API docs: http://localhost:${port}/docs)`));

  server.on('error', (err) => {
    console.error(
      err.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Close the other server, or start this one on another port (PORT=${port + 1}).`
        : `Server error: ${err.message}`
    );
    process.exit(1);
  });

  // Say why the server stops, so a silent exit never looks like a hang.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      console.log(`Received ${signal}. Shutting down.`);
      server.close(() => pool.end().finally(() => process.exit(0)));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
  process.on('exit', (code) => console.log(`Server process ended (exit code ${code}).`));
})();

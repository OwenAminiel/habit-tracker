const app = require('./app');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const secret = process.env.JWT_SECRET;
if (secret.startsWith('replace-with') || secret.length < 16) {
  const hosted = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;
  console.warn('JWT_SECRET is a placeholder or too short. Generate a real one (see README).');
  if (hosted) process.exit(1);
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Habit Tracker API listening on port ${port}`));

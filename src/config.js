require('dotenv').config();
const { z } = require('zod');

const schema = z.object({
  PORT: z.coerce.number({ invalid_type_error: 'PORT must be a number from 1 to 65535.' }).int().min(1, 'PORT must be a number from 1 to 65535.').max(65535, 'PORT must be a number from 1 to 65535.').default(3000),
  DATABASE_URL: z.string({ required_error: 'DATABASE_URL is missing. Add it to your .env file.' }).min(1, 'DATABASE_URL is empty.'),
  DATABASE_SSL: z.enum(['true', 'false'], { errorMap: () => ({ message: 'DATABASE_SSL must be true or false.' }) }).default('false'),
  JWT_SECRET: z.string({ required_error: 'JWT_SECRET is missing. Add it to your .env file.' }).min(16, 'JWT_SECRET must be at least 16 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'),
  JWT_EXPIRES_IN: z.string().default('7d'),
});

/** Check the environment once at startup so mistakes produce a clear message instead of a confusing crash later. */
function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  const problems = result.success ? [] : result.error.issues.map((i) => i.message);
  const secret = env.JWT_SECRET || '';
  const placeholder = secret.startsWith('replace-with');
  const hosted = env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT) || Boolean(env.RENDER);
  const warnings = [];
  if (placeholder) {
    const msg = 'JWT_SECRET is still the placeholder from .env.example. Generate a real one (see README).';
    if (hosted) problems.push(msg);
    else warnings.push(msg);
  }
  return { config: result.success ? result.data : null, problems, warnings };
}

module.exports = { loadConfig };

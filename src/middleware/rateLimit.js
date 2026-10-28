const rateLimit = require('express-rate-limit');

const MINUTE = 60 * 1000;

const handler = (req, res) =>
  res.status(429).json({ error: { message: 'Too many requests. Wait a few minutes and try again.', request_id: req.id } });

// Tests make hundreds of requests from one address, so limits are off unless a test turns them on explicitly.
const make = (options) =>
  rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler,
    skip: () => process.env.NODE_ENV === 'test',
    ...options,
  });

module.exports = {
  make,
  // Everything under /api
  apiLimiter: make({ windowMs: 15 * MINUTE, limit: 1000 }),
  // Failed log-ins only: a person typing their own password correctly is never slowed down.
  loginLimiter: make({ windowMs: 15 * MINUTE, limit: 10, skipSuccessfulRequests: true }),
  registerLimiter: make({ windowMs: 60 * MINUTE, limit: 20 }),
  // Password changes and account deletion (both re-check the password)
  sensitiveLimiter: make({ windowMs: 15 * MINUTE, limit: 10, skipSuccessfulRequests: true }),
};

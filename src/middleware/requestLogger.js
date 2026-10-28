const crypto = require('crypto');

/**
 * Gives every request an id (returned in the X-Request-Id header and in error bodies) and logs one line per request.
 * Only the path is logged, never the query string or body, so emails and passwords never reach the logs.
 */
function requestLogger(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);

  if (process.env.NODE_ENV === 'test' || process.env.LOG_REQUESTS === 'false') return next();

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
    const entry = { time: new Date().toISOString(), id: req.id, method: req.method, path: req.path, status: res.statusCode, ms };
    console.log(process.env.NODE_ENV === 'production' ? JSON.stringify(entry) : `${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
}

module.exports = { requestLogger };

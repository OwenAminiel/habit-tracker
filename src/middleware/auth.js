const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errors');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'Authentication required. Send "Authorization: Bearer <token>".'));
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub };
    next();
  } catch {
    next(new AppError(401, 'Invalid or expired token.'));
  }
}

module.exports = { requireAuth };

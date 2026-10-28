const jwt = require('jsonwebtoken');
const db = require('../db');
const { AppError } = require('../utils/errors');

/**
 * Requires "Authorization: Bearer <token>". Besides checking the signature, it compares the token's version with the
 * user's current token_version, so changing a password or choosing "log out everywhere" ends every older session.
 */
async function requireAuth(req, res, next) {
  try {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppError(401, 'Authentication required. Send "Authorization: Bearer <token>".');
    }
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new AppError(401, 'Invalid or expired token.');
    }
    const { rows } = await db.query('SELECT id, token_version FROM users WHERE id = $1', [payload.sub]);
    if (!rows[0] || rows[0].token_version !== (payload.ver ?? 0)) {
      throw new AppError(401, 'This session has ended. Log in again.');
    }
    req.user = { id: rows[0].id };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };

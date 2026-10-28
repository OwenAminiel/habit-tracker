const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, registerLimiter, sensitiveLimiter } = require('../middleware/rateLimit');
const { AppError, asyncHandler } = require('../utils/errors');

const router = express.Router();

const email = z.string().trim().toLowerCase().email('Must be a valid email address.').max(254);
const newPassword = z.string().min(8, 'Password must be at least 8 characters.').max(72, 'Password must be at most 72 characters.');
const credentials = z.object({ email, password: newPassword });
const loginBody = z.object({ email, password: z.string().min(1, 'Password is required.').max(72) });
const changePasswordBody = z.object({ current_password: z.string().min(1, 'Current password is required.').max(72), new_password: newPassword });
const confirmBody = z.object({ password: z.string().min(1, 'Password is required.').max(72) });

const signToken = (user) =>
  jwt.sign({ sub: user.id, ver: user.token_version }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const publicUser = (u) => ({ id: u.id, email: u.email, created_at: u.created_at });

router.post(
  '/register',
  registerLimiter,
  validate(credentials),
  asyncHandler(async (req, res) => {
    const { email: address, password } = req.body;
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [address]);
    if (existing.rowCount > 0) throw new AppError(409, 'An account with that email already exists.');

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at, token_version',
      [address, hash]
    );
    res.status(201).json({ user: publicUser(rows[0]), token: signToken(rows[0]) });
  })
);

router.post(
  '/login',
  loginLimiter,
  validate(loginBody),
  asyncHandler(async (req, res) => {
    const { email: address, password } = req.body;
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [address]);
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) throw new AppError(401, 'Invalid email or password.');
    res.json({ user: publicUser(user), token: signToken(user) });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT id, email, created_at FROM users WHERE id = $1', [req.user.id]);
    res.json({ user: rows[0] });
  })
);

// Change password. Every other session is signed out; the response carries a fresh token for this one.
router.put(
  '/password',
  requireAuth,
  sensitiveLimiter,
  validate(changePasswordBody),
  asyncHandler(async (req, res) => {
    const { current_password: current, new_password: next } = req.body;
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(current, rows[0].password_hash))) throw new AppError(403, 'Current password is incorrect.');
    if (current === next) throw new AppError(400, 'Choose a new password that is different from the current one.');

    const hash = await bcrypt.hash(next, 10);
    const updated = await db.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, token_version',
      [hash, req.user.id]
    );
    res.json({ message: 'Password changed. Other sessions were signed out.', token: signToken(updated.rows[0]) });
  })
);

// Sign out of every device, including this one.
router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    res.status(204).end();
  })
);

// Permanently delete the account and everything in it. Requires the password.
router.delete(
  '/me',
  requireAuth,
  sensitiveLimiter,
  validate(confirmBody),
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(req.body.password, rows[0].password_hash))) throw new AppError(403, 'Password is incorrect.');
    await db.query('DELETE FROM users WHERE id = $1', [req.user.id]);
    res.status(204).end();
  })
);

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../utils/errors');

const router = express.Router();

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Must be a valid email address.').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(72),
});

const signToken = (userId) =>
  jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

router.post(
  '/register',
  validate(credentials),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) throw new AppError(409, 'An account with that email already exists.');

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email, hash]
    );
    res.status(201).json({ user: rows[0], token: signToken(rows[0].id) });
  })
);

router.post(
  '/login',
  validate(credentials),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) throw new AppError(401, 'Invalid email or password.');
    res.json({
      user: { id: user.id, email: user.email, created_at: user.created_at },
      token: signToken(user.id),
    });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT id, email, created_at FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) throw new AppError(401, 'Account no longer exists.');
    res.json({ user: rows[0] });
  })
);

module.exports = router;

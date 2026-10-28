const { z } = require('zod');

const DAY_MS = 86400000;

const utcToday = () => new Date().toISOString().slice(0, 10);

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// A real calendar date in YYYY-MM-DD form (rejects things like 2026-02-31).
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }, 'Not a valid calendar date.');

module.exports = { utcToday, addDays, isoDate };

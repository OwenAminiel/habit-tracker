const { z } = require('zod');

const DAY_MS = 86400000;
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);

const utcToday = () => new Date().toISOString().slice(0, 10);

const addDays = (iso, n) => new Date(toMs(iso) + n * DAY_MS).toISOString().slice(0, 10);

/** 0 = Sunday ... 6 = Saturday */
const dayOfWeek = (iso) => new Date(toMs(iso)).getUTCDay();

/** The Sunday that starts the week containing this date. Weeks run Sunday to Saturday everywhere in this app. */
const weekStart = (iso) => addDays(iso, -dayOfWeek(iso));

const daysBetween = (from, to) => Math.round((toMs(to) - toMs(from)) / DAY_MS);

const eachDay = (from, to) => {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
};

// A real calendar date in YYYY-MM-DD form (rejects things like 2026-02-31).
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }, 'Not a valid calendar date.');

module.exports = { utcToday, addDays, dayOfWeek, weekStart, daysBetween, eachDay, isoDate };

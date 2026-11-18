const { z } = require('zod');
const { dayOfWeek } = require('./dates');
const { AppError } = require('./errors');

const FREQUENCIES = ['daily', 'days', 'weekly'];

/** How a habit looks in API responses. */
const habitJson = (h) => ({
  id: h.id,
  name: h.name,
  description: h.description,
  frequency: h.frequency,
  category: h.category ?? null,
  target: h.target ?? null,
  unit: h.target != null ? h.unit ?? null : null,
  days_of_week: h.frequency === 'days' ? h.days_of_week : null,
  times_per_week: h.frequency === 'weekly' ? h.times_per_week : null,
  archived: h.archived_at != null,
  archived_at: h.archived_at,
  created_at: h.created_at,
  updated_at: h.updated_at,
});

/** Does the habit's schedule call for a check-in on this date? (Weekly-goal habits can be done on any day.) */
const isRequired = (habit, date) =>
  habit.frequency === 'daily' || (habit.frequency === 'days' && habit.days_of_week.includes(dayOfWeek(date)));

const scheduleFields = {
  frequency: z.enum(FREQUENCIES, { errorMap: () => ({ message: 'Frequency must be "daily", "days" or "weekly".' }) }),
  days_of_week: z
    .array(z.number().int().min(0, 'Days must be 0 (Sunday) to 6 (Saturday).').max(6, 'Days must be 0 (Sunday) to 6 (Saturday).'))
    .min(1, 'Choose at least one day.')
    .max(7),
  times_per_week: z.number().int('Times per week must be a whole number.').min(1, 'Times per week must be 1 to 7.').max(7, 'Times per week must be 1 to 7.'),
};

/**
 * Work out the schedule a habit will have after a create or update.
 * `existing` is the current habit row (null when creating); `input` is the request body.
 */
function resolveSchedule(existing, input) {
  const frequency = input.frequency ?? (existing ? existing.frequency : 'daily');
  const problems = [];
  let days = null;
  let times = null;

  if (frequency === 'days') {
    const given = input.days_of_week ?? (existing && existing.frequency === 'days' ? existing.days_of_week : null);
    if (!given) problems.push({ field: 'days_of_week', message: 'Choose which days of the week (0 = Sunday ... 6 = Saturday).' });
    else days = [...new Set(given)].sort((a, b) => a - b);
  }
  if (frequency === 'weekly') {
    const given = input.times_per_week ?? (existing && existing.frequency === 'weekly' ? existing.times_per_week : null);
    if (!given) problems.push({ field: 'times_per_week', message: 'Say how many times a week (1 to 7).' });
    else times = given;
  }
  if (problems.length) throw new AppError(400, 'Validation failed.', problems);
  return { frequency, days_of_week: days, times_per_week: times };
}

// A short optional label. Blank means "no category".
const categoryField = z
  .string()
  .trim()
  .max(30, 'Category must be 30 characters or fewer.')
  .transform((v) => (v === '' ? null : v))
  .nullable();

// A numeric daily goal: how much counts as "done" (target) and what it is measured in (unit).
const goalFields = {
  target: z
    .number({ invalid_type_error: 'Target must be a number.' })
    .positive('Target must be greater than zero.')
    .max(1000000, 'Target must be 1,000,000 or less.')
    .nullable(),
  unit: z
    .string()
    .trim()
    .max(20, 'Unit must be 20 characters or fewer.')
    .transform((v) => (v === '' ? null : v))
    .nullable(),
};

/** The goal a habit will have after a create or update. Clearing the target also clears the unit. */
function resolveGoal(existing, input) {
  const target = 'target' in input ? input.target : existing ? existing.target : null;
  let unit = 'unit' in input ? input.unit : existing ? existing.unit : null;
  if (target == null) unit = null;
  return { target: target ?? null, unit: unit ?? null };
}

module.exports = { goalFields, resolveGoal, categoryField, FREQUENCIES, scheduleFields, habitJson, isRequired, resolveSchedule };

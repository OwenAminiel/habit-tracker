const { z } = require('zod');

/** Query-string schema for ?page= and ?limit=. */
const pageParams = (defaultLimit = 20, maxLimit = 100) => ({
  page: z.coerce.number({ invalid_type_error: 'page must be a number.' }).int('page must be a whole number.').min(1, 'page must be 1 or more.').default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'limit must be a number.' })
    .int('limit must be a whole number.')
    .min(1, 'limit must be 1 or more.')
    .max(maxLimit, `limit must be ${maxLimit} or less.`)
    .default(defaultLimit),
});

const pagination = (page, limit, total) => ({ page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) });

module.exports = { pageParams, pagination };

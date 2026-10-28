// OpenAPI 3 description of the API. Served as JSON at /openapi.json and as an interactive page at /docs.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const resp = (description, schema) => (schema ? { description, content: json(schema) } : { description });
const errorRef = (description) => ({ description, content: json(ref('Error')) });
const secured = [{ bearerAuth: [] }];

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 }, description: 'Habit id.' };
const todayParam = {
  name: 'today',
  in: 'query',
  schema: { type: 'string', format: 'date' },
  description: "The caller's local date (YYYY-MM-DD). Defaults to the server's UTC date.",
};
const page = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];
const orderParam = (def) => ({ name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: def } });

const common = {
  400: errorRef('Validation failed or the request is malformed.'),
  401: errorRef('Missing, invalid, expired or revoked token.'),
  404: errorRef('Not found (including resources that belong to another user).'),
};
const pick = (...codes) => Object.fromEntries(codes.map((c) => [c, common[c]]));

const habitScheduleProps = {
  frequency: { type: 'string', enum: ['daily', 'days', 'weekly'], description: 'daily = every day; days = chosen weekdays; weekly = N times per week.' },
  days_of_week: { type: 'array', nullable: true, items: { type: 'integer', minimum: 0, maximum: 6 }, description: '0 = Sunday ... 6 = Saturday. Required when frequency is "days".' },
  times_per_week: { type: 'integer', nullable: true, minimum: 1, maximum: 7, description: 'Required when frequency is "weekly". Weeks run Sunday to Saturday.' },
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Habit Tracker API',
    version: '2.0.0',
    description:
      'Create habits with schedules, record daily progress, and view streaks, statistics and exports.\n\n' +
      '**Authentication:** call `POST /api/auth/register` or `POST /api/auth/login`, then choose **Authorize** and paste the token.\n\n' +
      '**Errors** always look like `{"error": {"message": "...", "details": [...], "request_id": "..."}}`.\n\n' +
      '**Dates** are `YYYY-MM-DD`. Clients send their local date as `today` so streaks respect their time zone.',
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'Auth', description: 'Accounts and sessions' },
    { name: 'Habits', description: 'Create, list, update, archive and delete habits' },
    { name: 'Entries', description: 'Daily check-ins for a habit' },
    { name: 'Stats', description: 'Streaks, completion rates and overview' },
    { name: 'Export', description: 'Download your data' },
    { name: 'System', description: 'Health check' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              message: { type: 'string', example: 'Validation failed.' },
              details: {
                type: 'array',
                items: { type: 'object', properties: { field: { type: 'string', example: 'name' }, message: { type: 'string', example: 'Name is required.' } } },
              },
              request_id: { type: 'string' },
            },
            required: ['message'],
          },
        },
      },
      User: {
        type: 'object',
        properties: { id: { type: 'integer' }, email: { type: 'string', format: 'email' }, created_at: { type: 'string', format: 'date-time' } },
      },
      AuthResult: { type: 'object', properties: { user: ref('User'), token: { type: 'string' } } },
      Credentials: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8, maxLength: 72 } },
      },
      Habit: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          description: { type: 'string' },
          ...habitScheduleProps,
          archived: { type: 'boolean' },
          archived_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      HabitInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
          ...habitScheduleProps,
        },
        example: { name: 'Gym', frequency: 'days', days_of_week: [1, 3, 5] },
      },
      HabitUpdate: {
        type: 'object',
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
          ...habitScheduleProps,
        },
      },
      Pagination: {
        type: 'object',
        properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, total_pages: { type: 'integer' } },
      },
      Entry: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          habit_id: { type: 'integer' },
          entry_date: { type: 'string', format: 'date' },
          completed: { type: 'boolean' },
          note: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      EntryInput: {
        type: 'object',
        properties: {
          entry_date: { type: 'string', format: 'date', description: 'Defaults to today. Not more than one day ahead of UTC.' },
          completed: { type: 'boolean', default: true },
          note: { type: 'string', maxLength: 500 },
        },
      },
      Streak: {
        type: 'object',
        properties: {
          habit_id: { type: 'integer' },
          current_streak: { type: 'integer' },
          longest_streak: { type: 'integer' },
          total_completed: { type: 'integer' },
          last_completed: { type: 'string', format: 'date', nullable: true },
          streak_unit: { type: 'string', enum: ['day', 'week'] },
        },
      },
      Milestone: {
        type: 'object',
        properties: { key: { type: 'string', example: 'streak-7' }, label: { type: 'string' }, achieved: { type: 'boolean' } },
      },
      HabitStats: {
        type: 'object',
        properties: {
          habit_id: { type: 'integer' },
          current_streak: { type: 'integer' },
          longest_streak: { type: 'integer' },
          total_completed: { type: 'integer' },
          last_completed: { type: 'string', format: 'date', nullable: true },
          streak_unit: { type: 'string', enum: ['day', 'week'] },
          started_on: { type: 'string', format: 'date' },
          completion_rate: {
            type: 'object',
            description: 'Percentages (0-100), or null when nothing was expected yet.',
            properties: { days_7: { type: 'integer', nullable: true }, days_30: { type: 'integer', nullable: true }, days_90: { type: 'integer', nullable: true } },
          },
          by_weekday: {
            type: 'array',
            items: { type: 'object', properties: { day: { type: 'integer', description: '0 = Sunday ... 6 = Saturday' }, name: { type: 'string' }, completed: { type: 'integer' } } },
          },
          weekly_history: {
            type: 'array',
            items: {
              type: 'object',
              properties: { week_start: { type: 'string', format: 'date' }, completed: { type: 'integer' }, goal: { type: 'integer' }, met: { type: 'boolean' }, current: { type: 'boolean' } },
            },
          },
          milestones: { type: 'array', items: ref('Milestone') },
        },
      },
      HabitSummary: {
        allOf: [
          ref('Habit'),
          {
            type: 'object',
            properties: {
              current_streak: { type: 'integer' },
              longest_streak: { type: 'integer' },
              total_completed: { type: 'integer' },
              last_completed: { type: 'string', format: 'date', nullable: true },
              streak_unit: { type: 'string', enum: ['day', 'week'] },
              completion_rate_30: { type: 'integer', nullable: true },
              completed_today: { type: 'boolean' },
              required_today: { type: 'boolean', description: 'False on rest days and for weekly goals.' },
              week_count: { type: 'integer' },
              week_goal: { type: 'integer', nullable: true },
              recent: {
                type: 'array',
                description: 'The last 14 days, oldest first.',
                items: { type: 'object', properties: { date: { type: 'string', format: 'date' }, completed: { type: 'boolean' }, required: { type: 'boolean' } } },
              },
            },
          },
        ],
      },
      Overview: {
        type: 'object',
        properties: {
          today: { type: 'string', format: 'date' },
          active_habits: { type: 'integer' },
          archived_habits: { type: 'integer' },
          checked_in_today: { type: 'integer' },
          checkins_this_week: { type: 'integer' },
          total_checkins: { type: 'integer' },
          completion_rate: { type: 'object', properties: { days_7: { type: 'integer', nullable: true }, days_30: { type: 'integer', nullable: true } } },
          best_current_streak: {
            type: 'object',
            nullable: true,
            properties: { habit_id: { type: 'integer' }, name: { type: 'string' }, streak: { type: 'integer' }, unit: { type: 'string' } },
          },
          by_weekday: { type: 'array', items: { type: 'object', properties: { day: { type: 'integer', description: '0 = Sunday ... 6 = Saturday' }, name: { type: 'string' }, completed: { type: 'integer' } } } },
          activity: {
            type: 'array',
            description: 'Check-ins per day for the last 12 weeks, oldest first.',
            items: { type: 'object', properties: { date: { type: 'string', format: 'date' }, count: { type: 'integer' } } },
          },
          habits: {
            type: 'array',
            description: 'Active habits, best 30-day completion rate first.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                frequency: { type: 'string', enum: ['daily', 'days', 'weekly'] },
                current_streak: { type: 'integer' },
                longest_streak: { type: 'integer' },
                streak_unit: { type: 'string', enum: ['day', 'week'] },
                total_completed: { type: 'integer' },
                rate_7: { type: 'integer', nullable: true },
                rate_30: { type: 'integer', nullable: true },
              },
            },
          },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: { tags: ['System'], summary: 'Health check', responses: { 200: resp('Server and database are up.', { type: 'object', properties: { status: { type: 'string', example: 'ok' } } }) } },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account',
        requestBody: { required: true, content: json(ref('Credentials')) },
        responses: { 201: resp('Account created.', ref('AuthResult')), 400: common[400], 409: errorRef('Email already registered.'), 429: errorRef('Too many sign-ups from this address.') },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in',
        requestBody: { required: true, content: json(ref('Credentials')) },
        responses: { 200: resp('Logged in.', ref('AuthResult')), 400: common[400], 401: errorRef('Invalid email or password.'), 429: errorRef('Too many failed attempts.') },
      },
    },
    '/api/auth/me': {
      get: { tags: ['Auth'], summary: 'The current user', security: secured, responses: { 200: resp('The user.', { type: 'object', properties: { user: ref('User') } }), 401: common[401] } },
      delete: {
        tags: ['Auth'],
        summary: 'Delete the account and all its data',
        security: secured,
        requestBody: { required: true, content: json({ type: 'object', required: ['password'], properties: { password: { type: 'string' } } }) },
        responses: { 204: resp('Deleted.'), 400: common[400], 401: common[401], 403: errorRef('Wrong password.') },
      },
    },
    '/api/auth/password': {
      put: {
        tags: ['Auth'],
        summary: 'Change password',
        description: 'Signs out every other session and returns a fresh token for this one.',
        security: secured,
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['current_password', 'new_password'],
            properties: { current_password: { type: 'string' }, new_password: { type: 'string', minLength: 8, maxLength: 72 } },
          }),
        },
        responses: { 200: resp('Changed.', { type: 'object', properties: { token: { type: 'string' } } }), 400: common[400], 401: common[401], 403: errorRef('Wrong current password.') },
      },
    },
    '/api/auth/logout-all': {
      post: { tags: ['Auth'], summary: 'Sign out of every device', security: secured, responses: { 204: resp('All tokens revoked.'), 401: common[401] } },
    },
    '/api/habits': {
      get: {
        tags: ['Habits'],
        summary: 'List habits',
        security: secured,
        parameters: [
          ...page,
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['created_at', 'updated_at', 'name'], default: 'created_at' } },
          orderParam('desc'),
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Search names and descriptions (case-insensitive).' },
          { name: 'archived', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'all'], default: 'false' } },
          { name: 'frequency', in: 'query', schema: { type: 'string', enum: ['daily', 'days', 'weekly'] } },
        ],
        responses: {
          200: resp('A page of habits.', { type: 'object', properties: { habits: { type: 'array', items: ref('Habit') }, pagination: ref('Pagination') } }),
          ...pick(400, 401),
        },
      },
      post: {
        tags: ['Habits'],
        summary: 'Create a habit',
        security: secured,
        requestBody: { required: true, content: json(ref('HabitInput')) },
        responses: { 201: resp('Created.', { type: 'object', properties: { habit: ref('Habit') } }), ...pick(400, 401) },
      },
    },
    '/api/habits/summary': {
      get: {
        tags: ['Habits'],
        summary: 'Dashboard: every active habit with streaks and the last 14 days',
        security: secured,
        parameters: [todayParam],
        responses: { 200: resp('Summary.', { type: 'object', properties: { today: { type: 'string', format: 'date' }, habits: { type: 'array', items: ref('HabitSummary') } } }), ...pick(400, 401) },
      },
    },
    '/api/habits/{id}': {
      parameters: [idParam],
      get: { tags: ['Habits'], summary: 'Get one habit', security: secured, responses: { 200: resp('The habit.', { type: 'object', properties: { habit: ref('Habit') } }), ...pick(400, 401, 404) } },
      put: {
        tags: ['Habits'],
        summary: 'Update a habit',
        security: secured,
        requestBody: { required: true, content: json(ref('HabitUpdate')) },
        responses: { 200: resp('Updated.', { type: 'object', properties: { habit: ref('Habit') } }), ...pick(400, 401, 404) },
      },
      delete: { tags: ['Habits'], summary: 'Delete a habit and its entries', security: secured, responses: { 204: resp('Deleted.'), ...pick(400, 401, 404) } },
    },
    '/api/habits/{id}/archive': {
      parameters: [idParam],
      post: {
        tags: ['Habits'],
        summary: 'Archive a habit',
        description: 'Hides it from the dashboard and blocks new check-ins. History is kept. Safe to repeat.',
        security: secured,
        responses: { 200: resp('Archived.', { type: 'object', properties: { habit: ref('Habit') } }), ...pick(401, 404) },
      },
    },
    '/api/habits/{id}/restore': {
      parameters: [idParam],
      post: { tags: ['Habits'], summary: 'Restore an archived habit', security: secured, responses: { 200: resp('Restored.', { type: 'object', properties: { habit: ref('Habit') } }), ...pick(401, 404) } },
    },
    '/api/habits/{id}/entries': {
      parameters: [idParam],
      post: {
        tags: ['Entries'],
        summary: 'Record a day',
        description: 'Posting a date that already exists updates it.',
        security: secured,
        requestBody: { content: json(ref('EntryInput')) },
        responses: {
          200: resp('Existing entry updated.', { type: 'object', properties: { entry: ref('Entry') } }),
          201: resp('Entry created.', { type: 'object', properties: { entry: ref('Entry') } }),
          ...pick(400, 401, 404),
          409: errorRef('The habit is archived.'),
        },
      },
      get: {
        tags: ['Entries'],
        summary: 'Completion history',
        security: secured,
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'completed', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          orderParam('desc'),
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
        ],
        responses: {
          200: resp('A page of entries.', { type: 'object', properties: { entries: { type: 'array', items: ref('Entry') }, pagination: ref('Pagination') } }),
          ...pick(400, 401, 404),
        },
      },
    },
    '/api/habits/{id}/entries/{date}': {
      parameters: [idParam, { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }],
      delete: { tags: ['Entries'], summary: 'Remove one day', security: secured, responses: { 204: resp('Removed.'), ...pick(400, 401, 404), 409: errorRef('The habit is archived.') } },
    },
    '/api/habits/{id}/streak': {
      parameters: [idParam],
      get: { tags: ['Stats'], summary: 'Current and longest streak', security: secured, parameters: [todayParam], responses: { 200: resp('Streak.', ref('Streak')), ...pick(400, 401, 404) } },
    },
    '/api/habits/{id}/stats': {
      parameters: [idParam],
      get: {
        tags: ['Stats'],
        summary: 'Detailed statistics for one habit',
        security: secured,
        parameters: [todayParam],
        responses: { 200: resp('Statistics.', ref('HabitStats')), ...pick(400, 401, 404) },
      },
    },
    '/api/stats/overview': {
      get: { tags: ['Stats'], summary: 'Overview across all habits', security: secured, parameters: [todayParam], responses: { 200: resp('Overview.', ref('Overview')), ...pick(400, 401) } },
    },
    '/api/export': {
      get: {
        tags: ['Export'],
        summary: 'Download all your data',
        description: 'Includes archived habits. CSV cells that look like spreadsheet formulas are defused.',
        security: secured,
        parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'], default: 'json' } }],
        responses: {
          200: {
            description: 'A file download.',
            content: { 'application/json': { schema: { type: 'object' } }, 'text/csv': { schema: { type: 'string' } } },
          },
          ...pick(400, 401),
        },
      },
    },
  },
};

module.exports = spec;

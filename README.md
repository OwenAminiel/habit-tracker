# Habit Tracker

A back-end API and web app for building habits. Create an account, add habits with a schedule (every day, chosen weekdays, or a number of times a week), check in, and see streaks, completion rates, milestones and trends. Each habit's last 14 days show as a chain: consecutive check-ins join into one blue bar, and a missed day breaks it in red.

Built for COMP 4327 Back-end Web Development with Node.js, Express, PostgreSQL, JWT authentication, and Zod validation.

## Features

**API**
- Registration and login with hashed passwords (bcrypt) and signed tokens (JWT); change password, log out of every device, delete account
- Habits with schedules (daily, chosen weekdays, or N times a week), archive and restore
- Daily check-ins with notes; streaks that respect the schedule (day streaks, or week streaks for weekly goals)
- Statistics: completion rates (7, 30, 90 days), best weekdays, weekly history, milestone badges, and an overview across all habits
- Pagination, sorting, search and filters on lists
- Export all data as JSON or CSV (CSV is safe to open in spreadsheets)
- Server-side validation, one error format with a request id, correct status codes
- Rate limiting, security headers, request logging, versioned database migrations
- Interactive API docs at `/docs` (OpenAPI 3), and a Postman collection

**Web app** (white and blue, red for misses and deletes): Today, Insights (12-week heat map, best days, per-habit rates), Settings (password, sessions, export, delete account).

**Quality**: 83 automated tests (unit and API integration), ESLint, and a GitHub Actions workflow that runs both.

## Quick start

You need Node 18 or newer and a PostgreSQL database (local or hosted, for example Supabase).

```bash
npm install
cp .env.example .env     # Windows Command Prompt: copy .env.example .env
```

Edit `.env`: set `DATABASE_URL` and a real `JWT_SECRET`, and set `DATABASE_SSL=true` for hosted databases. Then:

```bash
npm run db:init          # applies database migrations (safe to run again)
npm start                # http://localhost:3000
```

Open <http://localhost:3000> for the web app and <http://localhost:3000/docs> for the API docs. The server refuses to start while a migration is pending and tells you to run `npm run db:init`. `npm run dev` restarts on file changes; if it restarts constantly your project folder is probably inside OneDrive, so use `npm start` or move the folder.

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Upgrading from version 1

Run `npm install` and then `npm run db:init` before `npm start`. Existing habits and check-ins are kept; every existing habit becomes a daily habit. Changes to be aware of: `GET /api/habits` and the entries list now return `{ ..., pagination }`, habit objects no longer include `user_id`, and a wrong password on the password and delete-account confirmations returns 403.

## Using the web app

1. **Create account**, then you land on **Today**.
2. **New habit**: give it a name and choose how often: every day, certain days, or a number of times a week. Select the circle to check in; select it again to undo.
3. A habit on certain days shows a **Rest day** tag on the other days, and a weekly goal shows progress such as "2 of 3 this week". Rest days never break a streak.
4. Select a habit's name to open details: streaks, completion rates, milestone badges, a six-week calendar (select a day to add or remove its check-in), a form to log a day with a note, history, editing, **Archive**, and delete.
5. **Show archived habits** at the bottom of Today lists archived habits so you can restore them.
6. **Insights** shows your trends. **Settings** has change password, log out everywhere, JSON and CSV export, and delete account.

## API reference

The interactive reference with every field and example is at `/docs`; the raw OpenAPI file is at `/openapi.json`. Base URL: `http://localhost:3000`. Bodies are JSON and dates are `YYYY-MM-DD`. Routes marked 🔒 need `Authorization: Bearer <token>`, where the token comes from register or login.

| Method | Path | Description | Success |
|---|---|---|---|
| POST | `/api/auth/register` | Create an account `{email, password}` (password 8–72 characters) | 201 |
| POST | `/api/auth/login` | Log in, returns `{user, token}` | 200 |
| GET | `/api/auth/me` 🔒 | The current user | 200 |
| PUT | `/api/auth/password` 🔒 | Change password `{current_password, new_password}`; signs out other sessions, returns a new token | 200 |
| POST | `/api/auth/logout-all` 🔒 | Sign out of every device | 204 |
| DELETE | `/api/auth/me` 🔒 | Delete the account and all its data `{password}` | 204 |
| GET | `/api/habits` 🔒 | List habits: `page`, `limit`, `sort` (created_at, updated_at, name), `order`, `q` (search), `archived` (true, false, all), `frequency` | 200 |
| POST | `/api/habits` 🔒 | Create `{name, description?, frequency?, days_of_week?, times_per_week?}` | 201 |
| GET | `/api/habits/summary?today=` 🔒 | Every active habit with streaks, today's status, weekly progress and the last 14 days | 200 |
| GET | `/api/habits/:id` 🔒 | One habit | 200 |
| PUT | `/api/habits/:id` 🔒 | Update any of the create fields | 200 |
| DELETE | `/api/habits/:id` 🔒 | Delete the habit and its entries | 204 |
| POST | `/api/habits/:id/archive` 🔒 | Archive (hides it, blocks new check-ins, keeps history) | 200 |
| POST | `/api/habits/:id/restore` 🔒 | Restore an archived habit | 200 |
| POST | `/api/habits/:id/entries` 🔒 | Record a day `{entry_date?, completed?, note?}`. Posting an existing date updates it | 201 new, 200 updated |
| GET | `/api/habits/:id/entries` 🔒 | History: `from`, `to`, `completed`, `order`, `page`, `limit` | 200 |
| DELETE | `/api/habits/:id/entries/:date` 🔒 | Remove one day's entry | 204 |
| GET | `/api/habits/:id/streak?today=` 🔒 | `current_streak`, `longest_streak`, `total_completed`, `last_completed`, `streak_unit` | 200 |
| GET | `/api/habits/:id/stats?today=` 🔒 | Completion rates, weekday counts, 8-week history, milestones | 200 |
| GET | `/api/stats/overview?today=` 🔒 | Totals, rates, best streak, weekday counts, 12-week activity, per-habit rates | 200 |
| GET | `/api/export?format=json\|csv` 🔒 | Download all your data | 200 |
| GET | `/health` | Health check | 200 |
| GET | `/docs`, `/openapi.json` | Interactive docs and the OpenAPI description | 200 |

### Schedules

| `frequency` | Extra field | Meaning |
|---|---|---|
| `daily` (default) | none | Every day |
| `days` | `days_of_week`: `[0-6]`, 0 = Sunday | Only these weekdays are expected |
| `weekly` | `times_per_week`: 1–7 | Any N days in a week; weeks run Sunday to Saturday |

### Status codes and errors

| Code | Meaning |
|---|---|
| 400 | Validation failed, malformed JSON, or an invalid or future date |
| 401 | Missing, invalid, expired or revoked token, or wrong email or password at login |
| 403 | The password you confirmed with is wrong |
| 404 | Not found, **including habits that belong to another user** |
| 409 | Email already registered, or the habit is archived |
| 413 | Request body too large |
| 429 | Too many requests (rate limit) |
| 500 | Unexpected server error (details are logged, never sent to the client) |

Every error has the same shape. `details` appears on validation errors, and `request_id` matches the id in the server log and the `X-Request-Id` header:

```json
{
  "error": {
    "message": "Validation failed.",
    "details": [{ "field": "name", "message": "Name is required." }],
    "request_id": "6f1c0c2e-..."
  }
}
```

### Example

```bash
curl -X POST localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d '{"email":"owen@example.com","password":"password123"}'
# {"user":{"id":1,"email":"owen@example.com",...},"token":"eyJ..."}

curl -X POST localhost:3000/api/habits -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Gym","frequency":"days","days_of_week":[1,3,5]}'

curl -X POST localhost:3000/api/habits/1/entries -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"note":"Leg day"}'

curl localhost:3000/api/habits/1/streak -H "Authorization: Bearer $TOKEN"
```

On Windows PowerShell, use `Invoke-RestMethod` instead of `curl`, or use `/docs` or the Postman collection.

### Streak rules

- A streak is a run of expected days with a check-in. For a daily habit that is consecutive calendar days; for a habit on chosen weekdays, rest days are skipped, so Mon, Wed, Fri done in a row is a 3-day streak.
- For a weekly goal the streak counts consecutive weeks (Sunday to Saturday) in which the goal was met, and `streak_unit` is `week`.
- The current day or week still in progress never breaks a streak; it only breaks once a full expected day or week has been missed.
- **Time zones:** the web app sends the user's local date as `today` (and as `entry_date`), so an evening check-in counts for that evening's date. Without `today`, the server uses the UTC date. Dates more than one day ahead of UTC are rejected.

## Data model

```
users    id, email (unique), password_hash, token_version, created_at
habits   id, user_id → users, name, description, frequency, days_of_week, times_per_week,
         archived_at, created_at, updated_at
entries  id, habit_id → habits, entry_date, completed, note, created_at
         unique (habit_id, entry_date)
schema_migrations   which migrations have been applied
```

Deleting a user deletes their habits, and deleting a habit deletes its entries (`ON DELETE CASCADE`). The schema lives in `migrations/`: numbered SQL files applied in order by `npm run db:init`. To change the schema, add a new file such as `migrations/003_something.sql`; never edit one that has already been applied.

## Testing

```bash
npm run test:unit        # streak, statistics and config logic; no database needed
npm test                 # unit tests, plus API tests when TEST_DATABASE_URL is set
npm run lint             # ESLint
```

The API tests use their own database so your real data is never touched. Create one (for example `createdb habit_tracker_test`) and add to `.env`:

```
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/habit_tracker_test
```

The tests apply migrations to that database themselves, never read `DATABASE_URL`, and delete only the users they created. Without `TEST_DATABASE_URL` the API tests are skipped. Rate limits and request logging are off while testing.

### Continuous integration

`.github/workflows/ci.yml` runs lint and the full test suite (with a Postgres service) on every push and pull request. It uses `npm ci`, so commit `package-lock.json` after running `npm install`.

### Postman

Import `docs/habit-tracker.postman_collection.json` into Postman. Run the requests top to bottom: Register or Log in saves your token, and Create habit saves `habitId`. Each request has tests, the "Errors" folder checks that bad requests fail correctly, and the last "Account" folder changes the password and deletes the account, so skip it if you want to keep yours. To test a hosted copy, change the collection's `baseUrl` variable.

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DATABASE_SSL` | PostgreSQL connection; `DATABASE_SSL=true` for hosted databases |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Token signing secret (16+ characters) and lifetime (default 7d) |
| `PORT` | Port to listen on (default 3000) |
| `CORS_ORIGIN` | Comma-separated allowed origins. Without it any origin may call the API |
| `TRUST_PROXY` | Set to `1` behind a hosting proxy so rate limits see real visitor addresses |
| `LOG_REQUESTS` | `false` turns off the request log |

The server checks its configuration on start and prints every problem at once. In production it refuses a placeholder `JWT_SECRET`.

## Deploying

Deployment is not set up yet. When you are ready, any Node host with PostgreSQL works. Set the variables above (with `NODE_ENV=production` and `TRUST_PROXY=1`), run `npm run db:init` once against the production database, and use `npm start` as the start command and `/health` as the health check. `railway.json` holds Railway settings if you choose it.

## Project structure

```
public/                  Web app: index.html, styles.css, app.js (no build step)
src/app.js, server.js    Express setup and entry point
src/config.js            Environment validation
src/db.js, migrate.js    PostgreSQL pool and migration runner
src/routes/              auth, habits, entries, stats, export
src/middleware/          auth (JWT), validate (Zod), rate limits, request log, errorHandler
src/services/            Shared data loading
src/utils/               Streaks, statistics, schedules, dates, pagination, errors
src/docs/openapi.js      OpenAPI description served at /docs
migrations/              Numbered SQL migrations
scripts/init-db.js       Applies pending migrations
test/, test-utils/       Unit and API integration tests, helpers
docs/                    Postman collection
.github/workflows/       CI
```

## Security notes

- Passwords are hashed with bcrypt and never returned by any endpoint. Login failures give the same message whether the email exists or not.
- Tokens carry a version number: changing your password or choosing "log out everywhere" revokes every earlier token immediately.
- Failed logins, sign-ups, and password confirmations are rate limited, and so is the API as a whole.
- Every habit query is scoped to the logged-in user. Someone else's habit looks like a missing one (404).
- All SQL uses parameters (sort columns come from a fixed list), request bodies are limited to 10 KB, and `helmet` sets security headers including a content security policy.
- CSV exports defuse cells that start with `=`, `+`, `-` or `@` so they cannot run as spreadsheet formulas.
- The web app builds pages from text, never from raw HTML, so habit names and notes can't inject markup.
- The token is kept in the browser's local storage, which is simple and fine for a course project. A production app might prefer an HttpOnly cookie.

## Ideas for later

Numeric goals (for example "8 glasses of water"), sharing a habit with a friend, email reminders, and a dark theme.

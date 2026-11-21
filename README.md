# Habit Tracker

## 1. Project Title & Description

**Habit Tracker** is a back-end REST API with a web app on top of it. People create an account, add habits, check in each day, and see their streaks, completion rates and trends. An optional AI "Coach" chat answers questions about their own progress.

**What it does**
- Stores users, habits and daily check-ins in a PostgreSQL database and exposes them through a secured REST API.
- Calculates streaks that respect each habit's schedule (every day, chosen weekdays, or N times a week).
- Shows the results in a simple web app (white and blue, with red for misses and deletes, plus a dark theme).

**Why I built it**
This is my independent project for **COMP 4327 Back-end Web Development**. The approved topic was a Habit Tracker API focused on reliable server-side logic: authentication and protected routes, a real database, input validation, error handling and clear API responses. I built the web app on top so the API can be used and demonstrated end to end.

## 2. Tech Stack

| Area | Technology |
|---|---|
| Runtime and framework | Node.js 22, Express 4 |
| Database | PostgreSQL (hosted on Supabase), `pg` driver, versioned SQL migrations |
| Authentication | JSON Web Tokens (`jsonwebtoken`), password hashing with `bcryptjs` |
| Validation | Zod |
| Security | `helmet` (security headers), `cors`, `express-rate-limit` |
| API documentation | OpenAPI 3 with Swagger UI at `/docs`, Postman collection |
| Front end | Plain HTML, CSS and JavaScript (no framework) |
| AI (optional) | Anthropic Claude API, called from the server |
| Testing and quality | Node's built-in test runner, ESLint, GitHub Actions, Newman |
| Hosting | Render (web service) with Supabase (database) |

## 3. Features

**Accounts and security**
- Register and log in; passwords are hashed and never returned
- Change password, log out of every device, delete account and all data
- Every habit query is scoped to the logged-in user; someone else's habit looks like a missing one (404)
- Rate limiting, security headers, request logging with a request id on every response

**Habits**
- Create, read, update, delete (full CRUD), plus archive and restore
- Schedules: every day, chosen weekdays, or N times a week
- Optional categories (for example Health or Study) with filter chips
- Optional numeric goals, such as 8 glasses of water a day, with partial progress
- Search, filters, sorting and pagination on lists

**Progress**
- Daily check-ins with optional notes; check in for any past day
- Streaks that skip rest days and count weeks for weekly goals
- Completion rates (7, 30 and 90 days), best weekdays, milestone badges
- Insights page: 12-week activity heat map and per-habit and per-category rates
- Export all data as JSON or CSV (CSV is safe to open in spreadsheets)

**Coach (optional)**
- A chat that answers questions such as "How am I doing this week?" using the user's own data
- Read-only, per-user rate limited, and switched off automatically when no API key is set

**Developer experience**
- Interactive API docs at `/docs`, and a Postman collection with automated assertions
- 113 automated tests (unit and API integration), ESLint, and a CI workflow
- One consistent error format with the right status codes

## 4. How to Run the Project

### Live version

Open the deployed app: **https://habit-tracker-b7zf.onrender.com** (API docs at `/docs`).
Click **Create account** to try it. On the free hosting tier the first load after a period of inactivity can take about a minute.

### Run it on your computer

**You need:** Node.js 18 or newer, and a PostgreSQL database (local, or a free Supabase project).

```bash
npm install
cp .env.example .env        # Windows Command Prompt: copy .env.example .env
```

Edit `.env` and set:
- `DATABASE_URL` to your PostgreSQL connection string (for Supabase use the **Session pooler** string, with no `[brackets]` around the password)
- `DATABASE_SSL=true` for hosted databases
- `JWT_SECRET` to a long random string. Generate one with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Then create the tables and start the server:

```bash
npm run db:init             # applies the database migrations (safe to run again)
npm start                   # http://localhost:3000
```

Open <http://localhost:3000> for the web app and <http://localhost:3000/docs> for the API docs.

**Optional setup**
- `npm run seed:demo` creates a demo account with sample habits and about 10 weeks of history (login: see the script's header). See *Demo data* below.
- `ANTHROPIC_API_KEY` in `.env` switches on the Coach chat. Without it everything else works and the Coach tab says it is not switched on.
- `npm test` runs the tests, `npm run lint` runs ESLint. See *Testing* below.

## 5. Screenshots

| | |
|---|---|
| **Sign in** | **Today** |
| ![Sign in page](docs/screenshots/1-login.png) | ![Today page with streaks](docs/screenshots/2-today.png) |
| **Habit details** | **Insights** |
| ![Habit details with calendar and stats](docs/screenshots/3-habit-detail.png) | ![Insights page with heat map](docs/screenshots/4-insights.png) |
| **Coach chat** | **Dark theme** |
| ![Coach chat](docs/screenshots/5-coach.png) | ![Dark theme](docs/screenshots/6-dark-mode.png) |

**Interactive API documentation (`/docs`)**

![Swagger API docs](docs/screenshots/7-api-docs.png)

## 6. Team Members

| Name | Role |
|---|---|
| **Owen Aminiel** | Independent project. Design, database, API, web app, testing, deployment and documentation |

Claude (Anthropic's AI assistant) was used as a coding assistant during development.

## 7. Challenges & Learning

**Challenges**
- **Streaks are harder than they look.** A streak has to skip rest days, count weeks for "3 times a week" goals, never punish the day that is still in progress, and respect the user's time zone. I solved it by having the browser send its local date, and by keeping the streak logic in small pure functions that have their own unit tests.
- **Making the database changes safe.** I moved from one schema file to numbered migrations, with a lock so two servers can't migrate at once. That lock does not work through Supabase's transaction pooler, so I had to learn the difference between the session and transaction poolers.
- **Deployment surprises.** My first deploys failed with "tenant or user not found". The cause was a paused free Supabase project, not my code. I also learned that free hosting sleeps when idle.
- **Security details.** Logging out everywhere needed token versioning, so old tokens stop working. CSV exports needed protection against spreadsheet formula injection, and all queries had to be scoped to the owner.
- **Numeric goals touched everything.** Adding "8 glasses" meant that whether a day counts as done depends on the amount, so changing a goal has to re-judge past entries.
- **Testing code that calls an AI service.** Tests must never call (or pay for) the real API, so the Coach's model call can be swapped for a scripted fake.

**What I learned**
- Designing a REST API: resources, status codes, pagination, and one consistent error format
- Authentication and authorization with JWT and bcrypt, and why per-user scoping matters
- Validating all input on the server with Zod
- Versioned database migrations and relational design with foreign keys and cascades
- Writing unit and integration tests, and using a separate test database
- Documenting an API with OpenAPI and Postman
- Deploying a Node and PostgreSQL app, and reading logs to find the real cause of a failure
- Calling an external AI API safely: keep the key on the server, use read-only tools, and cap usage

## 8. Future Improvements

- Forgot-password flow with email
- Email or push reminders for habits
- Sharing a habit with a friend
- Importing data from the JSON export
- Letting the Coach log check-ins and add habits, after the user confirms

---

# Technical Reference

The rest of this file is the detailed reference for developers and graders: the API, configuration, data model, testing and deployment.

## Using the web app

1. **Create account**, then you land on **Today**.
2. **New habit**: give it a name and choose how often: every day, certain days, or a number of times a week. Select the circle to check in; select it again to undo.
3. A habit on certain days shows a **Rest day** tag on the other days, and a weekly goal shows progress such as "2 of 3 this week". Rest days never break a streak.
4. Select a habit's name to open details: streaks, completion rates, milestone badges, a six-week calendar (select a day to add or remove its check-in), a form to log a day with a note, history, editing, **Archive**, and delete.
5. **Show archived habits** at the bottom of Today lists archived habits so you can restore them.
6. **Category** is an optional label such as Health or Study. Once any habit has one, filter chips appear on Today and Insights adds a per-category breakdown.
7. **Measure with a number** on the habit form gives a habit a daily target and unit, such as 8 glasses. The circle on Today then opens a small form to log how much you did, with a shortcut to mark the goal reached. A day counts as done once the amount reaches the target; smaller amounts are saved as progress and show in the history.
8. **Coach** is a chat where you can ask things like "How am I doing this week?". It is switched on only when the server has an Anthropic API key (see *The Coach* below); otherwise the tab says it is not switched on.
9. **Insights** shows your trends. **Settings** has the theme (match your device, light, or dark), change password, log out everywhere, JSON and CSV export, and delete account.

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
| GET | `/api/habits` 🔒 | List habits: `page`, `limit`, `sort` (created_at, updated_at, name), `order`, `q` (search), `archived` (true, false, all), `frequency`, `category` | 200 |
| GET | `/api/habits/categories` 🔒 | Your categories (active habits) with how many habits each has | 200 |
| POST | `/api/habits` 🔒 | Create `{name, description?, category?, target?, unit?, frequency?, days_of_week?, times_per_week?}` | 201 |
| GET | `/api/habits/summary?today=` 🔒 | Every active habit with streaks, today's status, weekly progress and the last 14 days | 200 |
| GET | `/api/habits/:id` 🔒 | One habit | 200 |
| PUT | `/api/habits/:id` 🔒 | Update any of the create fields | 200 |
| DELETE | `/api/habits/:id` 🔒 | Delete the habit and its entries | 204 |
| POST | `/api/habits/:id/archive` 🔒 | Archive (hides it, blocks new check-ins, keeps history) | 200 |
| POST | `/api/habits/:id/restore` 🔒 | Restore an archived habit | 200 |
| POST | `/api/habits/:id/entries` 🔒 | Record a day `{entry_date?, completed?, note?, value?}`. Posting an existing date updates it | 201 new, 200 updated |
| GET | `/api/habits/:id/entries` 🔒 | History: `from`, `to`, `completed`, `order`, `page`, `limit` | 200 |
| DELETE | `/api/habits/:id/entries/:date` 🔒 | Remove one day's entry | 204 |
| GET | `/api/habits/:id/streak?today=` 🔒 | `current_streak`, `longest_streak`, `total_completed`, `last_completed`, `streak_unit` | 200 |
| GET | `/api/habits/:id/stats?today=` 🔒 | Completion rates, weekday counts, 8-week history, milestones | 200 |
| GET | `/api/stats/overview?today=` 🔒 | Totals, rates, best streak, weekday counts, 12-week activity, per-habit rates | 200 |
| GET | `/api/export?format=json\|csv` 🔒 | Download all your data | 200 |
| GET | `/api/chat/status` 🔒 | `{available}`: whether the Coach is switched on | 200 |
| POST | `/api/chat` 🔒 | Ask the Coach `{messages: [{role, content}], today?}` (1–12 messages, the last from the user, each up to 1000 characters). Returns `{reply, tools_used}` | 200 |
| GET | `/health` | Health check | 200 |
| GET | `/docs`, `/openapi.json` | Interactive docs and the OpenAPI description | 200 |

### Schedules

| `frequency` | Extra field | Meaning |
|---|---|---|
| `daily` (default) | none | Every day |
| `days` | `days_of_week`: `[0-6]`, 0 = Sunday | Only these weekdays are expected |
| `weekly` | `times_per_week`: 1–7 | Any N days in a week; weeks run Sunday to Saturday |

### Categories and numeric goals

- `category` is an optional label of up to 30 characters. Send `null` or an empty string to clear it. A category matches case-insensitively, and an existing spelling is reused, so `health` becomes `Health` if you already use that.
- `target` (a positive number) and `unit` (up to 20 characters) give a habit a daily goal. When a habit has a target, `POST /entries` accepts `value`, the amount done, and the day is `completed` once `value` reaches the target. The `completed` flag you send is ignored when `value` is given, and a plain check-in without a value counts as the full target. Sending `value` for a habit without a target is a 400. Smaller amounts are stored as progress, do not extend streaks, and appear in the history.
- Changing a habit's target re-judges its logged amounts against the new target. Removing the target (`null`) also removes the unit and keeps the logged values.

### The Coach

The Coach is a chat in the web app (and `POST /api/chat`) that answers questions about your own habits using Claude through the Anthropic API.

- **Switch it on:** create an API key at console.anthropic.com (it needs a small credit balance; this is separate from a Claude.ai subscription) and set `ANTHROPIC_API_KEY` on the server. On Render that is *Environment, Add variable*. Without a key the rest of the app works normally and the Coach tab says it is not switched on. Never put the key in the code, the repository, or the browser.
- **Read-only:** Claude can only call three tools (`get_habits_overview`, `get_insights`, `get_habit_details`). Each one calls this app's own API with the caller's own token, so it sees exactly what that person could see. No tool creates, changes or deletes anything.
- **Cost controls:** 30 messages per 15 minutes and 150 per day for each user, 12 messages of history, 1000 characters per message, replies capped at 700 tokens, at most 5 tool rounds per question, and a 30-second timeout. The default model is `claude-haiku-5-5` (cheap and fast); set `ANTHROPIC_MODEL` to use another.
- **Privacy and safety:** habit data is sent to Anthropic only while answering a question. Provider error messages (which can mention account details) are logged on the server and never sent to the browser. Habit names and notes are treated as data, not instructions, in the system prompt.
- **Tests** replace the model with a scripted fake, so `npm test` never contacts Anthropic or costs anything.

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
habits   id, user_id → users, name, description, category, target, unit, frequency, days_of_week,
         times_per_week, archived_at, created_at, updated_at
entries  id, habit_id → habits, entry_date, completed, note, value, created_at
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
| `ANTHROPIC_API_KEY` | Optional. Switches on the Coach chat (see *The Coach*) |
| `ANTHROPIC_MODEL` | Optional. Model for the Coach (default `claude-haiku-5-5`) |

The server checks its configuration on start and prints every problem at once. In production it refuses a placeholder `JWT_SECRET`.

## Deploying

Any Node host with PostgreSQL works. The steps below use Render's free tier with your existing Supabase database; `render.yaml` describes the service.

1. Push the project to GitHub.
2. In Render, choose **New, Blueprint**, pick the repository, and apply `render.yaml`.
3. When asked, paste `DATABASE_URL` (your Supabase **session pooler** string, with no brackets around the password). `JWT_SECRET` is generated for you; do not reuse the one from your laptop.
4. Deploy. The start command runs `npm run db:init` first, so migrations are applied automatically, then starts the server. The health check is `/health`.
5. Open the service URL for the web app and `/docs` for the API docs.

On the free tier the service sleeps after a period of inactivity, so the first request after a pause can take about a minute. Open it a few minutes before a demo. For other hosts, set the variables in the Configuration table (with `NODE_ENV=production` and `TRUST_PROXY=1`), run `npm run db:init` once, use `npm start` as the start command and `/health` as the health check. `railway.json` holds Railway settings.

### Demo data

`npm run seed:demo` creates `demo@example.com` (password `demo-password-123`) with six habits (including categories and a numeric goal) and about ten weeks of history, which makes the Insights page worth showing. It refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`, and re-running it resets that account. To fill an account you already have, set `SEED_EMAIL` (PowerShell: `$env:SEED_EMAIL="you@example.com"; npm run seed:demo`). That keeps its password but deletes all of its current habits first.

## Project structure

```
public/                  Web app: index.html, styles.css, app.js, theme.js (no build step)
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
scripts/seed-demo.js     Creates a demo account with sample history
render.yaml              Render deployment blueprint
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
- The Coach key never leaves the server, the Coach is read-only and scoped to the logged-in user, and it is rate limited per user.
- The web app builds pages from text, never from raw HTML, so habit names and notes can't inject markup.
- The token is kept in the browser's local storage, which is simple and fine for a course project. A production app might prefer an HttpOnly cookie.

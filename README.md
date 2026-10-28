# Habit Tracker

A back-end API and small web app for building daily habits. Create an account, add habits, check in each day, and see completion history and streaks. Each habit's last 14 days show as a chain: consecutive check-ins join into one blue bar, and a missed day breaks it in red.

Built for COMP 4327 Back-end Web Development with Node.js, Express, PostgreSQL, JWT authentication, and Zod validation.

## Features

- Registration and login with hashed passwords (bcrypt) and signed tokens (JWT)
- Create, read, update, and delete habits, private to each user
- Record daily progress with an optional note; re-posting a day updates it
- Completion history with date filters, and current and longest streaks
- Server-side validation, one consistent error format, correct status codes
- Web app served by the same server (white and blue, red for misses and deletes)
- 19 API integration tests, 5 unit tests for the streak logic, and a Postman collection

## Quick start

You need Node 18 or newer and a PostgreSQL database (local, Supabase, or Railway).

```bash
npm install
cp .env.example .env     # Windows Command Prompt: copy .env.example .env
```

Edit `.env`: set `DATABASE_URL` and a real `JWT_SECRET`, and set `DATABASE_SSL=true` for hosted databases. Then:

```bash
npm run db:init          # creates the tables (safe to run again)
npm start                # http://localhost:3000
```

Open <http://localhost:3000> for the web app. `npm run dev` restarts on file changes; if it restarts constantly, your project folder is probably inside OneDrive, so use `npm start` or move the folder.

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Using the web app

1. **Create account**, then you land on **Today**.
2. **New habit** adds one. Select the circle to check in today; select it again to undo.
3. Select a habit's name to open its details: streak stats, a six-week calendar (select a day to add or remove its check-in), a form to log a day with a note, history, editing, and deletion.

## API reference

Base URL: `http://localhost:3000`. Bodies are JSON and dates are `YYYY-MM-DD`. Routes marked 🔒 need `Authorization: Bearer <token>`, where the token comes from register or login.

| Method | Path | Description | Success |
|---|---|---|---|
| POST | `/api/auth/register` | Create an account `{email, password}` (password 8–72 characters) | 201 |
| POST | `/api/auth/login` | Log in, returns `{user, token}` | 200 |
| GET | `/api/auth/me` 🔒 | The current user | 200 |
| GET | `/api/habits` 🔒 | List your habits, newest first | 200 |
| POST | `/api/habits` 🔒 | Create a habit `{name, description?}` | 201 |
| GET | `/api/habits/summary?today=` 🔒 | Every habit with streaks, `completed_today`, and the last 14 days | 200 |
| GET | `/api/habits/:id` 🔒 | One habit | 200 |
| PUT | `/api/habits/:id` 🔒 | Update `{name?, description?}` | 200 |
| DELETE | `/api/habits/:id` 🔒 | Delete the habit and its entries | 204 |
| POST | `/api/habits/:id/entries` 🔒 | Record a day `{entry_date?, completed?, note?}`. Defaults to today and completed. Posting a date that exists updates it | 201 new, 200 updated |
| GET | `/api/habits/:id/entries?from=&to=` 🔒 | Completion history, newest first | 200 |
| DELETE | `/api/habits/:id/entries/:date` 🔒 | Remove one day's entry | 204 |
| GET | `/api/habits/:id/streak?today=` 🔒 | `current_streak`, `longest_streak`, `total_completed`, `last_completed` | 200 |
| GET | `/health` | Health check | 200 |

### Status codes and errors

| Code | Meaning |
|---|---|
| 400 | Validation failed, malformed JSON, or an invalid or future date |
| 401 | Missing or invalid token, or wrong email or password |
| 404 | Habit or entry not found, **including habits that belong to another user** |
| 409 | Email already registered |
| 500 | Unexpected server error (details are logged, never sent to the client) |

Every error has the same shape. `details` appears on validation errors:

```json
{
  "error": {
    "message": "Validation failed.",
    "details": [{ "field": "name", "message": "Name is required." }]
  }
}
```

### Example

```bash
curl -X POST localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d '{"email":"owen@example.com","password":"password123"}'
# {"user":{"id":1,"email":"owen@example.com",...},"token":"eyJ..."}

curl -X POST localhost:3000/api/habits -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"Read for 20 minutes"}'

curl -X POST localhost:3000/api/habits/1/entries -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"note":"Finished chapter 3"}'

curl localhost:3000/api/habits/1/streak -H "Authorization: Bearer $TOKEN"
# {"habit_id":1,"current_streak":1,"longest_streak":1,"total_completed":1,"last_completed":"2026-10-28"}
```

On Windows PowerShell, use `Invoke-RestMethod` instead of `curl`, or use the Postman collection below.

### Streak rules

- A streak is a run of consecutive calendar days with `completed: true`.
- The current streak stays alive while today is not logged yet but yesterday was, so it only breaks after a full missed day.
- **Time zones:** the web app sends the user's local date as `today` (and as `entry_date`), so an evening check-in in Chicago counts for that evening's date. Without `today`, the server uses the UTC date. Dates more than one day ahead of UTC are rejected.

## Data model

```
users    id, email (unique), password_hash, created_at
habits   id, user_id → users, name, description, created_at, updated_at
entries  id, habit_id → habits, entry_date, completed, note, created_at
         unique (habit_id, entry_date)
```

Deleting a user deletes their habits, and deleting a habit deletes its entries (`ON DELETE CASCADE`). The full schema is in `schema.sql`.

## Testing

```bash
npm run test:unit        # streak logic, no database needed
npm test                 # unit tests, plus API tests when TEST_DATABASE_URL is set
```

The API tests use their own database so your real data is never touched. Create one (for example `createdb habit_tracker_test`), run `npm run db:init` against it, and add to `.env`:

```
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/habit_tracker_test
```

The tests never read `DATABASE_URL`. They create their own users and delete only those afterward. Without `TEST_DATABASE_URL` the API tests are skipped.

### Postman

Import `docs/habit-tracker.postman_collection.json` into Postman. Run the requests top to bottom: Register or Log in saves your token, and Create habit saves `habitId`. Each request has tests, and the "Errors" folder checks that bad requests fail correctly. To test a deployed copy, change the collection's `baseUrl` variable.

## Deploying to Railway

1. Push this folder to a GitHub repository. `.env` is ignored, so your secrets stay out.
2. In Railway, choose **New Project → Deploy from GitHub repo** and pick the repository. `railway.json` sets the start command and health check.
3. Under **Variables**, add:
   - `DATABASE_URL`: your Supabase session pooler string (or a Railway Postgres reference)
   - `DATABASE_SSL`: `true` for Supabase
   - `JWT_SECRET`: a new long random string (not the one from your laptop)
   - `NODE_ENV`: `production`
4. Under **Settings → Networking**, choose **Generate Domain**.
5. Open `https://<your-domain>/health`, then the site itself. The database tables already exist if you ran `npm run db:init` against the same database. If not, run it once with that `DATABASE_URL`.

Railway sets `PORT` itself. In production the server refuses to start with a placeholder `JWT_SECRET`.

## Project structure

```
public/                  Web app: index.html, styles.css, app.js (no build step)
src/app.js, server.js    Express setup and entry point
src/db.js                PostgreSQL pool
src/routes/              auth, habits, entries
src/middleware/          auth (JWT), validate (Zod), errorHandler
src/utils/               streak calculation, date helpers, error helpers
scripts/init-db.js       Applies schema.sql
schema.sql               users, habits, entries
test/                    streak unit tests and API integration tests
test-utils/              Test helpers
docs/                    Postman collection
railway.json             Railway deploy settings
```

## Security notes

- Passwords are hashed with bcrypt and never returned by any endpoint.
- Login failures give the same message whether the email exists or not.
- Every habit query is scoped to the logged-in user. Someone else's habit looks like a missing one (404).
- All SQL uses parameters, request bodies are limited to 10 KB, and `helmet` sets security headers including a content security policy.
- The web app builds pages from text, never from raw HTML, so habit names and notes can't inject markup.
- The token is kept in the browser's local storage, which is simple and fine for a course project. A production app might prefer an HttpOnly cookie.

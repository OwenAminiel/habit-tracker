# Habit Tracker API

A RESTful back-end for creating accounts, managing habits, recording daily progress, and viewing completion history and streaks.
Built with Node.js, Express, PostgreSQL, JWT authentication, and Zod validation.

## Quick start

```bash
npm install
cp .env.example .env        # then set DATABASE_URL and JWT_SECRET
npm run db:init             # creates the tables from schema.sql
npm run dev                 # http://localhost:3000
npm test                    # unit tests for streak logic
```

You need a running PostgreSQL database (local install, Docker, Railway, or Supabase).
For hosted databases that require SSL, set `DATABASE_SSL=true`.

## Conventions

- All bodies are JSON. Dates are `YYYY-MM-DD`.
- Protected routes require `Authorization: Bearer <token>` (token comes from register/login).
- Errors always look like `{ "error": { "message": "...", "details": [...] } }` (`details` appears on validation errors).
- Each user can only access their own habits; other users' habits return `404`.

## Endpoints

| Method | Path | Description | Success |
|---|---|---|---|
| POST | `/api/auth/register` | Create account `{email, password}` (password 8+ chars) | 201 |
| POST | `/api/auth/login` | Log in, returns `{user, token}` | 200 |
| GET | `/api/auth/me` | Current user | 200 |
| GET | `/api/habits` | List your habits | 200 |
| POST | `/api/habits` | Create habit `{name, description?}` | 201 |
| GET | `/api/habits/:id` | Get one habit | 200 |
| PUT | `/api/habits/:id` | Update `{name?, description?}` | 200 |
| DELETE | `/api/habits/:id` | Delete habit and its entries | 204 |
| POST | `/api/habits/:id/entries` | Record a day `{entry_date?, completed?, note?}`. Defaults to today and completed. Re-posting the same date updates it. | 201 new / 200 updated |
| GET | `/api/habits/:id/entries?from=&to=` | Completion history, newest first | 200 |
| DELETE | `/api/habits/:id/entries/:date` | Remove a day's entry | 204 |
| GET | `/api/habits/:id/streak` | Current streak, longest streak, total completed | 200 |
| GET | `/health` | Health check | 200 |

Other status codes: `400` validation error, `401` missing/invalid token or bad login, `404` not found, `409` email already registered.

## Example

```bash
curl -X POST localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d '{"email":"owen@example.com","password":"password123"}'

curl -X POST localhost:3000/api/habits -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"Read 20 minutes"}'

curl -X POST localhost:3000/api/habits/1/entries -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"note":"Finished chapter 3"}'

curl localhost:3000/api/habits/1/streak -H "Authorization: Bearer $TOKEN"
# {"habit_id":1,"current_streak":1,"longest_streak":1,"total_completed":1,"last_completed":"2026-10-14"}
```

## Streak rules

A streak is a run of consecutive calendar days (UTC) with `completed: true`. The current streak stays alive if today isn't logged yet but yesterday was.

## Project structure

```
src/app.js, server.js       Express setup and entry point
src/db.js                   PostgreSQL pool
src/routes/                 auth, habits, entries
src/middleware/             auth (JWT), validate (Zod), errorHandler
src/utils/streak.js         streak calculation
schema.sql                  users, habits, entries tables
test/streak.test.js         unit tests
```

## Security notes

Passwords are hashed with bcrypt, tokens are signed JWTs, requests are validated server-side, SQL uses parameterized queries, and `helmet` sets secure headers.

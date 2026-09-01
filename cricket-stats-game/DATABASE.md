# Application database (PostgreSQL)

Phase 4.1 adds a **separate, persistent application database** —
PostgreSQL — as the foundation for accounts, profiles, persisted games
and (later) achievements and leaderboards.

**This is not connected to the game yet.** The game you can actually
play right now still works exactly as it did before this phase: session
cookies, no login, nothing written to Postgres. This phase only builds
the database, its schema, and the tooling to manage it.

**This is not the cricket dataset.** `data/cricket.duckdb` (22,734
matches, 15,091 players) is untouched, stays exactly where it is, and
nothing in here duplicates it. The `picks` table below stores a
player's *id* from that dataset as a plain reference column — never a
copy of their stats.

## Why PostgreSQL, and why separate from DuckDB

DuckDB is genuinely the right tool for the cricket dataset: a large,
read-only analytical table that the game only ever queries, never
writes to. Accounts, games and profiles are the opposite shape —
small, constantly written, relational — which is exactly what
PostgreSQL is for. Keeping them as two separate databases means the
1.6 GB cricket dataset never needs touching (or even installing
PostgreSQL) just to play a local game, and the application database
never needs re-downloading Cricsheet data just to run a migration.

## Requirements

- PostgreSQL 13 or later (developed and tested against 17.11)
- Python packages: `psycopg[binary]`, `python-dotenv` — see
  `requirements.txt`

```bash
py -m pip install -r requirements.txt
```

### Getting PostgreSQL running locally

**If you already have PostgreSQL installed and running as a service**,
skip to [Configure environment variables](#configure-environment-variables).

**On Windows, installing via winget can hit a real snag**: the
installer's Windows *service* registration step can be blocked by a
Device Guard / WDAC policy (`pg_ctl.exe was blocked by your
organization's Device Guard policy`), even though PostgreSQL itself
installs and runs fine. If that happens, PostgreSQL is not running as a
service, and won't start on reboot — but you can still run it directly:

```bash
# Start (from the PostgreSQL bin directory, adjust the version path):
"C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" start -D "C:\Program Files\PostgreSQL\17\data" -l "C:\Program Files\PostgreSQL\17\data\log\startup.log" -w

# Stop, when you're done:
"C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" stop -D "C:\Program Files\PostgreSQL\17\data"
```

You'll need to run the `start` command again each time you restart your
machine, until the service registration issue is resolved by your
organization's IT policy (or you install PostgreSQL on a machine
without that restriction).

**Once PostgreSQL is running** (via a proper service, or `pg_ctl start`
above), create a dedicated role and database for this app rather than
using the `postgres` superuser directly:

```bash
psql -U postgres -h 127.0.0.1 -c "CREATE ROLE cricket_app WITH LOGIN PASSWORD 'choose-a-real-password';"
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE cricket_app OWNER cricket_app;"
```

## Configure environment variables

Copy the example file and fill in your real connection string:

```bash
cd cricket-stats-game
cp .env.example .env
```

```bash
# cricket-stats-game/.env
DATABASE_URL=postgresql://cricket_app:choose-a-real-password@127.0.0.1:5432/cricket_app
```

`.env` is gitignored — it never gets committed, and `appdb.py` (via
`python-dotenv`) loads it automatically for local development. A real
deployment should set `DATABASE_URL` directly in its own environment
instead of shipping a `.env` file at all. **Never hardcode credentials
in source** — every part of this foundation reads the connection string
from `DATABASE_URL` alone; there is no fallback default to a local
guess.

## Initialize the database

Migrations are plain, numbered SQL files in `cricket-stats-game/migrations/`,
tracked in a `schema_migrations` table that the runner creates
automatically the first time you use it. There's no separate "init"
step beyond running migrations — `migrate.py up` creates the tracking
table if it doesn't exist yet, then applies everything pending.

```bash
cd cricket-stats-game
py migrate.py status   # see what's applied / pending
py migrate.py up       # apply everything pending, in order
```

Each migration file runs as a single transaction — it either fully
applies and gets recorded, or fully rolls back and is reported as
failed. Running `up` again after a successful run is always safe and
prints "Nothing to do".

### Current schema (`0001_initial_schema.sql`)

| Table | Purpose |
|---|---|
| `users` | Account records — no auth logic yet, just the shape |
| `profiles` | Display name, avatar, XP, level — one per user |
| `games` | One row per persisted game: mode, difficulty, round count, status |
| `game_players` | One row per seat at a game — `user_id` is nullable, so guest play (today's only mode) stays fully supported |
| `rounds` | One row per round of a game; `question` is the exact dict `generate_target()` returns, stored as JSONB |
| `round_players` | One player's result for one round: score, difference, hints used, duration |
| `picks` | One committed pick — `cricket_player_id` references a DuckDB `players.player_id`, deliberately **not** a foreign key (it can't be one — different database engine) |
| `achievements` | Achievement definitions (code, name, XP reward) — empty until Phase 4.x adds real ones |
| `user_achievements` | Which user unlocked which achievement, and when |
| `user_stats` | Running totals per user: games played/won, hints used, streaks |

Nothing currently writes to any of these tables — that wiring is later
work, done as its own phase so today's session-based game is never at
risk of an untested code path touching a database it doesn't need.

## Verify the connection

```bash
cd cricket-stats-game
py -c "import appdb; print(appdb.health_check())"
```

Prints `(True, None)` if PostgreSQL is reachable and responding,
or `(False, "<what's wrong>")` otherwise — a missing `DATABASE_URL`, a
database that isn't running, or a bad password all produce a specific,
readable message rather than a raw stack trace.

## Running the tests

```bash
cd cricket-stats-game
py -m pytest tests/test_appdb.py -v
```

The configuration-only tests (parsing `DATABASE_URL`, handling a
missing one) always run. The connection and migration tests need a
real, reachable PostgreSQL and **skip themselves** (not fail) when one
isn't configured — so `py -m pytest tests/` stays safe to run in an
environment that hasn't set Postgres up at all, and the full backend
suite's pass count is unaffected either way.

## What's deliberately not here yet

This phase (4.1) was the foundation only. Authentication now exists on
top of it — see [AUTH.md](AUTH.md) — but XP awarding, achievements
actually unlocking, streak tracking, leaderboards, and connecting the
live GAME itself (not just accounts) to any of this are still later
phases.

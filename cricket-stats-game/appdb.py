"""
appdb.py

Configuration and connection helper for the PERSISTENT APPLICATION
database -- PostgreSQL. This is a completely separate database from:

  - data/cricket.duckdb: the read-only cricket statistics dataset
    question_gen.py and name_match.py query. Untouched by this module,
    and nothing in here duplicates it -- see migrations/0001_initial_schema.sql
    for how picks reference a DuckDB player by id instead.
  - cricket-stats-game/db/: vendored TypeScript reference material from
    the original cricket-mcp project. Not Python, not imported by
    anything, unrelated to this module despite the similar name.

Phase 4.1 is the foundation only: configuration, a connection helper, a
health check, and the migration runner (migrate.py) that uses this
module. Nothing in the existing game flow (app.py, api.py, game_state.py)
imports appdb yet -- that wiring is later work, done deliberately in a
separate phase so the current session-based game keeps working exactly
as it does today regardless of whether Postgres is even reachable.

Configuration comes entirely from environment variables -- see
.env.example for the full list. python-dotenv loads a local .env file
if one exists (gitignored; never commit real credentials) purely as a
local-development convenience; a real deployment should set these
directly in its own environment instead of shipping a .env file at all.
"""

import os

import psycopg
from dotenv import load_dotenv

load_dotenv()


class ConfigError(Exception):
    """The application database isn't configured or reachable. Covers
    both a missing/malformed DATABASE_URL and a real connection failure
    (Postgres not running, wrong password, ...) -- callers generally
    want to treat both the same way: "the database isn't available right
    now", with a message that tells a developer what to actually check."""


def database_url():
    """The configured connection string, or a clear error if it's missing.
    Never falls back to a hardcoded default -- a missing DATABASE_URL is
    always a configuration problem to fix, not something to silently
    paper over with e.g. a localhost guess that might be wrong or might
    quietly point at someone else's database."""
    url = os.environ.get("DATABASE_URL")
    if not url or not url.strip():
        raise ConfigError(
            "DATABASE_URL is not set. Copy cricket-stats-game/.env.example "
            "to cricket-stats-game/.env and fill in your local PostgreSQL "
            "connection string, or export DATABASE_URL in your environment "
            "directly. See cricket-stats-game/DATABASE.md."
        )
    return url


def get_connection():
    """A new connection to the application database.

    Returns a plain psycopg.Connection -- use it as a context manager
    (`with appdb.get_connection() as conn:`) so it's always closed, the
    same pattern psycopg itself recommends. This module intentionally
    does not keep a pool or a module-level singleton connection open:
    Phase 4.1 has no request-path caller yet, and a migration run or a
    health check is a rare, short-lived thing to need one for.
    """
    url = database_url()
    try:
        return psycopg.connect(url)
    except psycopg.OperationalError as e:
        raise ConfigError(
            f"Could not connect to the application database: {e}\n"
            "Is PostgreSQL running, and does DATABASE_URL point at it? "
            "See cricket-stats-game/DATABASE.md for how to check."
        ) from e


def health_check():
    """
    (ok: bool, detail: str | None) -- never raises. `ok` is True only if
    a real round trip to the database succeeded; `detail` explains what
    went wrong when it didn't (a config problem, or a live connection
    failure), and is None on success.

    Safe to call from anywhere that just wants a yes/no answer -- a
    startup log line, a status endpoint added in a later phase -- without
    having to know about ConfigError or catch psycopg's own exceptions.
    """
    try:
        with get_connection() as conn:
            conn.execute("SELECT 1")
        return True, None
    except ConfigError as e:
        return False, str(e)
    except Exception as e:  # noqa: BLE001 -- deliberately broad: this
        # function's entire contract is "never raise, always report."
        return False, str(e)

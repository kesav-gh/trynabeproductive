"""
test_appdb.py

Tests for the Phase 4.1 application-database foundation (appdb.py,
migrate.py) -- configuration, connection, health check, and the
migration runner. This is entirely separate from the cricket dataset
tests in test_question_gen.py / test_api.py, which never touch Postgres
at all.

Some tests need a real, reachable PostgreSQL (the connection tests, the
migration-runner tests) -- those are skipped, not failed, when
DATABASE_URL isn't configured or the database isn't reachable, so this
suite stays portable to an environment that hasn't set Postgres up.
The pure configuration-parsing tests always run, regardless.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

import appdb
import migrate

_HEALTHY, _HEALTH_DETAIL = appdb.health_check()

requires_database = pytest.mark.skipif(
    not _HEALTHY,
    reason=f"application database not reachable: {_HEALTH_DETAIL}",
)


# ---------------------------------------------------------------------------
# Configuration -- no database connection needed for any of these.
# ---------------------------------------------------------------------------

def test_database_url_raises_when_missing(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(appdb.ConfigError):
        appdb.database_url()


def test_database_url_raises_when_blank(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "   ")
    with pytest.raises(appdb.ConfigError):
        appdb.database_url()


def test_database_url_returns_configured_value(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:5432/db")
    assert appdb.database_url() == "postgresql://u:p@localhost:5432/db"


def test_get_connection_raises_config_error_not_a_raw_psycopg_error(monkeypatch):
    """A caller of appdb should only ever need to catch ConfigError, never
    reach into psycopg's own exception hierarchy -- that's the whole
    point of wrapping it."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(appdb.ConfigError):
        appdb.get_connection()


# ---------------------------------------------------------------------------
# Health check -- never raises, regardless of what's wrong.
# ---------------------------------------------------------------------------

def test_health_check_never_raises_on_missing_config(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    ok, detail = appdb.health_check()
    assert ok is False
    assert detail is not None


def test_health_check_never_raises_on_bad_credentials(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://wrong_user:wrong_pw@127.0.0.1:5432/cricket_app")
    ok, detail = appdb.health_check()
    assert ok is False
    assert detail is not None


@requires_database
def test_health_check_succeeds_against_the_real_database():
    ok, detail = appdb.health_check()
    assert ok is True
    assert detail is None


# ---------------------------------------------------------------------------
# Connection -- requires a real, reachable database.
# ---------------------------------------------------------------------------

@requires_database
def test_get_connection_executes_a_query():
    with appdb.get_connection() as conn:
        row = conn.execute("SELECT 1 AS one").fetchone()
    assert row == (1,)


@requires_database
def test_connection_points_at_the_configured_database():
    with appdb.get_connection() as conn:
        row = conn.execute("SELECT current_database()").fetchone()
    assert row[0] in appdb.database_url()


# ---------------------------------------------------------------------------
# Migration runner -- requires a real, reachable database. Runs against
# whatever database DATABASE_URL actually points at, so this is written
# to be safe to run repeatedly against a real dev database: it only ever
# reads status and applies migrations that are genuinely still pending,
# it never drops or resets anything.
# ---------------------------------------------------------------------------

@requires_database
def test_migration_files_exist():
    files = migrate._migration_files()
    assert len(files) >= 1
    assert files[0].name == "0001_initial_schema.sql"


@requires_database
def test_schema_migrations_table_is_created_and_idempotent():
    with appdb.get_connection() as conn:
        migrate._ensure_tracking_table(conn)
        migrate._ensure_tracking_table(conn)  # must not error the second time
        exists = conn.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'schema_migrations'
            )
        """).fetchone()[0]
    assert exists is True


@requires_database
def test_up_is_idempotent_once_everything_is_applied():
    migrate.up()  # ensure everything pending is applied
    with appdb.get_connection() as conn:
        applied_before = migrate._applied_versions(conn)
    migrate.up()  # nothing should change
    with appdb.get_connection() as conn:
        applied_after = migrate._applied_versions(conn)
    assert applied_before == applied_after


@requires_database
def test_initial_schema_migration_is_applied_and_creates_expected_tables():
    migrate.up()
    with appdb.get_connection() as conn:
        applied = migrate._applied_versions(conn)
        assert "0001_initial_schema.sql" in applied

        tables = {
            row[0] for row in conn.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
            ).fetchall()
        }

    expected = {
        "users", "profiles", "games", "game_players", "rounds",
        "round_players", "picks", "achievements", "user_achievements",
        "user_stats",
    }
    assert expected.issubset(tables)


@requires_database
def test_picks_table_has_no_foreign_key_to_cricket_player_id():
    """The one constraint that matters most for 'don't duplicate the
    cricket dataset': cricket_player_id must be a plain column, never a
    foreign key -- it references a row in a different database engine
    (DuckDB) entirely, which Postgres cannot constrain against."""
    migrate.up()
    with appdb.get_connection() as conn:
        fk_columns = {
            row[0] for row in conn.execute("""
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                WHERE tc.table_name = 'picks' AND tc.constraint_type = 'FOREIGN KEY'
            """).fetchall()
        }
    assert "cricket_player_id" not in fk_columns

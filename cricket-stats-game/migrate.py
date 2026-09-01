"""
migrate.py

A small, dependency-free migration runner for the application database
(PostgreSQL) -- not an ORM, not Alembic, just numbered SQL files applied
in order and tracked in a schema_migrations table. This matches how the
rest of this project already works with SQL directly (question_gen.py,
name_match.py) rather than through a query-building layer, and keeps the
Phase 4.1 foundation free of a new dependency this project doesn't
otherwise need.

Migration files live in cricket-stats-game/migrations/, named
NNNN_description.sql (four-digit, zero-padded, strictly increasing --
sorted and applied in that order). Each file is applied as a single
transaction: its SQL runs, then its filename is recorded in
schema_migrations, and both succeed or both roll back together -- a
migration can never end up half-applied-but-unmarked, or marked-applied
without actually having run.

Usage (from cricket-stats-game/, with DATABASE_URL configured -- see
DATABASE.md):

    py migrate.py status   Show which migrations are applied / pending
    py migrate.py up       Apply all pending migrations, in order
"""

import sys
from pathlib import Path

import appdb

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def _migration_files():
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def _ensure_tracking_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     TEXT PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    conn.commit()


def _applied_versions(conn):
    rows = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
    return {row[0] for row in rows}


def status():
    with appdb.get_connection() as conn:
        _ensure_tracking_table(conn)
        applied = _applied_versions(conn)
        files = _migration_files()
        if not files:
            print("No migration files found in", MIGRATIONS_DIR)
            return
        for path in files:
            marker = "applied" if path.name in applied else "pending"
            print(f"[{marker:7s}] {path.name}")


def up():
    with appdb.get_connection() as conn:
        _ensure_tracking_table(conn)
        applied = _applied_versions(conn)
        pending = [p for p in _migration_files() if p.name not in applied]

        if not pending:
            print("Nothing to do -- all migrations already applied.")
            return

        for path in pending:
            print(f"Applying {path.name} ...")
            sql = path.read_text(encoding="utf-8")
            try:
                conn.execute(sql)
                conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s)", [path.name],
                )
                conn.commit()
            except Exception:
                conn.rollback()
                print(f"  FAILED -- rolled back. {path.name} was not recorded as applied.")
                raise
            print("  done")


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("up", "status"):
        print(__doc__)
        sys.exit(1)

    try:
        {"up": up, "status": status}[sys.argv[1]]()
    except appdb.ConfigError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

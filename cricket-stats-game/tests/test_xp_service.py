"""
test_xp_service.py

Integration tests for xp_service.award_game_xp() -- the DB-touching
half of Phase 4.5's XP system -- calling it directly against a real
Postgres connection, the same way game_persistence.complete_game()
does, without going through a full live game (test_xp_api.py covers
that end-to-end). Needs a real, reachable PostgreSQL and skips itself
(not fails) when one isn't configured, like test_auth.py.

Run with:  py -m pytest        (from inside cricket-stats-game/)
"""

import pytest

import appdb
import auth
import levels
import xp_service

_HEALTHY, _HEALTH_DETAIL = appdb.health_check()

pytestmark = pytest.mark.skipif(
    not _HEALTHY, reason=f"application database not reachable: {_HEALTH_DETAIL}",
)


@pytest.fixture(autouse=True)
def _clean_tables():
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM users")
        conn.execute("DELETE FROM games")
        conn.commit()
    yield
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM users")
        conn.execute("DELETE FROM games")
        conn.commit()


def _make_user(conn, username="xp_user", email="xp_user@example.com"):
    user = auth.create_user(conn, email, username, "password123")
    return user["id"]


def _make_bare_game(conn):
    """A minimal games row with no game_players -- xp_service.py never
    needs one; it operates purely on (user_id, db_game_id)."""
    row = conn.execute(
        "INSERT INTO games (status, game_mode, difficulty, rounds_total) "
        "VALUES ('finished', 'classic', 'normal', 1) RETURNING id",
    ).fetchone()
    conn.commit()
    return row[0]


ONE_ROUND_WIN = [{"difference": 0, "hintsUsed": 0, "duration_seconds": None}]


def test_award_creates_ledger_rows_and_updates_profile():
    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        game_id = _make_bare_game(conn)
        result = xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_id,
            player_rounds=ONE_ROUND_WIN, placement=1, timer_seconds=None,
        )
        rows = conn.execute(
            "SELECT reason, amount FROM xp_transactions WHERE user_id = %s ORDER BY reason", [user_id],
        ).fetchall()
        profile = conn.execute("SELECT xp, level FROM profiles WHERE user_id = %s", [user_id]).fetchone()

    reasons = {r: a for r, a in rows}
    assert reasons["GAME_COMPLETED"] == 50
    assert reasons["FIRST_PLACE"] == 200
    assert reasons["EXACT_TARGET"] == 75
    assert result["xpAwarded"] == 50 + 200 + 75
    assert result["oldXp"] == 0
    assert result["newXp"] == 325
    assert profile == (325, levels.level_for_xp(325))


def test_award_is_idempotent_on_a_repeated_call():
    """The exact scenario the phase brief calls out: completing the same
    game twice must not double the reward."""
    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        game_id = _make_bare_game(conn)
        first = xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_id,
            player_rounds=ONE_ROUND_WIN, placement=1, timer_seconds=None,
        )
        second = xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_id,
            player_rounds=ONE_ROUND_WIN, placement=1, timer_seconds=None,
        )
        row_count = conn.execute(
            "SELECT count(*) FROM xp_transactions WHERE user_id = %s", [user_id],
        ).fetchone()[0]
        profile = conn.execute("SELECT xp FROM profiles WHERE user_id = %s", [user_id]).fetchone()

    assert first["xpAwarded"] > 0
    assert second["xpAwarded"] == 0
    assert second["newXp"] == second["oldXp"] == first["newXp"]
    assert row_count == 3  # GAME_COMPLETED, FIRST_PLACE, EXACT_TARGET -- not 6
    assert profile[0] == first["newXp"]  # unaffected by the retry


def test_award_for_a_different_game_is_a_separate_ledger_entry():
    """Uniqueness is scoped to (user, game, reason) -- a genuinely new
    game must still earn its own GAME_COMPLETED etc., not be treated as
    a duplicate of a previous game's."""
    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        game_1 = _make_bare_game(conn)
        game_2 = _make_bare_game(conn)
        r1 = xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_1,
            player_rounds=[], placement=None, timer_seconds=None,
        )
        r2 = xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_2,
            player_rounds=[], placement=None, timer_seconds=None,
        )
        count = conn.execute(
            "SELECT count(*) FROM xp_transactions WHERE user_id = %s", [user_id],
        ).fetchone()[0]

    assert r1["xpAwarded"] == 50
    assert r2["xpAwarded"] == 50
    assert count == 2


def test_placements_beyond_third_earn_no_placement_bonus_row():
    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        game_id = _make_bare_game(conn)
        xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_id,
            player_rounds=[], placement=5, timer_seconds=None,
        )
        reasons = {r for (r,) in conn.execute(
            "SELECT reason FROM xp_transactions WHERE user_id = %s", [user_id],
        ).fetchall()}
    assert reasons == {"GAME_COMPLETED"}


def test_speed_bonus_ledger_row():
    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        game_id = _make_bare_game(conn)
        rounds = [{"difference": 9, "hintsUsed": 0, "duration_seconds": 5}]
        xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_id,
            player_rounds=rounds, placement=None, timer_seconds=30,
        )
        row = conn.execute(
            "SELECT amount FROM xp_transactions WHERE user_id = %s AND reason = 'SPEED_BONUS'", [user_id],
        ).fetchone()
    assert row is not None
    assert row[0] > 0


def test_hint_penalty_ledger_row_is_negative():
    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        game_id = _make_bare_game(conn)
        rounds = [{"difference": 9, "hintsUsed": 2, "duration_seconds": None}]
        xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_id,
            player_rounds=rounds, placement=None, timer_seconds=None,
        )
        row = conn.execute(
            "SELECT amount FROM xp_transactions WHERE user_id = %s AND reason = 'HINT_PENALTY'", [user_id],
        ).fetchone()
    assert row is not None
    assert row[0] < 0


def test_account_xp_never_goes_negative_even_after_a_heavy_hint_game():
    """The database CHECK constraint (profiles_xp_non_negative) plus
    xp_service.py's own GREATEST-style clamp: a brand new account (xp=0)
    finishing a hint-heavy game whose raw total is negative must still
    land at xp=0, never below."""
    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        game_id = _make_bare_game(conn)
        rounds = [{"difference": 9, "hintsUsed": 50, "duration_seconds": None}]
        result = xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_id,
            player_rounds=rounds, placement=None, timer_seconds=None,
        )
        profile = conn.execute("SELECT xp FROM profiles WHERE user_id = %s", [user_id]).fetchone()
    assert result["newXp"] == 0
    assert profile[0] == 0


def test_database_check_constraint_rejects_a_direct_negative_write():
    """Defense in depth: even bypassing xp_service.py entirely, the
    database itself refuses a negative profiles.xp."""
    import psycopg

    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE profiles SET xp = -1 WHERE user_id = %s", [user_id])
        conn.rollback()


def test_level_up_is_detected():
    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        game_id = _make_bare_game(conn)
        result = xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_id,
            player_rounds=ONE_ROUND_WIN, placement=1, timer_seconds=None,
        )
    assert result["leveledUp"] is True
    assert result["newLevel"] > result["oldLevel"]


def test_no_level_up_when_staying_within_the_same_level():
    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        game_id = _make_bare_game(conn)
        # No placement, no bonuses -- just the flat 50 XP completion
        # award, nowhere near enough to cross level 1's boundary.
        result = xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_id,
            player_rounds=[], placement=None, timer_seconds=None,
        )
    assert result["leveledUp"] is False
    assert result["newLevel"] == result["oldLevel"] == 1


def test_multiple_transactions_accumulate_correctly_across_games():
    with appdb.get_connection() as conn:
        user_id = _make_user(conn)
        for _ in range(3):
            game_id = _make_bare_game(conn)
            xp_service.award_game_xp(
                conn, user_id=user_id, db_game_id=game_id,
                player_rounds=[], placement=None, timer_seconds=None,
            )
        profile = conn.execute("SELECT xp FROM profiles WHERE user_id = %s", [user_id]).fetchone()
        tx_count = conn.execute(
            "SELECT count(*) FROM xp_transactions WHERE user_id = %s", [user_id],
        ).fetchone()[0]
    assert profile[0] == 150  # 3 games x 50 flat completion XP
    assert tx_count == 3


def test_award_with_missing_profile_is_a_safe_no_op():
    """A user_id with no profiles row at all (shouldn't happen in
    practice -- every account gets one at registration) must not crash;
    it's treated as nothing-to-credit rather than an error."""
    with appdb.get_connection() as conn:
        row = conn.execute(
            "INSERT INTO users (email, username, password_hash) "
            "VALUES ('noprofile@example.com', 'no_profile_user', 'x') RETURNING id",
        ).fetchone()
        user_id = row[0]
        conn.execute("DELETE FROM profiles WHERE user_id = %s", [user_id])
        conn.commit()
        game_id = _make_bare_game(conn)
        result = xp_service.award_game_xp(
            conn, user_id=user_id, db_game_id=game_id,
            player_rounds=[], placement=None, timer_seconds=None,
        )
    assert result is None

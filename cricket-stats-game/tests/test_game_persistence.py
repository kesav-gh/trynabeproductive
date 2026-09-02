"""
test_game_persistence.py

Tests for Phase 4.4: persisting an AUTHENTICATED user's game to
PostgreSQL (games, game_players, rounds, round_players, picks), the
read-only GET /api/games/history and GET /api/games/<id> endpoints built
on top of that data, and the guarantee that a GUEST's game never touches
any of it.

Like test_auth.py and test_profile.py, this whole file needs a real,
reachable PostgreSQL and skips itself (not fails) when one isn't
configured.

Run with:  py -m pytest        (from inside cricket-stats-game/)
"""

import psycopg
import pytest

import appdb
import game_persistence
import ratelimit
from conftest import csrf_post, eligible_pool, get, play_turn, post, start_game

_HEALTHY, _HEALTH_DETAIL = appdb.health_check()

pytestmark = pytest.mark.skipif(
    not _HEALTHY, reason=f"application database not reachable: {_HEALTH_DETAIL}",
)


@pytest.fixture(autouse=True)
def _clean_tables_and_rate_limits():
    """games cascades to game_players/rounds/round_players/picks (see
    0001_initial_schema.sql's ON DELETE CASCADE chain) -- deleting it
    alone is enough to clear every table this file touches, alongside
    the users table test_auth.py/test_profile.py already clean."""
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM users")
        conn.execute("DELETE FROM games")
        conn.commit()
    ratelimit.reset()
    yield
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM users")
        conn.execute("DELETE FROM games")
        conn.commit()
    ratelimit.reset()


def register(client, username="game_owner", email="owner@example.com"):
    status, body = csrf_post(client, "/api/auth/register", {
        "email": email, "username": username,
        "password": "password123", "confirmPassword": "password123",
    })
    assert status == 201, body
    return body["data"]["user"]


# Pinned to a large, reliable pool -- see test_api.py's own
# test_valid_pick_is_accepted_and_scored and conftest.py's play_turn
# docstring for why an unconstrained random question's pool can
# otherwise be small enough to exhaust, unrelated to whatever this
# module's own tests are actually checking.
RELIABLE_MODE = {"stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"}


def finish_one_round_game(client, player_names):
    """Starts a 1-round game and plays it all the way to `finished` --
    both the round itself AND the play-again call that commits history
    and marks the game finished. Returns the final /api/game/state-shaped
    response body (from that last play-again call)."""
    data = start_game(client, player_names, roundsTotal=1, mode=RELIABLE_MODE)
    pool = eligible_pool(data["question"])
    idx = 0
    for name in player_names:
        post(client, "/api/game/next-turn")
        idx = play_turn(client, name, pool, idx)
    status, body = post(client, "/api/game/play-again")
    assert status == 200, body
    assert body["data"]["status"] == "finished"
    return body


# ---------------------------------------------------------------------------
# Authenticated games are persisted
# ---------------------------------------------------------------------------

def test_authenticated_game_creates_a_games_row(client):
    register(client)
    start_game(client, ["Owner", "Guest Two"])
    with appdb.get_connection() as conn:
        row = conn.execute("SELECT status, difficulty FROM games").fetchone()
    assert row == ("in_progress", "normal")


def test_start_game_reports_history_sync_ok_when_persisted(client):
    register(client)
    data = start_game(client, ["Owner", "Guest Two"])
    assert data["historySyncOk"] is True


def test_guest_game_history_sync_field_is_null(client):
    data = start_game(client, ["Alice", "Bob"])
    assert data["historySyncOk"] is None


def test_authenticated_user_is_seat_zero_guests_are_named_seats(client):
    user = register(client)
    start_game(client, ["Owner", "Guest Two"])
    with appdb.get_connection() as conn:
        rows = conn.execute(
            "SELECT user_id, guest_name, player_order FROM game_players ORDER BY player_order",
        ).fetchall()
    assert rows[0] == (user["id"], "Owner", 0)
    assert rows[1] == (None, "Guest Two", 1)


def test_first_round_is_persisted_at_game_start(client):
    register(client)
    start_game(client, ["Owner", "Guest Two"])
    with appdb.get_connection() as conn:
        row = conn.execute("SELECT round_number, status, target FROM rounds").fetchone()
    assert row[0] == 1
    assert row[1] == "in_progress"
    assert isinstance(row[2], int)


def test_round_completion_persists_scores_and_picks(client):
    register(client)
    finish_one_round_game(client, ["Owner", "Guest Two"])
    with appdb.get_connection() as conn:
        round_row = conn.execute(
            "SELECT id, status FROM rounds WHERE round_number = 1",
        ).fetchone()
        assert round_row[1] == "complete"
        rp_rows = conn.execute(
            "SELECT score, difference, hints_used FROM round_players WHERE round_id = %s",
            [round_row[0]],
        ).fetchall()
        pick_rows = conn.execute(
            """
            SELECT p.selected_name, p.stat_value FROM picks p
            JOIN round_players rp ON rp.id = p.round_player_id
            WHERE rp.round_id = %s
            """,
            [round_row[0]],
        ).fetchall()
    assert len(rp_rows) == 2  # one per player
    for score, difference, hints_used in rp_rows:
        assert isinstance(score, int)
        assert isinstance(difference, int)
        assert hints_used == 0
    assert len(pick_rows) > 0
    for name, value in pick_rows:
        assert isinstance(name, str) and name
        assert isinstance(value, int)


def test_game_completion_sets_status_and_final_placements(client):
    register(client)
    finish_one_round_game(client, ["Owner", "Guest Two"])
    with appdb.get_connection() as conn:
        game_row = conn.execute("SELECT status, finished_at FROM games").fetchone()
        gp_rows = conn.execute("SELECT final_score, placement FROM game_players").fetchall()
    assert game_row[0] == "finished"
    assert game_row[1] is not None
    # [1, 2] on a clear winner, or [1, 1] on a genuine tie (both seats
    # scored identically) -- game_persistence.py's own placement ranking
    # gives tied scores the same rank, exactly like a real joint win
    # elsewhere in this app, so a tie here is a valid outcome, not a bug.
    placements = sorted(p for _, p in gp_rows)
    assert placements in ([1, 2], [1, 1])
    for score, _ in gp_rows:
        assert isinstance(score, int)


# ---------------------------------------------------------------------------
# Guests are never persisted, and are unaffected by Postgres outages
# ---------------------------------------------------------------------------

def test_guest_game_creates_no_database_rows(client):
    finish_one_round_game(client, ["Alice", "Bob"])
    with appdb.get_connection() as conn:
        count = conn.execute("SELECT count(*) FROM games").fetchone()[0]
    assert count == 0


def test_guest_gameplay_unaffected_by_database_outage(client, monkeypatch):
    def _broken():
        raise appdb.ConfigError("simulated outage")

    monkeypatch.setattr(appdb, "get_connection", _broken)
    result = finish_one_round_game(client, ["Alice", "Bob"])
    assert result["data"]["status"] == "finished"
    assert result["data"]["historySyncOk"] is None


# ---------------------------------------------------------------------------
# Failure handling for an AUTHENTICATED game -- see api.py's Phase 4.4
# persistence section for why these two are deliberately different.
# ---------------------------------------------------------------------------

def test_database_failure_at_game_start_is_fatal_and_safe(client, monkeypatch):
    register(client)

    def _broken(*a, **k):
        raise psycopg.errors.OperationalError("simulated: postgresql://user:secret@host/db unreachable")

    monkeypatch.setattr(game_persistence, "start_persisted_game", _broken)
    status, body = post(client, "/api/game/start", {"playerNames": ["Owner", "Guest Two"]})
    assert status == 503
    assert body["error"]["code"] == "DATABASE_ERROR"
    dumped = str(body)
    assert "OperationalError" not in dumped
    assert "secret" not in dumped
    assert "postgresql://" not in dumped

    with appdb.get_connection() as conn:
        count = conn.execute("SELECT count(*) FROM games").fetchone()[0]
    assert count == 0  # nothing half-created


def test_round_completion_failure_does_not_break_authenticated_gameplay(client, monkeypatch):
    """The session is authoritative -- a Postgres hiccup mid-game must
    never be the thing that stops an authenticated player from finishing
    their game, only the thing that stops this round from making it into
    permanent history (surfaced honestly via historySyncOk, not hidden)."""
    register(client)
    data = start_game(client, ["Owner", "Guest Two"], roundsTotal=1, mode=RELIABLE_MODE)

    monkeypatch.setattr(
        game_persistence, "complete_round",
        lambda *a, **k: (_ for _ in ()).throw(psycopg.errors.OperationalError("simulated")),
    )

    pool = eligible_pool(data["question"])
    idx = 0
    for name in ["Owner", "Guest Two"]:
        post(client, "/api/game/next-turn")
        idx = play_turn(client, name, pool, idx)
    status, body = post(client, "/api/game/play-again")

    assert status == 200
    assert body["data"]["status"] == "finished"
    assert body["data"]["historySyncOk"] is False

    with appdb.get_connection() as conn:
        round_row = conn.execute("SELECT status FROM rounds WHERE round_number = 1").fetchone()
    assert round_row[0] == "in_progress"  # the failed write really didn't land


# ---------------------------------------------------------------------------
# Transactions -- an all-or-nothing bundle, not a partial write
# ---------------------------------------------------------------------------

def test_transaction_rolls_back_on_partial_failure():
    """A seat with neither a user_id nor a guest_name violates
    game_players' own CHECK constraint partway through the atomic
    game-creation bundle -- nothing before that point (the games row
    itself) should survive, since nothing is committed until every
    insert in the bundle has already succeeded."""
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM games")
        conn.commit()
        with pytest.raises(psycopg.Error):
            game_persistence.start_persisted_game(
                conn, difficulty="normal", rounds_total=1,
                player_names=[None], owner_user_id=None,
                question={"question_text": "x", "num_players": 1}, target=100,
            )
        conn.rollback()
        count = conn.execute("SELECT count(*) FROM games").fetchone()[0]
    assert count == 0


# ---------------------------------------------------------------------------
# Idempotency -- calling the persistence layer twice with the same
# arguments (what a genuine retry would look like) must never duplicate
# or corrupt anything.
# ---------------------------------------------------------------------------

def _seed_one_round_game(conn):
    return game_persistence.start_persisted_game(
        conn, difficulty="normal", rounds_total=1, player_names=["A", "B"],
        owner_user_id=None, question={"question_text": "x", "num_players": 1}, target=100,
    )


def test_completing_the_same_round_twice_does_not_duplicate_rows():
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM games")
        conn.commit()
        _db_game_id, player_ids, round_id = _seed_one_round_game(conn)
        standings = [
            {"participant_name": "A", "picks": [{"playerName": "P1", "value": 100}],
             "difference": 0, "score": 900, "hintsUsed": 0, "duration_seconds": 5.0},
            {"participant_name": "B", "picks": [{"playerName": "P2", "value": 50}],
             "difference": 50, "score": 400, "hintsUsed": 1, "duration_seconds": 6.0},
        ]
        game_persistence.complete_round(conn, round_id, standings, player_ids)
        game_persistence.complete_round(conn, round_id, standings, player_ids)  # retry

        rp_count = conn.execute(
            "SELECT count(*) FROM round_players WHERE round_id = %s", [round_id],
        ).fetchone()[0]
        pick_count = conn.execute(
            """
            SELECT count(*) FROM picks p JOIN round_players rp ON rp.id = p.round_player_id
            WHERE rp.round_id = %s
            """,
            [round_id],
        ).fetchone()[0]
        conn.commit()
    assert rp_count == 2   # one per player, not four
    assert pick_count == 2  # one per player's single pick, not duplicated


def test_completing_the_same_game_twice_does_not_reopen_or_overwrite():
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM games")
        conn.commit()
        db_game_id, player_ids, _round_id = _seed_one_round_game(conn)

        game_persistence.complete_game(conn, db_game_id, {"A": 900, "B": 400}, player_ids, [], None)
        # A retried completion with different numbers must be a no-op --
        # the game is already 'finished', so this must not reopen it or
        # silently overwrite the real result.
        game_persistence.complete_game(conn, db_game_id, {"A": 111, "B": 222}, player_ids, [], None)

        row = conn.execute(
            "SELECT final_score FROM game_players WHERE id = %s", [player_ids["A"]],
        ).fetchone()
        status_row = conn.execute("SELECT status FROM games WHERE id = %s", [db_game_id]).fetchone()
        conn.commit()
    assert row[0] == 900
    assert status_row[0] == "finished"


def test_repeated_history_requests_do_not_mutate_data(client):
    register(client)
    finish_one_round_game(client, ["Owner", "Guest Two"])
    _, first = get(client, "/api/games/history")
    _, second = get(client, "/api/games/history")
    assert first == second


# ---------------------------------------------------------------------------
# History API
# ---------------------------------------------------------------------------

def test_history_requires_authentication(client):
    status, body = get(client, "/api/games/history")
    assert status == 401
    assert body["error"]["code"] == "NOT_AUTHENTICATED"


def test_history_empty_state(client):
    register(client)
    status, body = get(client, "/api/games/history")
    assert status == 200
    assert body["data"]["games"] == []
    assert body["data"]["hasMore"] is False


def test_history_lists_completed_games(client):
    register(client)
    finish_one_round_game(client, ["Owner", "Guest Two"])
    status, body = get(client, "/api/games/history")
    games = body["data"]["games"]
    assert len(games) == 1
    assert games[0]["status"] == "finished"
    assert games[0]["finalScore"] is not None
    assert games[0]["placement"] in (1, 2)


def test_history_excludes_games_still_in_progress(client):
    register(client)
    start_game(client, ["Owner", "Guest Two"])  # never finished
    status, body = get(client, "/api/games/history")
    assert body["data"]["games"] == []


def test_history_lists_multiple_games(client):
    register(client)
    finish_one_round_game(client, ["Owner", "Guest Two"])
    finish_one_round_game(client, ["Owner", "Guest Three"])
    status, body = get(client, "/api/games/history")
    assert len(body["data"]["games"]) == 2


def test_history_is_never_cached(client):
    register(client)
    r = client.get("/api/games/history")
    assert r.headers.get("Cache-Control") == "no-store"


# ---------------------------------------------------------------------------
# Single-game detail + ownership
# ---------------------------------------------------------------------------

def test_game_detail_returns_full_structure(client):
    register(client)
    finish_one_round_game(client, ["Owner", "Guest Two"])
    _, history_body = get(client, "/api/games/history")
    game_id = history_body["data"]["games"][0]["gameId"]

    status, body = get(client, f"/api/games/{game_id}")
    assert status == 200
    data = body["data"]
    assert data["gameId"] == game_id
    assert data["status"] == "finished"
    assert len(data["players"]) == 2
    assert len(data["rounds"]) == 1
    assert data["rounds"][0]["status"] == "complete"
    assert len(data["rounds"][0]["players"]) == 2


def test_game_detail_is_never_cached(client):
    register(client)
    finish_one_round_game(client, ["Owner", "Guest Two"])
    _, history_body = get(client, "/api/games/history")
    game_id = history_body["data"]["games"][0]["gameId"]
    r = client.get(f"/api/games/{game_id}")
    assert r.headers.get("Cache-Control") == "no-store"


def test_cross_user_cannot_access_another_users_game():
    import app as flask_app_module

    client_a = flask_app_module.app.test_client()
    client_b = flask_app_module.app.test_client()

    register(client_a, username="user_alpha", email="alpha@example.com")
    finish_one_round_game(client_a, ["Alpha", "Guest"])
    _, history_a = get(client_a, "/api/games/history")
    game_id = history_a["data"]["games"][0]["gameId"]

    register(client_b, username="user_beta", email="beta@example.com")
    status, body = get(client_b, f"/api/games/{game_id}")
    assert status == 404
    assert body["error"]["code"] == "NOT_FOUND"


def test_unknown_game_id_is_404(client):
    register(client)
    status, body = get(client, "/api/games/999999999")
    assert status == 404


def test_game_detail_requires_authentication(client):
    status, body = get(client, "/api/games/1")
    assert status == 401
    assert body["error"]["code"] == "NOT_AUTHENTICATED"


# ---------------------------------------------------------------------------
# Score integrity -- nothing a client submits ever becomes the persisted
# score. There is no field anywhere in the pick/play-again request bodies
# a client could use to set one; this confirms what actually lands in
# Postgres is the exact number the server's own scoring produced.
# ---------------------------------------------------------------------------

def test_persisted_scores_match_server_computed_cumulative_scores(client):
    register(client)
    result = finish_one_round_game(client, ["Owner", "Guest Two"])
    wire_scores = result["data"]["cumulativeScores"]
    with appdb.get_connection() as conn:
        rows = conn.execute("SELECT guest_name, final_score FROM game_players").fetchall()
    db_scores = dict(rows)
    assert db_scores == wire_scores

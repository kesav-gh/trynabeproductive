"""
test_xp_api.py

End-to-end tests for Phase 4.5's XP system, driven through the real
HTTP API (game start -> play -> play-again -> GET /api/profile/
progression) exactly like a real browser session, complementing
test_xp_rules.py (pure formula) and test_xp_service.py (direct
persistence-layer calls). Needs a real, reachable PostgreSQL and skips
itself (not fails) when one isn't configured.

Run with:  py -m pytest        (from inside cricket-stats-game/)
"""

import pytest

import appdb
import ratelimit
from conftest import csrf_post, eligible_pool, get, play_turn, post, start_game

_HEALTHY, _HEALTH_DETAIL = appdb.health_check()

pytestmark = pytest.mark.skipif(
    not _HEALTHY, reason=f"application database not reachable: {_HEALTH_DETAIL}",
)


@pytest.fixture(autouse=True)
def _clean_tables_and_rate_limits():
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


def register(client, username="xp_player", email="xp_player@example.com"):
    status, body = csrf_post(client, "/api/auth/register", {
        "email": email, "username": username,
        "password": "password123", "confirmPassword": "password123",
    })
    assert status == 201, body
    return body["data"]["user"]


# Pinned to a large, reliable pool for the same reason test_api.py's own
# test_valid_pick_is_accepted_and_scored is -- an unconstrained random
# question can land on a narrow role/stat/country combo whose pool is
# small enough that play_turn()'s pre-existing, documented "some pool
# entries are genuinely unresolvable through name_match" allowance (see
# conftest.py's play_turn docstring) can exhaust it entirely. These
# tests care about XP bookkeeping, not which question was asked, so
# there's nothing lost by always using a pool this big.
RELIABLE_MODE = {"stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"}


def finish_one_round_game(client, player_names, **kwargs):
    kwargs.setdefault("mode", RELIABLE_MODE)
    data = start_game(client, player_names, roundsTotal=1, **kwargs)
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
# Award on completion
# ---------------------------------------------------------------------------

def test_completed_authenticated_game_awards_xp(client):
    register(client)
    result = finish_one_round_game(client, ["Owner", "Guest2"])
    assert result["data"]["xp"] is not None
    assert result["data"]["xp"]["xpAwarded"] > 0


def test_guest_game_receives_no_xp_field(client):
    result = finish_one_round_game(client, ["Alice", "Bob"])
    assert result["data"]["xp"] is None


def test_guest_game_creates_no_xp_transactions(client):
    finish_one_round_game(client, ["Alice", "Bob"])
    with appdb.get_connection() as conn:
        count = conn.execute("SELECT count(*) FROM xp_transactions").fetchone()[0]
    assert count == 0


def test_xp_transaction_is_linked_to_the_authenticated_users_account(client):
    user = register(client)
    finish_one_round_game(client, ["Owner", "Guest2"])
    with appdb.get_connection() as conn:
        rows = conn.execute(
            "SELECT user_id FROM xp_transactions",
        ).fetchall()
    assert len(rows) > 0
    assert all(r[0] == user["id"] for r in rows)


# ---------------------------------------------------------------------------
# Unfinished / abandoned games
# ---------------------------------------------------------------------------

def test_unfinished_game_awards_no_xp(client):
    register(client)
    start_game(client, ["Owner", "Guest2"], roundsTotal=3, mode=RELIABLE_MODE)  # never completed
    with appdb.get_connection() as conn:
        count = conn.execute("SELECT count(*) FROM xp_transactions").fetchone()[0]
    assert count == 0


def test_a_single_completed_round_of_a_multi_round_game_does_not_yet_award_xp(client):
    """XP is a GAME-level reward, not a round-level one -- finishing
    round 1 of a 3-round game must not pay out early."""
    register(client)
    data = start_game(client, ["Owner", "Guest2"], roundsTotal=3, mode=RELIABLE_MODE)
    pool = eligible_pool(data["question"])
    idx = 0
    for name in ["Owner", "Guest2"]:
        post(client, "/api/game/next-turn")
        idx = play_turn(client, name, pool, idx)
    status, body = post(client, "/api/game/play-again")
    assert status == 200
    assert body["data"]["status"] == "in_progress"  # 2 rounds still to go
    assert body["data"]["xp"] is None
    with appdb.get_connection() as conn:
        count = conn.execute("SELECT count(*) FROM xp_transactions").fetchone()[0]
    assert count == 0


# ---------------------------------------------------------------------------
# Duplicate completion / retries never duplicate XP
# ---------------------------------------------------------------------------

def test_repeated_play_again_after_completion_does_not_duplicate_xp(client):
    register(client)
    finish_one_round_game(client, ["Owner", "Guest2"])
    with appdb.get_connection() as conn:
        xp_after_first = conn.execute("SELECT xp FROM profiles").fetchone()[0]
        tx_count_after_first = conn.execute("SELECT count(*) FROM xp_transactions").fetchone()[0]
    assert tx_count_after_first >= 1  # at least GAME_COMPLETED

    # "Play Again clicked repeatedly" / "browser refreshes" / "request
    # retried" all land here: the game is already finished, so this
    # must be rejected before ever reaching the XP code path again.
    for _ in range(3):
        status, body = post(client, "/api/game/play-again")
        assert status == 409
        assert body["error"]["code"] == "GAME_FINISHED"

    with appdb.get_connection() as conn:
        xp_after_retries = conn.execute("SELECT xp FROM profiles").fetchone()[0]
        tx_count_after_retries = conn.execute("SELECT count(*) FROM xp_transactions").fetchone()[0]

    assert xp_after_retries == xp_after_first
    assert tx_count_after_retries == tx_count_after_first


def _reasons_awarded():
    with appdb.get_connection() as conn:
        return {r for (r,) in conn.execute("SELECT DISTINCT reason FROM xp_transactions").fetchall()}


def test_multi_round_game_awards_xp_exactly_once_on_final_completion(client):
    register(client)
    data = start_game(client, ["Owner", "Guest2"], roundsTotal=3, mode=RELIABLE_MODE)

    for round_num in range(3):
        status, body = get(client, "/api/game/state")
        pool = eligible_pool(body["data"]["question"])
        idx = 0
        for name in ["Owner", "Guest2"]:
            post(client, "/api/game/next-turn")
            idx = play_turn(client, name, pool, idx)
        status, body = post(client, "/api/game/play-again")
        assert status == 200, body

    assert body["data"]["status"] == "finished"
    assert body["data"]["xp"] is not None
    with appdb.get_connection() as conn:
        game_completed_rows = conn.execute(
            "SELECT count(*) FROM xp_transactions WHERE reason = 'GAME_COMPLETED'",
        ).fetchone()[0]
    assert game_completed_rows == 1  # once for the whole game, not once per round


# ---------------------------------------------------------------------------
# Placement-specific XP through the real flow (two-account game via two
# clients isn't meaningful here -- placement in THIS app's pass-and-play
# model is about the account-linked seat vs its own local opponents, so
# these check that the placement bonus reflects the account seat's
# actual final standing).
# ---------------------------------------------------------------------------

def test_xp_awarded_reflects_the_account_seats_actual_placement(client):
    register(client)
    result = finish_one_round_game(client, ["Owner", "Guest2"])
    with appdb.get_connection() as conn:
        placement_row = conn.execute(
            """
            SELECT gp.placement FROM game_players gp
            JOIN games g ON g.id = gp.game_id
            WHERE gp.user_id IS NOT NULL
            ORDER BY g.id DESC LIMIT 1
            """,
        ).fetchone()
        reasons = _reasons_awarded()
    placement = placement_row[0]
    expected_reason = {1: "FIRST_PLACE", 2: "SECOND_PLACE"}.get(placement)
    if expected_reason:
        assert expected_reason in reasons
    assert result["data"]["xp"]["xpAwarded"] > 0


# ---------------------------------------------------------------------------
# GET /api/profile/progression
# ---------------------------------------------------------------------------

def test_progression_requires_authentication(client):
    status, body = get(client, "/api/profile/progression")
    assert status == 401
    assert body["error"]["code"] == "NOT_AUTHENTICATED"


def test_progression_reflects_zero_xp_for_a_brand_new_account(client):
    register(client)
    status, body = get(client, "/api/profile/progression")
    assert status == 200
    data = body["data"]
    assert data["xp"] == 0
    assert data["level"] == 1
    assert data["progressPercent"] == 0.0


def test_progression_reflects_xp_after_a_completed_game(client):
    register(client)
    finish_one_round_game(client, ["Owner", "Guest2"])
    status, body = get(client, "/api/profile/progression")
    assert status == 200
    assert body["data"]["xp"] > 0


def test_progression_is_never_cached(client):
    register(client)
    r = client.get("/api/profile/progression")
    assert r.headers.get("Cache-Control") == "no-store"


def test_progression_never_exposes_internal_ledger_fields(client):
    register(client)
    finish_one_round_game(client, ["Owner", "Guest2"])
    status, body = get(client, "/api/profile/progression")
    data = body["data"]
    assert set(data.keys()) == {"xp", "level", "nextLevelXp", "xpIntoLevel", "xpToNextLevel", "progressPercent"}


# ---------------------------------------------------------------------------
# Security -- cross-user isolation and "the client can't set this"
# ---------------------------------------------------------------------------

def test_cannot_view_another_users_progression_via_query_param(client):
    """There is no user_id parameter this endpoint reads at all -- the
    signed-in caller's OWN progression is always what comes back,
    regardless of what a query string claims."""
    register(client, username="user_a", email="a@example.com")
    finish_one_round_game(client, ["Owner", "Guest2"])
    _, own = get(client, "/api/profile/progression")

    import app as flask_app_module
    other_client = flask_app_module.app.test_client()
    register(other_client, username="user_b", email="b@example.com")
    _, other_before = get(other_client, "/api/profile/progression")
    assert other_before["data"]["xp"] == 0

    # Attempting to ask for user_a's data through user_b's own session.
    r = other_client.get(f"/api/profile/progression?user_id={_user_id_for(client)}")
    assert r.status_code == 200
    assert r.get_json()["data"]["xp"] == 0  # still user_b's own (zero) progression, not user_a's


def _user_id_for(client):
    status, body = get(client, "/api/auth/me")
    return body["data"]["user"]["id"]


def test_start_game_ignores_a_client_supplied_xp_field(client):
    """No endpoint anywhere accepts an xp/level/placement field -- this
    confirms sending one is simply ignored, not silently honoured."""
    register(client)
    status, body = post(client, "/api/game/start", {
        "playerNames": ["Owner", "Guest2"], "roundsTotal": 1,
        "xp": 999999, "level": 99, "placement": 1,
    })
    assert status == 200
    with appdb.get_connection() as conn:
        xp_row = conn.execute("SELECT xp FROM profiles").fetchone()
    assert xp_row[0] == 0  # unaffected -- no game has finished yet


def test_play_again_ignores_a_client_supplied_xp_field(client):
    register(client)
    data = start_game(client, ["Owner", "Guest2"], roundsTotal=1, mode=RELIABLE_MODE)
    pool = eligible_pool(data["question"])
    idx = 0
    for name in ["Owner", "Guest2"]:
        post(client, "/api/game/next-turn")
        idx = play_turn(client, name, pool, idx)
    status, body = post(client, "/api/game/play-again", {"xp": 999999, "xpAwarded": 999999, "level": 99})
    assert status == 200
    awarded = body["data"]["xp"]["xpAwarded"]
    assert awarded < 999999  # the server's own small, real calculation -- never the submitted value


def test_database_failure_during_completion_never_leaks_internals(client, monkeypatch):
    import psycopg
    import xp_service

    register(client)
    data = start_game(client, ["Owner", "Guest2"], roundsTotal=1, mode=RELIABLE_MODE)

    def _broken(*a, **k):
        raise psycopg.errors.OperationalError("simulated: postgresql://user:secret@host/db")

    monkeypatch.setattr(xp_service, "award_game_xp", _broken)

    pool = eligible_pool(data["question"])
    idx = 0
    for name in ["Owner", "Guest2"]:
        post(client, "/api/game/next-turn")
        idx = play_turn(client, name, pool, idx)
    status, body = post(client, "/api/game/play-again")

    # game_persistence.complete_game()'s failure is caught by api.py's
    # best-effort _try_persist (Phase 4.4 behaviour) -- gameplay still
    # finishes successfully, it just didn't sync to history/XP this time.
    assert status == 200
    assert body["data"]["status"] == "finished"
    assert body["data"]["historySyncOk"] is False
    dumped = str(body)
    assert "postgresql://" not in dumped
    assert "secret" not in dumped
    assert "OperationalError" not in dumped

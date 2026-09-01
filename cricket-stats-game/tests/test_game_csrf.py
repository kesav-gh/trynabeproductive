"""
test_game_csrf.py

Tests for Phase 4.4.1: CSRF protection extended to every state-changing
game route (start/pick/ambiguous/next-turn/hint/play-again), using the
exact same double-submit-cookie mechanism csrf.py already implements for
the auth endpoints -- see csrf.py and api.py's module docstring for why.

Unlike test_auth.py/test_profile.py/test_game_persistence.py, this file
does NOT need PostgreSQL -- CSRF is checked before any database access,
and the guest-game tests here never touch appdb at all. It always runs.

Run with:  py -m pytest        (from inside cricket-stats-game/)
"""

import json

import pytest

import appdb
from conftest import csrf_post, get, post

_HEALTHY, _HEALTH_DETAIL = appdb.health_check()
needs_database = pytest.mark.skipif(
    not _HEALTHY, reason=f"application database not reachable: {_HEALTH_DETAIL}",
)


@pytest.fixture(autouse=True)
def _clean_users_table():
    """Only the two DB-backed tests below (@needs_database) ever create a
    real user row -- cheap to clean up unconditionally either way,
    matching test_auth.py's own pattern, and a no-op when Postgres isn't
    reachable at all."""
    if not _HEALTHY:
        yield
        return
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM users")
        conn.commit()
    yield
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM users")
        conn.commit()


def _csrf_cookie(client):
    """Ensures this client has a csrf_token cookie (a real page load
    always triggers one via GET /api/auth/me first) and returns its
    value."""
    if client.get_cookie("csrf_token") is None:
        client.get("/api/auth/me")
    return client.get_cookie("csrf_token").value


def _raw_post(client, path, body, headers=None):
    return client.post(
        path, data=json.dumps(body), content_type="application/json",
        headers=headers or {},
    )


MUTATING_ENDPOINTS = [
    ("/api/game/start", {"playerNames": ["Alice", "Bob"]}),
    ("/api/game/next-turn", {}),
    ("/api/game/pick", {"typed": "zzznotarealplayer"}),
    ("/api/game/ambiguous", {"playerId": "1"}),
    ("/api/game/hint", {"type": "country"}),
    ("/api/game/play-again", {}),
]


# ---------------------------------------------------------------------------
# Missing / invalid / valid token -- one representative endpoint
# (/api/game/start), since every mutating route shares the identical
# csrf.protect wrapper; the parametrized sweep below then confirms EVERY
# route actually has it applied, not just this one.
# ---------------------------------------------------------------------------

def test_missing_csrf_token_is_rejected(client):
    _csrf_cookie(client)  # a cookie exists, but no header is sent
    r = _raw_post(client, "/api/game/start", {"playerNames": ["Alice", "Bob"]})
    assert r.status_code == 403
    assert r.get_json()["error"]["code"] == "CSRF_FAILURE"


def test_missing_csrf_token_with_no_cookie_at_all_is_rejected(client):
    """The very first request from a totally fresh client (no cookie
    jar yet at all) -- still rejected, and the response carries a fresh
    csrf_token cookie for the next attempt, exactly like a fresh visit
    to any auth endpoint already behaves."""
    r = _raw_post(client, "/api/game/start", {"playerNames": ["Alice", "Bob"]})
    assert r.status_code == 403
    assert r.get_json()["error"]["code"] == "CSRF_FAILURE"
    assert client.get_cookie("csrf_token") is not None


def test_invalid_csrf_token_is_rejected(client):
    _csrf_cookie(client)
    r = _raw_post(
        client, "/api/game/start", {"playerNames": ["Alice", "Bob"]},
        headers={"X-CSRF-Token": "not-the-right-value"},
    )
    assert r.status_code == 403
    assert r.get_json()["error"]["code"] == "CSRF_FAILURE"


def test_valid_csrf_token_is_accepted(client):
    token = _csrf_cookie(client)
    r = _raw_post(
        client, "/api/game/start", {"playerNames": ["Alice", "Bob"]},
        headers={"X-CSRF-Token": token},
    )
    assert r.status_code == 200
    assert r.get_json()["data"]["status"] == "in_progress"


def test_csrf_failure_response_is_clean_json_with_no_internal_detail(client):
    _csrf_cookie(client)
    r = _raw_post(client, "/api/game/start", {"playerNames": ["Alice", "Bob"]})
    body = r.get_json()
    assert set(body.keys()) == {"error"}
    assert set(body["error"].keys()) == {"code", "message"}
    dumped = json.dumps(body)
    assert "Traceback" not in dumped
    assert "session" not in dumped.lower()
    assert "cookie" not in dumped.lower()


# ---------------------------------------------------------------------------
# Every mutating game endpoint is actually protected -- not just /start.
# A missing token is rejected at every one of them; a valid token still
# lets each of them do its normal job.
# ---------------------------------------------------------------------------

def test_every_mutating_game_endpoint_rejects_a_missing_csrf_token(client):
    _csrf_cookie(client)
    for path, body in MUTATING_ENDPOINTS:
        r = _raw_post(client, path, body)
        assert r.status_code == 403, f"{path} did not require CSRF"
        assert r.get_json()["error"]["code"] == "CSRF_FAILURE"


def test_every_mutating_game_endpoint_accepts_a_valid_csrf_token(client):
    """Doesn't assert each call's own game-logic outcome (a fresh client
    has no active game, so pick/ambiguous/hint/play-again all correctly
    404 as NO_ACTIVE_GAME) -- only that CSRF itself never blocks them
    when a correct token is presented, i.e. none of them ever return the
    403 CSRF_FAILURE this whole file is about."""
    token = _csrf_cookie(client)
    for path, body in MUTATING_ENDPOINTS:
        r = _raw_post(client, path, body, headers={"X-CSRF-Token": token})
        assert r.status_code != 403 or r.get_json()["error"]["code"] != "CSRF_FAILURE", path


# ---------------------------------------------------------------------------
# GET requests remain safe -- no token required, ever.
# ---------------------------------------------------------------------------

def test_get_endpoints_never_require_a_csrf_token(client):
    """A totally fresh client, zero cookies -- every GET route here must
    still work (or fail for its own game-logic reason, never CSRF)."""
    for path in ("/api/game/state", "/api/game/reveal", "/api/game/history", "/api/player/search?q=a"):
        status, body = get(client, path)
        assert status != 403 or body["error"]["code"] != "CSRF_FAILURE", path


# ---------------------------------------------------------------------------
# The actual attack this phase closes: a request that carries nothing but
# the victim's session cookie (exactly what a real CSRF attack can force
# a browser to send automatically) must be rejected even though the
# session itself is completely valid and would otherwise be accepted.
# ---------------------------------------------------------------------------

@needs_database
def test_authenticated_mutation_without_csrf_token_is_rejected_even_with_a_valid_session(client):
    """Simulates the actual attack: the attacker's page can make the
    victim's browser SEND the session cookie (that's what a CSRF exploit
    is), but cannot READ the csrf_token cookie to construct a matching
    header -- so a request carrying only the session, no header at all,
    must fail even though `session` alone would otherwise prove "this is
    really the signed-in victim." """
    status, body = csrf_post(client, "/api/auth/register", {
        "email": "csrf_victim@example.com", "username": "csrf_victim",
        "password": "password123", "confirmPassword": "password123",
    })
    assert status == 201, body  # now genuinely signed in, real session cookie

    # The forged request: real session cookie attached automatically by
    # the test client (exactly like a real browser would), but NO
    # X-CSRF-Token header -- nothing a cross-site attacker page could
    # ever construct.
    r = _raw_post(client, "/api/game/start", {"playerNames": ["Attacker", "Victim"]})
    assert r.status_code == 403
    assert r.get_json()["error"]["code"] == "CSRF_FAILURE"

    # And the same forged shape against an already-in-progress game's
    # mutation endpoints, for good measure.
    r = _raw_post(client, "/api/game/play-again", {})
    assert r.status_code == 403
    assert r.get_json()["error"]["code"] == "CSRF_FAILURE"


@needs_database
def test_authenticated_mutation_with_valid_csrf_token_succeeds(client):
    status, body = csrf_post(client, "/api/auth/register", {
        "email": "csrf_legit@example.com", "username": "csrf_legit",
        "password": "password123", "confirmPassword": "password123",
    })
    assert status == 201, body

    status, body = post(client, "/api/game/start", {"playerNames": ["Owner", "Friend"]})
    assert status == 200
    assert body["data"]["status"] == "in_progress"


def test_unauthenticated_mutation_without_csrf_token_is_rejected(client):
    """A guest (no session at all) is rejected on the SAME grounds --
    CSRF protection doesn't depend on being signed in."""
    r = _raw_post(client, "/api/game/start", {"playerNames": ["Alice", "Bob"]})
    assert r.status_code == 403
    assert r.get_json()["error"]["code"] == "CSRF_FAILURE"


def test_unauthenticated_mutation_with_valid_csrf_token_succeeds(client):
    """Guest gameplay keeps working -- CSRF protection is not the same
    thing as requiring an account; a guest just needs the same token any
    real page load already gives them."""
    status, body = post(client, "/api/game/start", {"playerNames": ["Alice", "Bob"]})
    assert status == 200
    assert body["data"]["status"] == "in_progress"
    assert body["data"]["historySyncOk"] is None  # still unpersisted, still a guest game


# ---------------------------------------------------------------------------
# Full guest playthrough still works end-to-end with CSRF enforced --
# the frontend's automatic header attachment (lib/api.ts) is what a real
# browser relies on; this proves the backend side of that contract holds
# across an entire game, not just one request.
# ---------------------------------------------------------------------------

def test_guest_can_still_play_a_full_round_with_csrf_enforced(client):
    from conftest import eligible_pool, play_turn, start_game

    # Pinned to a large, reliable pool -- see test_api.py's own
    # test_valid_pick_is_accepted_and_scored and conftest.py's play_turn
    # docstring for why an unconstrained random question's pool can
    # otherwise be small enough to exhaust, unrelated to CSRF.
    reliable_mode = {"stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"}
    data = start_game(client, ["Alice", "Bob"], roundsTotal=1, mode=reliable_mode)
    pool = eligible_pool(data["question"])
    idx = 0
    for name in ["Alice", "Bob"]:
        status, _ = post(client, "/api/game/next-turn")
        assert status == 200
        idx = play_turn(client, name, pool, idx)

    status, body = post(client, "/api/game/play-again")
    assert status == 200
    assert body["data"]["status"] == "finished"

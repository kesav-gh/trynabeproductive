"""
conftest.py

Having this file in cricket-stats-game/tests/ makes pytest treat
cricket-stats-game/ as the rootdir and put it on sys.path, so the plain
`import app`, `import question_gen`, etc. that every module in this
project already uses (assuming it's run from cricket-stats-game/) keep
working the same way for the test suite -- no package restructuring,
no changed imports anywhere.

Run with:  py -m pytest        (from inside cricket-stats-game/)
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

import app as flask_app_module
import question_gen

flask_app_module.app.config["TESTING"] = True

STAT_FUNCS = {
    "runs": question_gen.compute_runs,
    "wickets": question_gen.compute_wickets,
    "centuries": question_gen.compute_centuries,
    "five_fers": question_gen.compute_five_fers,
}


@pytest.fixture
def client():
    """A fresh Flask test client -- and with it a fresh session cookie
    jar -- for every test, so no test can see another's game state."""
    return flask_app_module.app.test_client()


@pytest.fixture
def app():
    """The app module itself, for tests that need direct DB access
    (app.con) rather than going through the HTTP test client."""
    return flask_app_module


def csrf_request(client, method, path, body=None):
    """Request with the double-submit CSRF header the auth/profile
    endpoints require (see csrf.py) -- fetches a token via GET
    /api/auth/me first if this client doesn't have one in its cookie jar
    yet, exactly like a real page load would before ever submitting a
    form. `body=None` (as opposed to `{}`) sends no request body at all,
    for methods like PATCH that need to test a truly empty/missing body."""
    if client.get_cookie("csrf_token") is None:
        client.get("/api/auth/me")
    token = client.get_cookie("csrf_token").value
    kwargs = {"headers": {"X-CSRF-Token": token}}
    if body is not None:
        kwargs["data"] = json.dumps(body)
        kwargs["content_type"] = "application/json"
    r = getattr(client, method.lower())(path, **kwargs)
    return r.status_code, r.get_json()


def csrf_post(client, path, body=None):
    """POST with the CSRF header -- see csrf_request. Kept as its own
    name since most callers only ever POST; `body=None` here means "send
    an empty {} object", matching how the auth endpoints that take no
    payload (logout, next-turn, ...) are actually called."""
    return csrf_request(client, "POST", path, body if body is not None else {})


def get_player_ids_by_name(con, name):
    """{player_id: country} for every row sharing an exact name -- for
    tests that need to name a SPECIFIC duplicate deterministically,
    rather than however name_match.py currently ranks them."""
    rows = con.execute(
        "SELECT player_id, country FROM players WHERE player_name = ?", [name]
    ).fetchall()
    return dict(rows)


def post(client, path, body=None):
    """POSTs with the CSRF header attached -- as of Phase 4.4.1 every
    mutating endpoint in this app (game included) requires one, so this
    generic helper (used throughout test_api.py) attaches it
    automatically rather than making every call site do so itself. A
    test that specifically wants to exercise CSRF-missing/invalid
    behavior calls client.post(...) directly instead of this helper --
    see test_game_csrf.py."""
    return csrf_post(client, path, body)


def get(client, path):
    r = client.get(path)
    return r.status_code, r.get_json()


def eligible_pool(question):
    """Real player names that satisfy `question`, straight from the same
    pool-building functions question_gen.py itself uses -- so tests never
    invent a fake player, they pick genuinely correct answers."""
    fn = STAT_FUNCS[question["stat"]]
    rows = fn(
        flask_app_module.con,
        question["format"],
        country=question["country"],
        role_bucket=question["roleBucket"],
    )
    return [r[1] for r in rows if r[2] and r[2] > 0]


def play_turn(client, player_name, pool, start_index=0):
    """Submits real, valid picks for `player_name` until their turn ends
    (or the pool runs out, which would be a test-data problem, not a
    product one). Resolves any ambiguous prompt by taking the first,
    most-prominent candidate. Returns the index into `pool` to resume
    from for the next player.

    A pool entry occasionally still comes back rejected, for one
    remaining REAL reason unrelated to the duplicate-name bug Phase 3.5
    fixed (api.py now threads a specific player_id through from
    name_match.py's own resolution -- an exact match or an explicit
    disambiguation choice -- so evaluate_guess() no longer has to
    re-guess by name alone; see question_gen.py's resolve_player() and
    resolve_player_by_id()):

    - NOT_FOUND, or a fuzzy match landing on an unrelated real player:
      question_gen.py's pool queries aren't restricted to name_match.py's
      ALLOWED_COUNTRIES allowlist, so an unconstrained question can
      include a real, eligible player (e.g. from Papua New Guinea) that
      name_match will never resolve through search at all -- not even
      via its fuzzy fallback, since that's filtered by the same
      allowlist. Pre-existing, out of scope, unrelated to name collisions.

    Either way, this just means trying the next pool entry.
    """
    i = start_index
    while True:
        status, body = get(client, "/api/game/state")
        if body["data"]["currentPlayerName"] != player_name:
            return i
        assert i < len(pool), "eligible pool exhausted -- test data problem"
        status, body = post(client, "/api/game/pick", {"typed": pool[i]})
        i += 1
        pending = body["data"]["pendingAmbiguous"]
        if pending:
            status, body = post(client, "/api/game/ambiguous", {"playerId": pending["candidates"][0]["playerId"]})
        if body["data"]["pickError"] is not None:
            assert body["data"]["pickError"]["code"] in ("NOT_FOUND", "REJECTED"), body["data"]["pickError"]
            continue  # try the next pool entry for this same player


def start_game(client, player_names, **kwargs):
    body = {"playerNames": player_names}
    body.update(kwargs)
    status, resp = post(client, "/api/game/start", body)
    assert status == 200, resp
    return resp["data"]


def play_full_round(client, player_names):
    """Starts nothing -- assumes a game already exists with `player_names`
    at the start of a fresh round -- and plays every player's turn out
    with real, valid picks. Returns the final /api/game/state response."""
    status, body = get(client, "/api/game/state")
    pool = eligible_pool(body["data"]["question"])
    idx = 0
    for name in player_names:
        post(client, "/api/game/next-turn")
        idx = play_turn(client, name, pool, idx)
    return get(client, "/api/game/state")

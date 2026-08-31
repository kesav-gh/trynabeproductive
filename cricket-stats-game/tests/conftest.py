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


def post(client, path, body=None):
    r = client.post(path, data=json.dumps(body if body is not None else {}), content_type="application/json")
    return r.status_code, r.get_json()


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

    A pool entry occasionally still comes back rejected, for two REAL,
    pre-existing reasons in code this project doesn't modify -- neither
    is a defect in api.py/game_state.py/scoring.py/difficulty.py:

    - NOT_FOUND: question_gen.py's pool queries aren't restricted to
      name_match.py's ALLOWED_COUNTRIES allowlist, so an unconstrained
      question can include a real, eligible player from a country
      name_match will never resolve through search.
    - REJECTED with a wrong country/role in the message: confirmed bug
      in question_gen.py's own resolve_player() -- it looks a typed name
      up by an EXACT STRING MATCH with an unranked .fetchone(), and the
      database contains multiple distinct players sharing an identical
      name (three different "Rashid Khan"s, for one real example). It can
      silently return the WRONG one, with the wrong country/role, even
      though the pool it came from was correctly keyed by player_id.
      name_match.py's resolve_player_fuzzy() already ranks same-name
      collisions by prominence for exactly this reason; resolve_player()
      has no equivalent. Out of scope to fix this phase -- reported
      separately -- so tests route around it the same way a real player
      hitting this would: try the next name.
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

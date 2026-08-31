"""
test_api.py

Backend tests for the JSON API (api.py) added in Phases 2-3. Everything
here drives the real Flask app against the real DuckDB database with
Flask's test client -- no mocking of the game engine itself, so a pass
here means the actual question generator, the actual name resolver and
the actual scoring math all agreed, not just that some stub did.

Run with:  py -m pytest        (from inside cricket-stats-game/)
"""

import json
import time

from conftest import eligible_pool, get, play_full_round, play_turn, post, start_game


# ---------------------------------------------------------------------------
# Game creation
# ---------------------------------------------------------------------------

def test_start_game_creates_a_real_question(client):
    data = start_game(client, ["Alice", "Bob"])
    q = data["question"]
    assert q["questionText"]
    assert q["stat"] in ("runs", "wickets", "centuries", "five_fers")
    assert q["numPlayers"] in (3, 5)
    assert isinstance(q["target"], int)
    assert data["currentPlayerName"] == "Alice"
    assert data["currentPlayerIndex"] == 0
    assert data["totalPlayers"] == 2
    assert data["gameId"]
    assert data["status"] == "in_progress"
    assert data["currentRound"] == 1


def test_start_game_rejects_too_few_players(client):
    status, body = post(client, "/api/game/start", {"playerNames": ["Solo"]})
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_start_game_rejects_duplicate_names(client):
    status, body = post(client, "/api/game/start", {"playerNames": ["Al", "al"]})
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_start_game_rejects_malformed_body(client):
    r = client.post("/api/game/start", data="not json", content_type="text/plain")
    assert r.status_code == 400
    assert r.get_json()["error"]["code"] == "VALIDATION_ERROR"


def test_start_game_rejects_bad_mode_fields(client):
    status, body = post(client, "/api/game/start", {"playerNames": ["A", "B"], "mode": {"numPlayers": 4}})
    assert status == 400
    status, body = post(client, "/api/game/start", {"playerNames": ["A", "B"], "difficulty": "impossible"})
    assert status == 400
    status, body = post(client, "/api/game/start", {"playerNames": ["A", "B"], "timerMode": "warp-speed"})
    assert status == 400
    status, body = post(client, "/api/game/start", {"playerNames": ["A", "B"], "roundsTotal": 2})
    assert status == 400


# ---------------------------------------------------------------------------
# Game state
# ---------------------------------------------------------------------------

def test_state_without_a_game_is_404(client):
    status, body = get(client, "/api/game/state")
    assert status == 404
    assert body["error"]["code"] == "NO_ACTIVE_GAME"


def test_state_reflects_the_started_game(client):
    started = start_game(client, ["Alice", "Bob"])
    status, body = get(client, "/api/game/state")
    assert status == 200
    assert body["data"]["gameId"] == started["gameId"]
    assert body["data"]["question"] == started["question"]


def test_state_rejects_an_older_shaped_session(client):
    with client.session_transaction() as s:
        s["api_game"] = {"player_names": ["x"], "question": {}}  # Phase-2-only shape
    status, body = get(client, "/api/game/state")
    assert status == 422
    assert body["error"]["code"] == "INVALID_GAME_STATE"


# ---------------------------------------------------------------------------
# Picking
# ---------------------------------------------------------------------------

def test_valid_pick_is_accepted_and_scored(client):
    # Pinned to a large, reliable pool -- see play_turn()'s docstring in
    # conftest.py for why an arbitrary pool[0] can otherwise hit a real,
    # pre-existing question_gen.py collision unrelated to what this test
    # checks (that a genuinely valid pick is accepted and scored).
    data = start_game(client, ["Alice", "Bob"], mode={"stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"})
    pool = eligible_pool(data["question"])
    status, body = post(client, "/api/game/pick", {"typed": pool[0]})
    assert status == 200
    assert body["data"]["pickError"] is None
    assert len(body["data"]["myPicks"]) == 1
    assert body["data"]["myPicks"][0]["playerName"] == pool[0]
    assert isinstance(body["data"]["myPicks"][0]["value"], int)


def test_invalid_pick_not_found(client):
    start_game(client, ["Alice", "Bob"])
    status, body = post(client, "/api/game/pick", {"typed": "zzznotarealplayer"})
    assert status == 200  # a rejected pick is a normal game outcome, not an HTTP error
    assert body["data"]["pickError"]["code"] == "NOT_FOUND"
    assert body["data"]["myPicks"] == []


def test_invalid_pick_empty_input(client):
    start_game(client, ["Alice", "Bob"])
    status, body = post(client, "/api/game/pick", {"typed": "   "})
    assert body["data"]["pickError"]["code"] == "EMPTY_INPUT"


def test_invalid_pick_wrong_type(client):
    start_game(client, ["Alice", "Bob"])
    status, body = post(client, "/api/game/pick", {"typed": ["a", "list"]})
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_invalid_pick_wrong_constraints(client):
    data = start_game(client, ["Alice", "Bob"], mode={"roleBucket": "Bowler", "stat": "wickets"})
    # A specialist top-order batter should never satisfy a Bowler constraint.
    status, body = post(client, "/api/game/pick", {"typed": "V Kohli"})
    assert body["data"]["pickError"]["code"] == "REJECTED"
    assert "doesn't fit" in body["data"]["pickError"]["message"]


def test_duplicate_pick_rejected(client):
    data = start_game(client, ["Alice", "Bob"], mode={"stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"})
    pool = eligible_pool(data["question"])
    post(client, "/api/game/pick", {"typed": pool[0]})
    status, body = post(client, "/api/game/pick", {"typed": pool[0]})
    assert body["data"]["pickError"]["code"] == "DUPLICATE"
    assert len(body["data"]["myPicks"]) == 1  # the duplicate never got appended


def test_ambiguous_player_flow(client):
    # Pinned to a role+country RA Jadeja (the highest-prominence "Jadeja"
    # candidate) genuinely satisfies, whatever stat/format get chosen --
    # an unconstrained random question could otherwise land on a
    # role/country that rejects a perfectly real, resolvable player,
    # which is a REJECTED pick_error, not what this test is exercising.
    start_game(client, ["Alice", "Bob"], mode={"country": "India", "roleBucket": "Allrounder"})
    status, body = post(client, "/api/game/pick", {"typed": "Jadeja"})
    assert status == 200
    pending = body["data"]["pendingAmbiguous"]
    assert pending is not None
    assert len(pending["candidates"]) >= 2
    assert pending["query"] == "Jadeja"

    candidate_id = pending["candidates"][0]["playerId"]
    status, body = post(client, "/api/game/ambiguous", {"playerId": candidate_id})
    assert status == 200
    assert body["data"]["pendingAmbiguous"] is None
    assert len(body["data"]["myPicks"]) == 1


def test_ambiguous_invalid_selection(client):
    start_game(client, ["Alice", "Bob"])
    post(client, "/api/game/pick", {"typed": "Jadeja"})
    status, body = post(client, "/api/game/ambiguous", {"playerId": "not-a-real-id"})
    assert body["data"]["pickError"]["code"] == "INVALID_SELECTION"
    assert body["data"]["pendingAmbiguous"] is None


def test_ambiguous_without_pending_is_rejected(client):
    start_game(client, ["Alice", "Bob"])
    status, body = post(client, "/api/game/ambiguous", {"playerId": "anything"})
    assert status == 409
    assert body["error"]["code"] == "NO_PENDING_AMBIGUOUS"


def test_stale_ambiguous_list_is_cleared_by_the_next_pick(client):
    """Regression test for a real bug found during Phase 2: typing an
    ambiguous name, then a not-found name, must not leave the FIRST
    name's stale candidate list riding along with the second's error."""
    start_game(client, ["Alice", "Bob"])
    post(client, "/api/game/pick", {"typed": "Jadeja"})
    status, body = post(client, "/api/game/pick", {"typed": "zzznotarealplayer"})
    assert body["data"]["pickError"]["code"] == "NOT_FOUND"
    assert body["data"]["pendingAmbiguous"] is None


# ---------------------------------------------------------------------------
# Turn order / "wrong turn"
# ---------------------------------------------------------------------------

def test_pick_after_game_complete_is_rejected(client):
    """There is no player-identity field in this API at all -- an action
    always means "whoever the server's current_player_idx says", never a
    client-supplied claim -- so the only reachable shape of "wrong turn"
    is trying to act once every player has already finished."""
    data = start_game(client, ["Alice", "Bob"], mode={"numPlayers": 3, "stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"})
    with client.session_transaction() as s:
        st = s["api_game"]
        st["current_player_idx"] = len(st["player_names"])
        s["api_game"] = st
    status, body = post(client, "/api/game/pick", {"typed": "anyone"})
    assert status == 409
    assert body["error"]["code"] == "GAME_COMPLETE"

    status, body = post(client, "/api/game/next-turn")
    assert status == 409
    assert body["error"]["code"] == "GAME_COMPLETE"


# ---------------------------------------------------------------------------
# Turn timer
# ---------------------------------------------------------------------------

def test_casual_mode_has_no_timer(client):
    data = start_game(client, ["Alice", "Bob"], timerMode="casual")
    assert data["timerSeconds"] is None
    post(client, "/api/game/next-turn")
    status, body = get(client, "/api/game/state")
    assert body["data"]["turnSecondsRemaining"] is None


def test_blitz_mode_starts_a_15_second_clock(client):
    data = start_game(client, ["Alice", "Bob"], timerMode="blitz")
    assert data["timerSeconds"] == 15
    status, body = post(client, "/api/game/next-turn")
    assert body["data"]["turnSecondsRemaining"] == 15


def test_timer_expiration_forces_the_turn_forward(client):
    """The backend is authoritative: rewinding the server-recorded start
    time (not anything the client could send) is what actually expires
    the turn -- there is no client-supplied "time's up" signal at all."""
    start_game(client, ["Alice", "Bob"], timerMode="blitz")
    post(client, "/api/game/next-turn")
    with client.session_transaction() as s:
        st = s["api_game"]
        st["turn_started_at"] -= 20  # 20s ago on a 15s clock
        s["api_game"] = st

    status, body = get(client, "/api/game/state")
    assert body["data"]["pickError"]["code"] == "TURN_EXPIRED"
    assert body["data"]["currentPlayerName"] == "Bob"
    assert body["data"]["turnComplete"] is True


def test_timer_expiration_also_caught_on_pick(client):
    start_game(client, ["Alice", "Bob"], timerMode="normal")
    post(client, "/api/game/next-turn")
    with client.session_transaction() as s:
        st = s["api_game"]
        st["turn_started_at"] -= 40  # past the 30s normal-mode limit
        s["api_game"] = st

    status, body = post(client, "/api/game/pick", {"typed": "anyone"})
    assert body["data"]["pickError"]["code"] == "TURN_EXPIRED"
    assert body["data"]["currentPlayerName"] == "Bob"


# ---------------------------------------------------------------------------
# Hints
# ---------------------------------------------------------------------------

def test_hints_return_a_clue_without_the_exact_answer(client):
    data = start_game(client, ["Alice", "Bob"])
    target = data["question"]["target"]

    for hint_type in ("country", "role", "range"):
        status, body = post(client, "/api/game/hint", {"type": hint_type})
        assert status == 200
        hint = body["data"]["hint"]
        assert hint["type"] == hint_type
        assert str(target) not in hint["text"]

    assert body["data"]["myHintsUsed"] == {"country": 1, "role": 1, "range": 1}


def test_hint_rejects_unknown_type(client):
    start_game(client, ["Alice", "Bob"])
    status, body = post(client, "/api/game/hint", {"type": "reveal_everything"})
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_hints_incur_a_scoring_penalty(client):
    data = start_game(client, ["Alice", "Bob"], mode={"numPlayers": 3, "stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"})
    pool = eligible_pool(data["question"])

    # Alice: no hints.
    play_turn(client, "Alice", pool)
    # Bob: three hints before picking, same real answers otherwise.
    for hint_type in ("country", "role", "range"):
        post(client, "/api/game/hint", {"type": hint_type})
    play_turn(client, "Bob", pool)

    status, body = get(client, "/api/game/reveal")
    standings = {s["participantName"]: s for s in body["data"]["standings"]}
    assert standings["Bob"]["hintsUsed"] == 3
    assert standings["Bob"]["scoreBreakdown"]["hintPenalty"] == 3 * 75
    assert standings["Alice"]["scoreBreakdown"]["hintPenalty"] == 0


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def test_scoring_rewards_the_closer_total_more(client):
    """Independent of who "wins" the round (still purely closest-total,
    unchanged), the player closer to the target must score at least as
    many points as one further away."""
    data = start_game(client, ["Alice", "Bob"], mode={"numPlayers": 3, "stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"})
    result = play_full_round(client, ["Alice", "Bob"])
    status, body = get(client, "/api/game/reveal")
    standings = {s["participantName"]: s for s in body["data"]["standings"]}

    closer = min(standings.values(), key=lambda s: s["difference"])
    farther = max(standings.values(), key=lambda s: s["difference"])
    if closer["difference"] != farther["difference"]:
        assert closer["score"] >= farther["score"]

    # The round's actual winner is still decided purely by closeness,
    # exactly as before scoring existed.
    winners = [name for name, s in standings.items() if s["won"]]
    min_diff = min(s["difference"] for s in standings.values())
    assert all(standings[w]["difference"] == min_diff for w in winners)


def test_exact_target_gets_the_bonus(client):
    """Forces an exact match by editing a pick's recorded value directly --
    the fastest reliable way to hit target==total without hunting the
    real dataset for a naturally exact combination."""
    data = start_game(client, ["Alice", "Bob"], mode={"numPlayers": 3, "stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"})
    target = data["question"]["target"]
    pool = eligible_pool(data["question"])
    play_full_round(client, ["Alice", "Bob"])

    with client.session_transaction() as s:
        st = s["api_game"]
        picks = st["picks"]["Alice"]
        # Zero out Alice's picks, then set one pick's value to the exact target.
        st["picks"]["Alice"] = [[picks[0][0], target]] + [[n, 0] for n, _ in picks[1:]]
        s["api_game"] = st

    status, body = get(client, "/api/game/reveal")
    alice = next(s for s in body["data"]["standings"] if s["participantName"] == "Alice")
    assert alice["difference"] == 0
    assert alice["scoreBreakdown"]["exactBonus"] == 500
    assert alice["won"] is True


# ---------------------------------------------------------------------------
# Reveal
# ---------------------------------------------------------------------------

def test_reveal_blocked_until_everyone_has_picked(client):
    start_game(client, ["Alice", "Bob"])
    status, body = get(client, "/api/game/reveal")
    assert status == 409
    assert body["error"]["code"] == "GAME_IN_PROGRESS"


def test_reveal_after_completion_has_correct_math(client):
    data = start_game(client, ["Alice", "Bob"], mode={"numPlayers": 3, "stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"})
    target = data["question"]["target"]
    play_full_round(client, ["Alice", "Bob"])

    status, body = get(client, "/api/game/reveal")
    assert status == 200
    for s in body["data"]["standings"]:
        assert s["difference"] == abs(s["total"] - target)
    best = min(s["difference"] for s in body["data"]["standings"])
    winners = [s for s in body["data"]["standings"] if s["won"]]
    assert all(s["difference"] == best for s in winners)
    assert len(winners) >= 1


def test_reveal_is_idempotent(client):
    """Calling reveal twice (a page refresh) must not change anything --
    it never records history, only play-again does."""
    data = start_game(client, ["Alice", "Bob"], mode={"numPlayers": 3, "stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"})
    play_full_round(client, ["Alice", "Bob"])
    status1, body1 = get(client, "/api/game/reveal")
    status2, body2 = get(client, "/api/game/reveal")
    assert body1["data"]["standings"] == body2["data"]["standings"]

    status, body = get(client, "/api/game/history")
    assert body["data"]["rounds"] == []  # nothing committed by reveal alone


# ---------------------------------------------------------------------------
# Play again / multiple rounds
# ---------------------------------------------------------------------------

def test_play_again_starts_a_new_question_same_players(client):
    data = start_game(client, ["Alice", "Bob"], mode={"numPlayers": 3, "stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"})
    first_question = data["question"]
    play_full_round(client, ["Alice", "Bob"])
    get(client, "/api/game/reveal")

    status, body = post(client, "/api/game/play-again")
    assert status == 200
    assert body["data"]["currentRound"] == 2
    assert body["data"]["currentPlayerName"] == "Alice"
    assert body["data"]["myPicks"] == []


def test_play_again_before_round_complete_is_rejected(client):
    start_game(client, ["Alice", "Bob"])
    status, body = post(client, "/api/game/play-again")
    assert status == 409
    assert body["error"]["code"] == "GAME_IN_PROGRESS"


def test_multi_round_game_finishes_and_accumulates_scores(client):
    data = start_game(client, ["Alice", "Bob"], mode={"numPlayers": 3, "stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"}, roundsTotal=1)
    play_full_round(client, ["Alice", "Bob"])

    status, reveal_body = get(client, "/api/game/reveal")
    assert reveal_body["data"]["isFinalRound"] is True
    expected_scores = {s["participantName"]: s["score"] for s in reveal_body["data"]["standings"]}

    status, body = post(client, "/api/game/play-again")
    assert status == 200
    assert body["data"]["status"] == "finished"
    # The one round played is exactly what's now in the running total --
    # not asserting it's positive, since a legitimately terrible round
    # (both players far off, no timer, no hints) can score zero.
    assert body["data"]["cumulativeScores"] == expected_scores

    status, body = post(client, "/api/game/play-again")
    assert status == 409
    assert body["error"]["code"] == "GAME_FINISHED"

    status, body = get(client, "/api/game/history")
    assert len(body["data"]["rounds"]) == 1
    assert body["data"]["status"] == "finished"


def test_unlimited_rounds_is_the_default_and_never_finishes(client):
    """Explicit backward-compatibility check: a game started the way
    Phase 2's frontend always started one (no roundsTotal at all) must be
    playable forever, exactly like before Phase 3 existed."""
    data = start_game(client, ["Alice", "Bob"], mode={"numPlayers": 3, "stat": "runs", "roleBucket": "Batter", "country": "India", "format": "IPL"})
    assert data["roundsTotal"] is None

    for _ in range(3):
        play_full_round(client, ["Alice", "Bob"])
        get(client, "/api/game/reveal")
        status, body = post(client, "/api/game/play-again")
        assert status == 200
        assert body["data"]["status"] == "in_progress"


# ---------------------------------------------------------------------------
# Session expiry / structural errors
# ---------------------------------------------------------------------------

def test_idle_session_is_treated_as_expired(client):
    start_game(client, ["Alice", "Bob"])
    with client.session_transaction() as s:
        st = s["api_game"]
        st["updated_at"] -= 3 * 60 * 60  # older than the 2-hour idle timeout
        s["api_game"] = st
    status, body = get(client, "/api/game/state")
    assert status == 410
    assert body["error"]["code"] == "SESSION_EXPIRED"


# ---------------------------------------------------------------------------
# Player search
# ---------------------------------------------------------------------------

def test_player_search_returns_structured_results_with_confidence(client):
    status, body = get(client, "/api/player/search?q=kohli")
    assert status == 200
    results = body["data"]["results"]
    assert len(results) >= 1
    for r in results:
        assert set(r.keys()) == {"playerId", "playerName", "country", "playingRole", "confidence"}
        assert 0.0 <= r["confidence"] <= 1.0


def test_player_search_empty_query_returns_no_results(client):
    status, body = get(client, "/api/player/search?q=")
    assert status == 200
    assert body["data"]["results"] == []

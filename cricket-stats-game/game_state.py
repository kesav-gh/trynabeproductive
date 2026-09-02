"""
game_state.py

The structured shape of one game's state, held in the Flask session under
api.py's "api_game" key. This module describes what is in there and
provides small pure functions to build, read and advance it -- api.py
remains the only thing that actually reads or writes the session itself.

Deliberately a plain dict, not a class: nothing else in this codebase
(question_gen.py, name_match.py) reaches for OOP machinery it doesn't
need, and a dict is what Flask's session already wants to store and what
`jsonify()` already wants to serialise.

Shape (everything JSON-safe -- Flask signs this whole dict into a cookie):
{
  "game_id":            str,   # uuid4 hex, one per /api/game/start call
  "created_at":         float, # unix timestamp
  "updated_at":         float, # bumped on every mutation; drives the
                                # idle-session-expiry check below
  "player_names":       [str, ...],
  "mode": {"num_players": 3|5|None, "stat": str|None, "format": str|None,
           "country": str|None, "role_bucket": str|None},
  "difficulty":         "easy" | "normal" | "hard" | "insane",
  "timer_mode":         "casual" | "normal" | "blitz",
  "timer_seconds":      int | None,   # derived from timer_mode
  "rounds_total":       int | None,   # None = unlimited, i.e. exactly the
                                       # Phase 2 "play again forever" game
  "current_round":      int,          # 1-based
  "current_player_idx": int,
  "question":           {...},        # exactly what generate_target() returned
  "picks":              {name: [[player_name, value], ...]},
  "pending_ambiguous":  {"typed": str, "candidates": [[id,name,country,role],...]} | None,
  "hints_used":         {name: {"country": int, "role": int, "range": int}},
                                       # reset to zero for every player at
                                       # the start of each round
  "turn_started_at":    float | None, # set by /next-turn, cleared when the
                                       # turn ends; None means no clock is
                                       # running (Casual mode, or between turns)
  "turn_durations":     {name: float | None}, # how long THIS round's turn
                                       # took each player who has finished
                                       # it (full timer_seconds if they
                                       # timed out); feeds the speed bonus
                                       # in scoring.py at reveal/play-again
  "cumulative_scores":  {name: int},  # summed across ROUNDS ALREADY RECORDED
                                       # into rounds_history -- see scoring.py
  "rounds_history":     [RoundRecord, ...],
  "status":             "in_progress" | "finished",
}

RoundRecord (one entry per completed round, append-only):
{
  "round_number": int,
  "question": {...generate_target dict...},
  "standings": [{"participant_name", "total", "difference", "won", "score"}],
  "completed_at": float,
}

This shape is flat and typed on purpose: it is the natural source table
for a later `game_rounds` row (game_id, round_number, question fields,
per-player results) if this ever migrates off the session cookie and
onto Postgres -- nothing about that migration is built here, but nothing
here would need reshaping to get there either.
"""

import time
import uuid

TIMER_SECONDS = {"casual": None, "normal": 30, "blitz": 15}
VALID_TIMER_MODES = set(TIMER_SECONDS)
VALID_DIFFICULTIES = {"easy", "normal", "hard", "insane"}
VALID_ROUND_COUNTS = {1, 3, 5, 10}

# A session with no activity for this long is treated as expired rather
# than as a live game, on the next request that touches it. Nothing here
# proactively deletes it -- Flask's session cookie itself already expires
# in the browser when it closes; this only stops a request days later
# (a stale tab, a resumed laptop) from resuming a "live" game silently.
SESSION_IDLE_TIMEOUT_SECONDS = 2 * 60 * 60  # 2 hours


def new_game(player_names, mode, difficulty="normal", timer_mode="casual", rounds_total=None):
    """Build a fresh game-state dict. Caller has already generated `question`
    and validated everything -- this just assembles the shape."""
    now = time.time()
    return {
        "game_id": uuid.uuid4().hex,
        "created_at": now,
        "updated_at": now,
        "player_names": player_names,
        "mode": mode,
        "difficulty": difficulty,
        "timer_mode": timer_mode,
        "timer_seconds": TIMER_SECONDS[timer_mode],
        "rounds_total": rounds_total,
        "current_round": 1,
        "current_player_idx": 0,
        "question": None,  # filled in by the caller right after this returns
        "picks": {name: [] for name in player_names},
        "pending_ambiguous": None,
        "hints_used": {name: {"country": 0, "role": 0, "range": 0} for name in player_names},
        "turn_started_at": None,
        "turn_durations": {name: None for name in player_names},
        "cumulative_scores": {name: 0 for name in player_names},
        "rounds_history": [],
        "status": "in_progress",
    }


def touch(state):
    """Bump the idle-timeout clock. Call this on every request that
    successfully reads or writes an existing game."""
    state["updated_at"] = time.time()


def is_session_expired(state, now=None):
    now = now if now is not None else time.time()
    return (now - state["updated_at"]) > SESSION_IDLE_TIMEOUT_SECONDS


def current_player_name(state):
    idx = state["current_player_idx"]
    names = state["player_names"]
    return names[idx] if idx < len(names) else None


def is_round_complete(state):
    """True once every player has finished picking for the current round."""
    return state["current_player_idx"] >= len(state["player_names"])


# ---------------------------------------------------------------------------
# Turn timer -- the backend is authoritative. A deadline is a plain
# timestamp computed from a server-side start time and a server-side
# duration; nothing about "how much time is left" is ever taken from the
# client.
# ---------------------------------------------------------------------------

def start_turn_timer(state):
    """Called when a player confirms 'it's my turn' (/next-turn). Only
    actually starts a clock if this game has a timer at all."""
    state["turn_started_at"] = time.time() if state["timer_seconds"] else None


def clear_turn_timer(state):
    state["turn_started_at"] = None


def turn_elapsed_seconds(state, now=None):
    """Seconds since the current turn started, or None if no clock is running."""
    if state["turn_started_at"] is None:
        return None
    now = now if now is not None else time.time()
    return now - state["turn_started_at"]


def turn_seconds_remaining(state, now=None):
    """Seconds left on the current turn's clock, floored at 0. None means
    there is no timer running (Casual mode, or nobody's turn in progress)."""
    if not state["timer_seconds"] or state["turn_started_at"] is None:
        return None
    elapsed = turn_elapsed_seconds(state, now)
    return max(0, round(state["timer_seconds"] - elapsed))


def is_turn_expired(state, now=None):
    remaining = turn_seconds_remaining(state, now)
    return remaining is not None and remaining <= 0


def record_turn_duration(state, name, seconds):
    """How long `name`'s just-finished turn took, for the speed bonus. Call
    this BEFORE clear_turn_timer() wipes turn_started_at, or pass an
    already-computed value (e.g. the full timer_seconds on a timeout)."""
    state["turn_durations"][name] = seconds


def advance_player(state, elapsed_seconds=None):
    """End the current player's turn and move to the next one (or past the
    end of the list, meaning the round is complete). Records how long the
    turn took, if known, for the speed bonus at reveal time."""
    name = current_player_name(state)
    if name is not None:
        record_turn_duration(state, name, elapsed_seconds)
    state["current_player_idx"] += 1
    clear_turn_timer(state)


def can_start_next_round(state):
    total = state["rounds_total"]
    return total is None or state["current_round"] < total


def record_round_history(state, standings):
    """Append a finished round's results (already including each player's
    score -- see scoring.py) and roll their scores into the running total.
    Does not itself advance current_round; the caller (play_again /
    finish_game in api.py) decides what happens next."""
    state["rounds_history"].append({
        "round_number": state["current_round"],
        "question": state["question"],
        "standings": standings,
        "completed_at": time.time(),
    })
    for s in standings:
        state["cumulative_scores"][s["participant_name"]] = (
            state["cumulative_scores"].get(s["participant_name"], 0) + s["score"]
        )


def start_next_round(state, question):
    state["current_round"] += 1
    state["question"] = question
    state["current_player_idx"] = 0
    state["picks"] = {name: [] for name in state["player_names"]}
    state["pending_ambiguous"] = None
    state["hints_used"] = {name: {"country": 0, "role": 0, "range": 0} for name in state["player_names"]}
    state["turn_durations"] = {name: None for name in state["player_names"]}
    clear_turn_timer(state)


def finish_game(state):
    state["status"] = "finished"

"""
api.py

JSON API for the React frontend, sitting alongside the original HTML pages
in app.py. This file adds NO cricket-question logic -- every question,
every name resolution, every pick validation and every real stat value
still comes from calling straight into question_gen.py and name_match.py,
unmodified. What this file adds on top (Phase 3) is the surrounding game
machinery those two modules were never meant to own: structured session
state (game_state.py), a points score layered over the original "closest
wins" mechanic (scoring.py), a turn timer the backend enforces, hints,
multi-round play, and consistent, defensive JSON error handling.

One deliberate carry-over from Phase 2: GET /api/game/reveal refuses to
compute standings until every player has finished picking, and it stays a
pure read (it computes but never records a round into history) -- only
POST /api/game/play-again commits a finished round to history, since a
POST is the natural place for that side effect and it keeps GET /reveal
safe to call more than once (a page refresh) without double-counting.

Also unchanged from Phase 2: a committed pick carries only a name and a
value, because that's genuinely all evaluate_guess() ever returns -- no
id, country or role. Only the disambiguation step and hints have those,
since both read from data this file queries independently (name_match's
candidate tuples, and question_gen's own pool-building functions).

There is no player-level identity in this API at all -- every action
(pick, ambiguous, hint) always means "whoever session state currently
says is picking," never a client-supplied player id. That is a stronger
guarantee against a "wrong turn" submission than validating one after
the fact: there is no field in any request through which a client COULD
claim to act as a different player, so the failure mode simply has
nowhere to enter through.

Phase 4.4.1: every state-changing route below (start/pick/ambiguous/
next-turn/hint/play-again) is wrapped in csrf.protect -- the same
double-submit-cookie check auth_api.py and profile_api.py already use,
not a second mechanism. This closes a real gap Phase 4.4 opened: once a
signed-in user's game gets persisted to Postgres (game_persistence.py),
a forged cross-site request that rode along on nothing but the
victim's session cookie could otherwise start or manipulate a game
under their real account. GET routes (/game/state, /game/reveal,
/game/history, /player/search) are read-only and stay unprotected, as
CSRF has nothing to defend there.
"""

import difflib
import logging
import random

import duckdb
import psycopg
from flask import Blueprint, jsonify, request, session

import appdb
import auth_api
import csrf
import difficulty
import game_persistence
import game_state
import name_match
import question_gen
import scoring
from extensions import con

api_bp = Blueprint("api", __name__, url_prefix="/api")
log = logging.getLogger("cricket_api")

SESSION_KEY = "api_game"

# What a session dict must at least have to be trusted. Guards against a
# session cookie saved by an earlier version of this API (a real
# possibility -- Phase 2's shape didn't have most of these fields) being
# fed into Phase 3's code and crashing on a missing key instead of
# failing cleanly.
REQUIRED_STATE_KEYS = (
    "game_id", "player_names", "question", "current_player_idx",
    "picks", "status", "rounds_history",
)

HINT_TYPES = ("country", "role", "range")

# Coarse bucket width per stat for the "range" hint -- wide enough that
# the real value is never pinned down, narrow enough to be a useful clue.
RANGE_BUCKET = {"runs": 100, "wickets": 20, "centuries": 5, "five_fers": 5}


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

class ApiError(Exception):
    """A deliberate, structured error response: {code, message}, with an
    HTTP status. Distinct from a "pick error" (see below), which is a
    normal, expected game outcome (wrong name, wrong country, ...) carried
    inside a 200 response rather than raised as an HTTP error."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    def to_response(self):
        return jsonify({"error": {"code": self.code, "message": self.message}}), self.status


def json_errors(fn):
    """
    Guarantees every /api/ route returns JSON, never an HTML error page --
    including Werkzeug's interactive debugger, which app.run(debug=True)
    would otherwise show for any *unhandled* exception. Flask's own
    app.errorhandler(500) does not reliably fire while debug=True (Flask
    propagates the exception to the debugger instead), so this decorator
    is the real safety net; extensions.py's handler is a defensive extra.
    """

    def wrapped(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ApiError as e:
            return e.to_response()
        except duckdb.Error:
            log.exception("Database error in %s", fn.__name__)
            return jsonify({
                "error": {
                    "code": "DATABASE_ERROR",
                    "message": "The player database couldn't be reached. Try again.",
                }
            }), 500
        except Exception:
            log.exception("Unhandled error in %s", fn.__name__)
            return jsonify({
                "error": {
                    "code": "SERVER_ERROR",
                    "message": "Something went wrong. Try again.",
                }
            }), 500

    wrapped.__name__ = fn.__name__
    return wrapped


def _no_active_game():
    return ApiError(404, "NO_ACTIVE_GAME", "No game in progress. Start a new one.")


def _session_expired():
    return ApiError(410, "SESSION_EXPIRED", "This game session has expired. Start a new one.")


def _invalid_game_state():
    return ApiError(422, "INVALID_GAME_STATE", "This game session is from an older version and can't continue. Start a new one.")


def _game_complete():
    return ApiError(409, "GAME_COMPLETE", "Everyone has finished picking. Head to the reveal.")


def _game_finished():
    return ApiError(409, "GAME_FINISHED", "This game has finished all its rounds. Start a new one to play again.")


# ---------------------------------------------------------------------------
# Session state helpers
# ---------------------------------------------------------------------------

def _get_state():
    return session.get(SESSION_KEY)


def _require_state():
    """Fetch the current game, or raise a clear, specific error: never
    started, expired from inactivity, or from a shape this version of the
    API doesn't recognise. Touches the activity clock on every successful
    call, including plain reads -- an idle GET /state still counts as
    "the game is still alive" for the expiry check."""
    state = _get_state()
    if state is None:
        raise _no_active_game()
    if not all(k in state for k in REQUIRED_STATE_KEYS):
        raise _invalid_game_state()
    if game_state.is_session_expired(state):
        raise _session_expired()
    game_state.touch(state)
    _save_state(state)
    return state


def _save_state(state):
    session[SESSION_KEY] = state
    session.modified = True


def _json_body():
    """Every POST endpoint here expects a JSON object body. A missing,
    non-JSON, or non-object body is a malformed request, not something to
    silently default away -- that just turns into a confusing KeyError
    two lines later otherwise."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object.")
    return body


# ---------------------------------------------------------------------------
# Phase 4.4 persistence -- the session (via game_state.py) stays the
# single authoritative source of live game state, exactly as before this
# phase; Postgres is written to at round/game BOUNDARIES only (never per
# turn or per pick -- see game_persistence.py's module docstring), and
# only for a game a signed-in user started (state["db_game_id"] is None
# for every guest game, and nothing below ever runs for one).
#
# Two different failure behaviours are deliberate, not inconsistent:
#   - Game START persistence failing is FATAL (see start_game): nothing
#     about a brand new game exists yet for the player to lose, so this
#     is the same "the database isn't available, try again" a signed-in
#     user already gets from every other auth-adjacent endpoint.
#   - A round/game COMPLETION persistence failure, once a game is
#     already under way, is NOT fatal to gameplay (see _try_persist) --
#     the session is authoritative and already holds the real result;
#     failing the request here would make an authenticated player's live
#     game MORE fragile than a guest's for no real benefit. It is never
#     silent, though: it's logged server-side with the real exception,
#     and state["db_sync_ok"] flips to False, surfaced to the client as
#     `historySyncOk` in the state DTO below -- an honest "this round
#     didn't make it into your permanent history," not a fabricated
#     success.
# ---------------------------------------------------------------------------

def _try_persist(state, fn):
    """Best-effort Postgres write for a game that IS persisted
    (state["db_game_id"] is not None). `fn` takes one argument, an open
    connection, and returns whatever the caller needs back (e.g. a new
    round's id) -- or None, and state["db_sync_ok"] is set to False, if
    the write failed. Never raises. A guest game (db_game_id is None)
    never even opens a connection, so this can never be the thing that
    breaks guest play if Postgres is unreachable."""
    if state.get("db_game_id") is None:
        return None
    try:
        with appdb.get_connection() as conn:
            return fn(conn)
    except (appdb.ConfigError, psycopg.Error):
        log.exception("Persistence failed for db_game_id=%s", state["db_game_id"])
        state["db_sync_ok"] = False
        return None


# ---------------------------------------------------------------------------
# Turn expiry -- the backend is authoritative. Checked at the top of every
# endpoint that could otherwise let a client act after time actually ran
# out, using server time against a server-recorded deadline; nothing about
# "how much time is left" ever comes from the client.
# ---------------------------------------------------------------------------

def _expire_turn_if_needed(state):
    """If the current player's clock has genuinely run out, end their turn
    right now (whatever picks they made stand) and return their name.
    Returns None if nothing needed to expire."""
    if not game_state.is_turn_expired(state):
        return None
    name = game_state.current_player_name(state)
    game_state.advance_player(state, elapsed_seconds=state["timer_seconds"])
    return name


# ---------------------------------------------------------------------------
# DTO builders
# ---------------------------------------------------------------------------

def _player_dict(row):
    """(player_id, player_name, country, playing_role) tuple/list -> dict."""
    return {
        "playerId": row[0],
        "playerName": row[1],
        "country": row[2],
        "playingRole": row[3],
    }


def _question_dto(q):
    return {
        "questionText": q["question_text"],
        "stat": q["stat"],
        "format": q["format"],
        "country": q["country"],
        "roleBucket": q["role_bucket"],
        "numPlayers": q["num_players"],
        "target": q["target"],
    }


def _xp_dto(xp_result):
    """The minimal shape a "+175 XP" / level-up moment on the frontend
    needs (Phase 4.5) -- None on every response except the one
    play-again call that actually just finished an authenticated game
    (see play_again() below). Never includes the raw per-component
    breakdown xp_service.py returns internally -- nothing here is a
    database implementation detail, just the numbers the result screen
    displays."""
    if xp_result is None:
        return None
    return {
        "xpAwarded": xp_result["xpAwarded"],
        "newXp": xp_result["newXp"],
        "oldLevel": xp_result["oldLevel"],
        "newLevel": xp_result["newLevel"],
        "leveledUp": xp_result["leveledUp"],
    }


def _state_dto(state, pick_error=None, turn_complete=False, hint=None, xp_result=None):
    current_name = game_state.current_player_name(state)

    my_picks = None
    my_hints = None
    if current_name is not None:
        my_picks = [
            {"playerName": name, "value": value}
            for name, value in state["picks"][current_name]
        ]
        my_hints = dict(state["hints_used"][current_name])

    pending = state.get("pending_ambiguous")
    pending_dto = None
    if pending:
        pending_dto = {
            "query": pending["typed"],
            "candidates": [_player_dict(c) for c in pending["candidates"]],
        }

    return {
        "gameId": state["game_id"],
        "status": state["status"],
        "currentRound": state["current_round"],
        "roundsTotal": state["rounds_total"],
        "difficulty": state["difficulty"],
        "timerMode": state["timer_mode"],
        "timerSeconds": state["timer_seconds"],
        "turnSecondsRemaining": game_state.turn_seconds_remaining(state),
        "question": _question_dto(state["question"]),
        "numPlayers": state["question"]["num_players"],
        "currentPlayerIndex": state["current_player_idx"],
        "currentPlayerName": current_name,
        "totalPlayers": len(state["player_names"]),
        "myPicks": my_picks,
        "myHintsUsed": my_hints,
        # Echoed from scoring.py so the frontend never hardcodes this --
        # if the penalty ever changes, one place changes.
        "hintPenalty": scoring.HINT_PENALTY,
        "pendingAmbiguous": pending_dto,
        "cumulativeScores": state["cumulative_scores"],
        "pickError": pick_error,
        "turnComplete": turn_complete,
        "hint": hint,
        # None for a guest game (nothing is ever persisted for one) --
        # True/False only for a signed-in user's game, see the Phase 4.4
        # persistence section above for what flips this to False.
        "historySyncOk": state.get("db_sync_ok") if state.get("db_game_id") is not None else None,
        # Phase 4.5: only non-null on the one play-again response that
        # just finished an authenticated game -- see _xp_dto() above.
        "xp": _xp_dto(xp_result),
    }


def _ok(data, status=200):
    return jsonify({"data": data}), status


# ---------------------------------------------------------------------------
# Shared pick-commit logic -- mirrors app.py's _score_and_route() exactly
# for the actual validation (duplicate check, evaluate_guess), and adds
# the turn-duration bookkeeping scoring.py needs at reveal time.
# ---------------------------------------------------------------------------

def _attempt_commit(state, person, player_name, player_id):
    q = state["question"]
    already = state["picks"][person]

    if any(name == player_name for name, _ in already):
        return {"code": "DUPLICATE", "message": f"You've already picked {player_name}."}, False

    # player_id comes straight from whichever name_match.py result the
    # caller already resolved (an unambiguous match, or an explicit
    # disambiguation choice) -- passing it lets evaluate_guess() look
    # this exact player up directly, rather than re-resolving by name
    # and risking a different player who happens to share the name (a
    # real, confirmed case in this dataset -- see question_gen.py).
    guess = question_gen.evaluate_guess(
        con, player_name, q["stat"], q["format"],
        country=q["country"], role_bucket=q["role_bucket"],
        player_id=player_id,
    )
    if not guess["valid"]:
        return {"code": "REJECTED", "message": guess["reason"]}, False

    already.append([guess["player_name"], guess["value"]])
    state["picks"][person] = already

    turn_complete = len(already) >= q["num_players"]
    if turn_complete:
        elapsed = game_state.turn_elapsed_seconds(state)
        game_state.advance_player(state, elapsed_seconds=elapsed)

    return None, turn_complete


# ---------------------------------------------------------------------------
# Scoring for a finished round -- shared by the read-only reveal() and the
# history-recording play_again(), so both compute standings identically.
# ---------------------------------------------------------------------------

def _compute_standings(state):
    q = state["question"]
    picks = state["picks"]

    results = {name: sum(v for _, v in plist) for name, plist in picks.items()}
    diffs = {name: abs(total - q["target"]) for name, total in results.items()}
    best = min(diffs.values())
    winners = {name for name, d in diffs.items() if d == best}

    standings = []
    for name in state["player_names"]:
        hints_used_count = sum(state["hints_used"][name].values())
        breakdown = scoring.score_turn(
            total=results[name],
            target=q["target"],
            elapsed_seconds=state["turn_durations"].get(name),
            timer_seconds=state["timer_seconds"],
            hints_used=hints_used_count,
        )
        standings.append({
            "participant_name": name,
            "picks": [{"playerName": n, "value": v} for n, v in picks[name]],
            "total": results[name],
            "difference": diffs[name],
            "won": name in winners,
            "score": breakdown["total"],
            "scoreBreakdown": breakdown,
            "hintsUsed": hints_used_count,
            # Internal-only field (Phase 4.4): _standings_dto below never
            # forwards this to the client -- it exists purely so
            # game_persistence.complete_round() can store the same
            # per-turn duration already used for the speed bonus, without
            # duplicating a second pass over state["turn_durations"].
            "duration_seconds": state["turn_durations"].get(name),
        })
    return standings


def _standings_dto(standings):
    """The wire shape for one standing entry -- same field names Phase 2
    already used (participantName, picks, total, difference, won), plus
    the new score fields, so existing frontend code that only reads the
    original fields keeps working unchanged."""
    return [
        {
            "participantName": s["participant_name"],
            "picks": s["picks"],
            "total": s["total"],
            "difference": s["difference"],
            "won": s["won"],
            "score": s["score"],
            "scoreBreakdown": s["scoreBreakdown"],
            "hintsUsed": s["hintsUsed"],
        }
        for s in standings
    ]


def _overall_standings(cumulative_scores):
    return sorted(
        ({"participantName": name, "score": score} for name, score in cumulative_scores.items()),
        key=lambda s: s["score"],
        reverse=True,
    )


# ---------------------------------------------------------------------------
# Hints -- sampled independently from the same, already-public pool
# functions question_gen.py exposes for question generation. Never reveals
# the target, and never names the player the hint came from.
# ---------------------------------------------------------------------------

def _sample_hint_source(state):
    """One random (player_id, player_name, value) row from the pool this
    question was built from. Re-runs the same STAT_FUNCS query
    generate_target() itself used -- nothing new is computed in
    question_gen.py, this just calls it a second time."""
    q = state["question"]
    pool = question_gen.STAT_FUNCS[q["stat"]](
        con, q["format"], country=q["country"], role_bucket=q["role_bucket"],
    )
    if not pool:
        return None
    return random.choice(pool)


def _range_bucket(stat, value):
    width = RANGE_BUCKET[stat]
    lower = (value // width) * width
    return f"between {lower} and {lower + width}"


def _build_hint(state, hint_type):
    row = _sample_hint_source(state)
    if row is None:
        return "No clue is available for this question right now."

    player_id, _name, value = row[0], row[1], row[2]

    if hint_type == "range":
        return "One eligible player's " + state["question"]["stat"].replace("_", " ") + " is " + _range_bucket(state["question"]["stat"], value) + "."

    column = "country" if hint_type == "country" else "playing_role"
    row2 = con.execute(f"SELECT {column} FROM players WHERE player_id = ?", [player_id]).fetchone()
    if row2 is None or row2[0] is None:
        return "No clue is available for this question right now."

    if hint_type == "country":
        return f"One eligible player is from {row2[0]}."
    return f"One eligible player's role is {row2[0]}."


# ---------------------------------------------------------------------------
# Player search confidence -- a display-only heuristic computed HERE, not
# inside name_match.py. It never changes which candidates are returned or
# their order; that ranking is entirely name_match.py's own (prominence
# for exact/substring matches, jaro_winkler score for fuzzy ones). This
# just re-derives a 0..1 number from the query and the name that came
# back, so the UI has something to show -- it is not a second matching
# algorithm, only a label on the first one's output.
# ---------------------------------------------------------------------------

def _confidence_for(query, name):
    if query.strip().lower() == name.strip().lower():
        return 1.0
    return round(difflib.SequenceMatcher(None, query.lower(), name.lower()).ratio(), 2)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@api_bp.route("/game/start", methods=["POST"])
@json_errors
@csrf.protect
def start_game():
    body = _json_body()

    raw_names = body.get("playerNames")
    if not isinstance(raw_names, list):
        raise ApiError(400, "VALIDATION_ERROR", "playerNames must be a list of names.")

    names = [str(n).strip() for n in raw_names if str(n).strip()]
    if len(names) < 2:
        raise ApiError(400, "VALIDATION_ERROR", "Need at least 2 players.")
    if len({n.lower() for n in names}) != len(names):
        raise ApiError(400, "VALIDATION_ERROR", "Two players have the same name.")

    mode_in = body.get("mode") or {}
    if not isinstance(mode_in, dict):
        raise ApiError(400, "VALIDATION_ERROR", "mode must be a JSON object.")

    num_players = mode_in.get("numPlayers")
    if num_players is not None and num_players not in (3, 5):
        raise ApiError(400, "VALIDATION_ERROR", "numPlayers must be 3 or 5.")
    stat = mode_in.get("stat")
    if stat is not None and stat not in question_gen.STAT_FUNCS:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown stat: {stat}")
    format_ = mode_in.get("format")
    if format_ is not None and format_ not in question_gen.FORMATS:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown format: {format_}")
    role_bucket = mode_in.get("roleBucket")
    if role_bucket is not None and role_bucket not in question_gen.ROLE_BUCKETS:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown roleBucket: {role_bucket}")
    country = mode_in.get("country")

    difficulty_in = body.get("difficulty", "normal")
    if difficulty_in not in game_state.VALID_DIFFICULTIES:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown difficulty: {difficulty_in}")

    timer_mode = body.get("timerMode", "casual")
    if timer_mode not in game_state.VALID_TIMER_MODES:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown timerMode: {timer_mode}")

    rounds_total = body.get("roundsTotal")
    if rounds_total is not None and rounds_total not in game_state.VALID_ROUND_COUNTS:
        raise ApiError(400, "VALIDATION_ERROR", "roundsTotal must be 1, 3, 5 or 10.")

    mode = {
        "num_players": num_players,
        "stat": stat,
        "format": format_,
        "country": country,
        "role_bucket": role_bucket,
    }

    q = difficulty.generate_target_for_difficulty(
        con, num_players=num_players, difficulty=difficulty_in, mode=mode,
    )
    if q is None:
        raise ApiError(422, "NO_FAIR_QUESTION", "Couldn't generate a fair question — try again.")

    state = game_state.new_game(
        names, mode, difficulty=difficulty_in, timer_mode=timer_mode, rounds_total=rounds_total,
    )
    state["question"] = q

    # Phase 4.4: persist this game only if someone is actually signed in
    # on this browser. A guest game never calls appdb at all -- not "call
    # it and ignore failures", genuinely never reaches this branch --  so
    # guest play can never be affected by Postgres being unreachable.
    # For a signed-in user, failing to persist a game that's about to be
    # played is treated as fatal (see the persistence section above):
    # there's nothing yet for the player to lose, so this is the same
    # "try again" every other auth-adjacent endpoint already gives.
    owner_user_id = auth_api.current_user_id_or_none()
    state["db_game_id"] = None
    state["db_game_player_ids"] = None
    state["db_round_id"] = None
    if owner_user_id is not None:
        try:
            with appdb.get_connection() as conn:
                db_game_id, player_ids, db_round_id = game_persistence.start_persisted_game(
                    conn, difficulty=difficulty_in, rounds_total=rounds_total,
                    player_names=names, owner_user_id=owner_user_id,
                    question=q, target=q["target"],
                )
        except (appdb.ConfigError, psycopg.Error):
            log.exception("Failed to persist new game for user_id=%s", owner_user_id)
            raise ApiError(503, "DATABASE_ERROR", "Couldn't save this game right now. Try again.")
        state["db_game_id"] = db_game_id
        state["db_game_player_ids"] = player_ids
        state["db_round_id"] = db_round_id
        state["db_sync_ok"] = True

    _save_state(state)
    return _ok(_state_dto(state))


@api_bp.route("/game/state", methods=["GET"])
@json_errors
def get_game_state():
    state = _require_state()
    expired_name = _expire_turn_if_needed(state)
    pick_error = None
    if expired_name:
        pick_error = {"code": "TURN_EXPIRED", "message": f"Time's up for {expired_name}."}
        _save_state(state)
    return _ok(_state_dto(state, pick_error=pick_error, turn_complete=bool(expired_name)))


@api_bp.route("/game/pick", methods=["POST"])
@json_errors
@csrf.protect
def submit_pick():
    state = _require_state()

    expired_name = _expire_turn_if_needed(state)
    if expired_name:
        _save_state(state)
        pick_error = {"code": "TURN_EXPIRED", "message": f"Time's up for {expired_name}."}
        return _ok(_state_dto(state, pick_error=pick_error, turn_complete=True))

    person = game_state.current_player_name(state)
    if person is None:
        raise _game_complete()

    body = _json_body()
    typed = body.get("typed", "")
    if not isinstance(typed, str):
        raise ApiError(400, "VALIDATION_ERROR", "typed must be a string.")
    typed = typed.strip()

    # Any new /pick call supersedes whatever ambiguous prompt was pending --
    # that prompt was tied to the PREVIOUS typed text, not this one. Without
    # this, a not_found or empty result below would leave the old candidate
    # list in the response alongside an unrelated error message.
    state["pending_ambiguous"] = None

    if not typed:
        _save_state(state)
        return _ok(_state_dto(state, pick_error={"code": "EMPTY_INPUT", "message": "Enter a name."}))

    result = name_match.resolve_player_fuzzy(con, typed)

    if result["status"] == "not_found":
        _save_state(state)
        message = f'"{typed}" wasn\'t found. Try the last name.'
        return _ok(_state_dto(state, pick_error={"code": "NOT_FOUND", "message": message}))

    if result["status"] == "ambiguous":
        state["pending_ambiguous"] = {"typed": typed, "candidates": result["candidates"]}
        _save_state(state)
        return _ok(_state_dto(state))

    # Exact match -- commit straight away, same as app.py's _resolve_and_route.
    player_id, player_name = result["player"][0], result["player"][1]
    pick_error, turn_complete = _attempt_commit(state, person, player_name, player_id)
    _save_state(state)
    return _ok(_state_dto(state, pick_error=pick_error, turn_complete=turn_complete))


@api_bp.route("/game/ambiguous", methods=["POST"])
@json_errors
@csrf.protect
def submit_ambiguous():
    state = _require_state()

    expired_name = _expire_turn_if_needed(state)
    if expired_name:
        _save_state(state)
        pick_error = {"code": "TURN_EXPIRED", "message": f"Time's up for {expired_name}."}
        return _ok(_state_dto(state, pick_error=pick_error, turn_complete=True))

    person = game_state.current_player_name(state)
    if person is None:
        raise _game_complete()

    pending = state.get("pending_ambiguous")
    if not pending:
        raise ApiError(409, "NO_PENDING_AMBIGUOUS", "There is nothing to confirm. Type a name first.")

    body = _json_body()
    player_id = body.get("playerId")
    if not isinstance(player_id, str) or not player_id:
        raise ApiError(400, "VALIDATION_ERROR", "playerId must be a non-empty string.")

    match = next((c for c in pending["candidates"] if c[0] == player_id), None)

    # Whatever happens next, the ambiguous prompt is resolved one way or
    # another -- app.py never re-shows the candidate list on a bad
    # selection either, it always drops back to the plain pick screen.
    state["pending_ambiguous"] = None

    if match is None:
        _save_state(state)
        pick_error = {"code": "INVALID_SELECTION", "message": "Invalid selection — try again."}
        return _ok(_state_dto(state, pick_error=pick_error))

    player_id, player_name = match[0], match[1]
    pick_error, turn_complete = _attempt_commit(state, person, player_name, player_id)
    _save_state(state)
    return _ok(_state_dto(state, pick_error=pick_error, turn_complete=turn_complete))


@api_bp.route("/game/next-turn", methods=["POST"])
@json_errors
@csrf.protect
def next_turn():
    state = _require_state()
    if game_state.current_player_name(state) is None:
        raise _game_complete()
    game_state.start_turn_timer(state)
    _save_state(state)
    return _ok(_state_dto(state))


@api_bp.route("/game/hint", methods=["POST"])
@json_errors
@csrf.protect
def request_hint():
    state = _require_state()

    expired_name = _expire_turn_if_needed(state)
    if expired_name:
        _save_state(state)
        pick_error = {"code": "TURN_EXPIRED", "message": f"Time's up for {expired_name}."}
        return _ok(_state_dto(state, pick_error=pick_error, turn_complete=True))

    person = game_state.current_player_name(state)
    if person is None:
        raise _game_complete()

    body = _json_body()
    hint_type = body.get("type")
    if hint_type not in HINT_TYPES:
        raise ApiError(400, "VALIDATION_ERROR", f"type must be one of {HINT_TYPES}.")

    if state["hints_used"][person][hint_type] >= 1:
        raise ApiError(409, "HINT_ALREADY_USED", f"You've already used the {hint_type} hint this turn.")

    text = _build_hint(state, hint_type)
    state["hints_used"][person][hint_type] += 1
    _save_state(state)
    return _ok(_state_dto(state, hint={"type": hint_type, "text": text}))


@api_bp.route("/game/reveal", methods=["GET"])
@json_errors
def reveal():
    state = _require_state()
    names = state["player_names"]

    # The same guard app.py's /reveal route enforces: no totals for anyone
    # until every player has finished picking. Read-only -- calling this
    # twice (a page refresh) computes the same thing again, it never
    # records history; only play_again() does that.
    if state["current_player_idx"] < len(names):
        raise ApiError(409, "GAME_IN_PROGRESS", "Not everyone has picked yet.")

    standings = _compute_standings(state)

    # A preview of what cumulative scores would become if this round were
    # committed -- not persisted (reveal stays a pure read; only
    # play_again() actually commits a round to history and to these
    # totals), so a page refresh here never double-counts anything.
    preview_cumulative = dict(state["cumulative_scores"])
    for s in standings:
        preview_cumulative[s["participant_name"]] = (
            preview_cumulative.get(s["participant_name"], 0) + s["score"]
        )

    return _ok({
        "question": _question_dto(state["question"]),
        "target": state["question"]["target"],
        "currentRound": state["current_round"],
        "roundsTotal": state["rounds_total"],
        "isFinalRound": not game_state.can_start_next_round(state),
        "standings": _standings_dto(standings),
        "overallStandings": _overall_standings(preview_cumulative),
    })


@api_bp.route("/game/play-again", methods=["POST"])
@json_errors
@csrf.protect
def play_again():
    state = _require_state()

    if state["status"] == "finished":
        raise _game_finished()
    if not game_state.is_round_complete(state):
        raise ApiError(409, "GAME_IN_PROGRESS", "Not everyone has picked yet.")

    # Commit the round that just finished into history exactly once. A
    # double-submitted play-again lands here with the round ALREADY
    # advanced (is_round_complete would then be False, caught above), so
    # this can't double-record the same round -- and the same guard is
    # exactly what makes the Postgres writes below single-fire too: see
    # the Phase 4.4 persistence section for why a repeat can't reach them.
    standings = _compute_standings(state)
    game_state.record_round_history(state, standings)

    if state.get("db_round_id") is not None:
        _try_persist(
            state,
            lambda conn: game_persistence.complete_round(
                conn, state["db_round_id"], standings, state["db_game_player_ids"],
            ),
        )

    if not game_state.can_start_next_round(state):
        game_state.finish_game(state)
        xp_result = None
        if state.get("db_game_id") is not None:
            xp_result = _try_persist(
                state,
                lambda conn: game_persistence.complete_game(
                    conn, state["db_game_id"], state["cumulative_scores"], state["db_game_player_ids"],
                    state["rounds_history"], state["timer_seconds"],
                ),
            )
        _save_state(state)
        return _ok(_state_dto(state, xp_result=xp_result))

    q = difficulty.generate_target_for_difficulty(
        con, num_players=state["mode"]["num_players"], difficulty=state["difficulty"], mode=state["mode"],
    )
    if q is None:
        raise ApiError(422, "NO_FAIR_QUESTION", "Couldn't generate a fair question — try again.")

    game_state.start_next_round(state, q)

    if state.get("db_game_id") is not None:
        new_round_id = _try_persist(
            state,
            lambda conn: game_persistence.create_round(
                conn, state["db_game_id"], state["current_round"], q, q["target"],
            ),
        )
        state["db_round_id"] = new_round_id

    _save_state(state)
    return _ok(_state_dto(state))


@api_bp.route("/game/history", methods=["GET"])
@json_errors
def game_history():
    state = _require_state()
    return _ok({
        "gameId": state["game_id"],
        "status": state["status"],
        "currentRound": state["current_round"],
        "roundsTotal": state["rounds_total"],
        "cumulativeScores": state["cumulative_scores"],
        "overallStandings": _overall_standings(state["cumulative_scores"]),
        "rounds": [
            {
                "roundNumber": r["round_number"],
                "question": _question_dto(r["question"]),
                "standings": _standings_dto(r["standings"]),
                "completedAt": r["completed_at"],
            }
            for r in state["rounds_history"]
        ],
    })


@api_bp.route("/player/search", methods=["GET"])
@json_errors
def player_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return _ok({"results": []})

    result = name_match.resolve_player_fuzzy(con, q)
    if result["status"] == "not_found":
        rows = []
    elif result["status"] == "exact":
        rows = [result["player"]]
    else:
        rows = result["candidates"]

    results = []
    for r in rows:
        d = _player_dict(r)
        d["confidence"] = _confidence_for(q, r[1])
        results.append(d)

    return _ok({"results": results})

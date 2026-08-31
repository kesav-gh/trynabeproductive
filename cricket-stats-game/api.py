"""
api.py

JSON API for the React frontend, sitting alongside the original HTML pages
in app.py. This file adds NO new game logic -- every question, every name
resolution, every pick validation and every score is computed by calling
straight into question_gen.py and name_match.py, unchanged. What this file
does is:

  1. Translate JSON requests into calls against those two modules, using
     the exact same call sequence app.py's HTML routes use
     (resolve_player_fuzzy -> evaluate_guess, in that order, for the same
     reason app.py does it in that order -- see name_match.py's docstring).
  2. Hold game state in the Flask session, same mechanism app.py uses,
     under its own "api_game" key so the two flows can't collide if
     someone mixes old HTML pages and the new frontend in one browser.
  3. Serialise that state to JSON in a shape the frontend already has
     types for (see frontend/src/types/game.ts and .../types/api.ts).

One deliberate carry-over from a fix made to app.py earlier: GET
/api/game/reveal refuses to compute standings until every player has
finished picking. Without that guard, any player could read the live
totals mid-round by hitting the endpoint directly -- exactly the bug
app.py's /reveal route was patched to close, and an API is an *easier*
place to reintroduce that hole than a page, not a safer one.

Values a completed pick carries are exactly what evaluate_guess() returns:
a name and a number. It does not return the player's id, country or role,
so neither does this API for a *committed* pick -- only the disambiguation
step (which uses name_match's candidate tuples directly) has those fields.
"""

import logging

from flask import Blueprint, jsonify, request, session

import name_match
import question_gen
from extensions import con

api_bp = Blueprint("api", __name__, url_prefix="/api")
log = logging.getLogger("cricket_api")

SESSION_KEY = "api_game"


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
        except Exception:
            log.exception("Unhandled error in %s", fn.__name__)
            return jsonify({
                "error": {
                    "code": "SERVER_ERROR",
                    "message": "Something went wrong talking to the database. Try again.",
                }
            }), 500

    wrapped.__name__ = fn.__name__
    return wrapped


def _no_active_game():
    return ApiError(404, "NO_ACTIVE_GAME", "No game in progress. Start a new one.")


def _game_complete():
    return ApiError(409, "GAME_COMPLETE", "Everyone has finished picking. Head to the reveal.")


# ---------------------------------------------------------------------------
# Session state helpers
# ---------------------------------------------------------------------------
#
# State shape (all JSON-safe -- Flask signs the session into a cookie):
#   {
#     "mode": {"num_players": 3|5|None, "stat": str|None, "format": str|None,
#              "country": str|None, "role_bucket": str|None},
#     "player_names": [str, ...],
#     "question": {...}            # exactly what generate_target() returned
#     "current_player_idx": int,
#     "picks": {name: [[player_name, value], ...]},
#     "pending_ambiguous": {"typed": str, "candidates": [[id,name,country,role], ...]} | None,
#   }

def _get_state():
    return session.get(SESSION_KEY)


def _require_state():
    state = _get_state()
    if state is None:
        raise _no_active_game()
    return state


def _save_state(state):
    session[SESSION_KEY] = state
    session.modified = True


def _current_player_name(state):
    idx = state["current_player_idx"]
    names = state["player_names"]
    return names[idx] if idx < len(names) else None


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


def _state_dto(state, pick_error=None, turn_complete=False):
    current_name = _current_player_name(state)

    my_picks = None
    if current_name is not None:
        my_picks = [
            {"playerName": name, "value": value}
            for name, value in state["picks"][current_name]
        ]

    pending = state.get("pending_ambiguous")
    pending_dto = None
    if pending:
        pending_dto = {
            "query": pending["typed"],
            "candidates": [_player_dict(c) for c in pending["candidates"]],
        }

    return {
        "question": _question_dto(state["question"]),
        "numPlayers": state["question"]["num_players"],
        "currentPlayerIndex": state["current_player_idx"],
        "currentPlayerName": current_name,
        "totalPlayers": len(state["player_names"]),
        "myPicks": my_picks,
        "pendingAmbiguous": pending_dto,
        "pickError": pick_error,
        "turnComplete": turn_complete,
    }


def _ok(data, status=200):
    return jsonify({"data": data}), status


# ---------------------------------------------------------------------------
# Shared pick-commit logic -- mirrors app.py's _score_and_route() exactly,
# just returning a (pick_error, turn_complete) pair instead of a redirect.
# ---------------------------------------------------------------------------

def _attempt_commit(state, person, player_name):
    q = state["question"]
    already = state["picks"][person]

    if any(name == player_name for name, _ in already):
        return {"code": "DUPLICATE", "message": f"You've already picked {player_name}."}, False

    guess = question_gen.evaluate_guess(
        con, player_name, q["stat"], q["format"],
        country=q["country"], role_bucket=q["role_bucket"],
    )
    if not guess["valid"]:
        return {"code": "REJECTED", "message": guess["reason"]}, False

    already.append([guess["player_name"], guess["value"]])
    state["picks"][person] = already

    turn_complete = len(already) >= q["num_players"]
    if turn_complete:
        state["current_player_idx"] += 1

    return None, turn_complete


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@api_bp.route("/game/start", methods=["POST"])
@json_errors
def start_game():
    body = request.get_json(silent=True) or {}

    raw_names = body.get("playerNames")
    if not isinstance(raw_names, list):
        raise ApiError(400, "VALIDATION_ERROR", "playerNames must be a list of names.")

    names = [str(n).strip() for n in raw_names if str(n).strip()]
    if len(names) < 2:
        raise ApiError(400, "VALIDATION_ERROR", "Need at least 2 players.")
    if len({n.lower() for n in names}) != len(names):
        raise ApiError(400, "VALIDATION_ERROR", "Two players have the same name.")

    mode_in = body.get("mode") or {}
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

    mode = {
        "num_players": num_players,
        "stat": stat,
        "format": format_,
        "country": country,
        "role_bucket": role_bucket,
    }

    q = question_gen.generate_target(
        con,
        num_players=mode["num_players"],
        stat=mode["stat"],
        format_=mode["format"],
        country=mode["country"],
        role_bucket=mode["role_bucket"],
    )
    if q is None:
        raise ApiError(422, "NO_FAIR_QUESTION", "Couldn't generate a fair question — try again.")

    state = {
        "mode": mode,
        "player_names": names,
        "question": q,
        "current_player_idx": 0,
        "picks": {name: [] for name in names},
        "pending_ambiguous": None,
    }
    _save_state(state)
    return _ok(_state_dto(state))


@api_bp.route("/game/state", methods=["GET"])
@json_errors
def game_state():
    state = _require_state()
    return _ok(_state_dto(state))


@api_bp.route("/game/pick", methods=["POST"])
@json_errors
def submit_pick():
    state = _require_state()
    person = _current_player_name(state)
    if person is None:
        raise _game_complete()

    body = request.get_json(silent=True) or {}
    typed = str(body.get("typed", "")).strip()

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
    player_name = result["player"][1]
    pick_error, turn_complete = _attempt_commit(state, person, player_name)
    _save_state(state)
    return _ok(_state_dto(state, pick_error=pick_error, turn_complete=turn_complete))


@api_bp.route("/game/ambiguous", methods=["POST"])
@json_errors
def submit_ambiguous():
    state = _require_state()
    person = _current_player_name(state)
    if person is None:
        raise _game_complete()

    pending = state.get("pending_ambiguous")
    if not pending:
        raise ApiError(409, "NO_PENDING_AMBIGUOUS", "There is nothing to confirm. Type a name first.")

    body = request.get_json(silent=True) or {}
    player_id = body.get("playerId")

    match = next((c for c in pending["candidates"] if c[0] == player_id), None)

    # Whatever happens next, the ambiguous prompt is resolved one way or
    # another -- app.py never re-shows the candidate list on a bad
    # selection either, it always drops back to the plain pick screen.
    state["pending_ambiguous"] = None

    if match is None:
        _save_state(state)
        pick_error = {"code": "INVALID_SELECTION", "message": "Invalid selection — try again."}
        return _ok(_state_dto(state, pick_error=pick_error))

    player_name = match[1]
    pick_error, turn_complete = _attempt_commit(state, person, player_name)
    _save_state(state)
    return _ok(_state_dto(state, pick_error=pick_error, turn_complete=turn_complete))


@api_bp.route("/game/next-turn", methods=["POST"])
@json_errors
def next_turn():
    state = _require_state()
    if _current_player_name(state) is None:
        raise _game_complete()
    return _ok(_state_dto(state))


@api_bp.route("/game/reveal", methods=["GET"])
@json_errors
def reveal():
    state = _require_state()
    names = state["player_names"]

    # The same guard app.py's /reveal route enforces: no totals for anyone
    # until every player has finished picking.
    if state["current_player_idx"] < len(names):
        raise ApiError(409, "GAME_IN_PROGRESS", "Not everyone has picked yet.")

    q = state["question"]
    picks = state["picks"]

    results = {name: sum(v for _, v in plist) for name, plist in picks.items()}
    diffs = {name: abs(total - q["target"]) for name, total in results.items()}
    best = min(diffs.values())
    winners = {name for name, d in diffs.items() if d == best}

    standings = [
        {
            "participantName": name,
            "picks": [{"playerName": n, "value": v} for n, v in picks[name]],
            "total": results[name],
            "difference": diffs[name],
            "won": name in winners,
        }
        for name in names
    ]

    return _ok({
        "question": _question_dto(q),
        "target": q["target"],
        "standings": standings,
    })


@api_bp.route("/game/play-again", methods=["POST"])
@json_errors
def play_again():
    state = _require_state()
    mode = state["mode"]

    q = question_gen.generate_target(
        con,
        num_players=mode["num_players"],
        stat=mode["stat"],
        format_=mode["format"],
        country=mode["country"],
        role_bucket=mode["role_bucket"],
    )
    if q is None:
        raise ApiError(422, "NO_FAIR_QUESTION", "Couldn't generate a fair question — try again.")

    state["question"] = q
    state["current_player_idx"] = 0
    state["picks"] = {name: [] for name in state["player_names"]}
    state["pending_ambiguous"] = None
    _save_state(state)
    return _ok(_state_dto(state))


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

    return _ok({"results": [_player_dict(r) for r in rows]})

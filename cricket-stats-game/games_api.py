"""
games_api.py

Phase 4.4's read-only game HISTORY endpoints: GET /api/games/history (a
paginated summary of the signed-in user's completed games) and
GET /api/games/<id> (one game's full detail). All the WRITING that fills
these tables happens from api.py, at the exact points a round or a game
actually completes (see api.py's Phase 4.4 persistence section and
game_persistence.py) -- this file only ever reads.

A separate blueprint from api.py's live, session-based game endpoints,
auth_api.py (accounts) and profile_api.py, for the same reason those
are already split from each other: distinct concern, distinct file,
distinct tests. URL prefix is /api/games (plural) specifically so it
never collides with api.py's existing GET /api/game/history (singular
-- the current, in-session round-by-round log for whatever game is live
right now, guest or not); the two answer different questions and both
keep working unchanged.

Both routes are wrapped in auth_api.require_auth: "whose history" is
always the signed-in session user, exactly like profile_api.py. Neither
route reads a user id from anywhere in the request. The single-game
endpoint's ownership check is baked directly into
game_persistence.get_game_for_user()'s SQL (a JOIN against
game_players.user_id) -- a game_id belonging to another account, or one
that never existed, both come back as the same 404, never a 403 that
would confirm someone else's game_id is real.
"""

import psycopg
from flask import Blueprint, jsonify, request

import appdb
import auth_api
import game_persistence

games_bp = Blueprint("games", __name__, url_prefix="/api/games")

DATABASE_UNAVAILABLE = ("DATABASE_ERROR", "History isn't available right now. Try again shortly.")

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50


def _error(status, code, message):
    return jsonify({"error": {"code": code, "message": message}}), status


def _ok(data, status=200):
    return jsonify({"data": data}), status


def _pagination_params():
    """Clamped, defensively-parsed limit/offset -- a malformed or
    out-of-range query param degrades to a sane default rather than
    ever reaching the database as-is or raising a 500."""
    try:
        limit = int(request.args.get("limit", DEFAULT_PAGE_SIZE))
    except (TypeError, ValueError):
        limit = DEFAULT_PAGE_SIZE
    try:
        offset = int(request.args.get("offset", 0))
    except (TypeError, ValueError):
        offset = 0
    limit = max(1, min(limit, MAX_PAGE_SIZE))
    offset = max(0, offset)
    return limit, offset


@games_bp.route("/history", methods=["GET"])
@auth_api.require_auth
def history(user):
    limit, offset = _pagination_params()
    try:
        with appdb.get_connection() as conn:
            # Fetch one extra row to know whether there's a next page,
            # without a separate COUNT(*) query.
            rows = game_persistence.list_games_for_user(conn, user["id"], limit + 1, offset)
    except (appdb.ConfigError, psycopg.Error):
        return _error(503, *DATABASE_UNAVAILABLE)

    has_more = len(rows) > limit
    return _ok({"games": rows[:limit], "limit": limit, "offset": offset, "hasMore": has_more})


@games_bp.route("/<int:game_id>", methods=["GET"])
@auth_api.require_auth
def game_detail(user, game_id):
    try:
        with appdb.get_connection() as conn:
            game = game_persistence.get_game_for_user(conn, user["id"], game_id)
    except (appdb.ConfigError, psycopg.Error):
        return _error(503, *DATABASE_UNAVAILABLE)

    if game is None:
        return _error(404, "NOT_FOUND", "No such game.")
    return _ok(game)

"""
profile_api.py

Phase 4.3's profile endpoints: GET /api/profile (read the current
user's identity + profile) and PATCH /api/profile (update the editable
parts of it). A separate blueprint from both api.py (the game) and
auth_api.py (accounts), for the same reason those two are already
split from each other: this is its own concern with its own tests.

Both routes are wrapped in auth_api.require_auth, which is the ONLY
thing that decides "whose profile" -- always session[SESSION_USER_KEY],
via require_auth's own lookup. Neither route reads a user id from the
request in any form, so there is no field a client could set to operate
on a different account; "one user editing another's profile" is not a
case that gets rejected, it's a case that has no way to be expressed.

Username and email are read-only here on purpose. Username stays the
fixed account identifier for this phase (see PROFILE.md for why); email
changes need a dedicated verified-email workflow that doesn't exist
yet. Only display_name and avatar_url -- the two profiles.py already
validates -- can be written through PATCH.
"""

import psycopg
from flask import Blueprint, jsonify, request

import appdb
import auth_api
import csrf
import levels
import profile as profile_module

profile_bp = Blueprint("profile", __name__, url_prefix="/api/profile")

DATABASE_UNAVAILABLE = ("DATABASE_ERROR", "Profile isn't available right now. Try again shortly.")


def _error(status, code, message):
    return jsonify({"error": {"code": code, "message": message}}), status


def _ok(data, status=200):
    return jsonify({"data": data}), status


def _public_profile(user, profile_row):
    """The one place a profile response is assembled -- same fields
    whether this came from GET or PATCH, so the frontend can treat both
    responses identically. Never includes password_hash or anything
    else auth_api.public_user() wouldn't also expose."""
    return auth_api.public_user(user, profile_row)


@profile_bp.route("", methods=["GET"])
@auth_api.require_auth
def get_profile(user):
    try:
        with appdb.get_connection() as conn:
            row = profile_module.ensure_profile(conn, user["id"], user["username"])
    except (appdb.ConfigError, psycopg.Error):
        return _error(503, *DATABASE_UNAVAILABLE)

    return _ok(_public_profile(user, row))


@profile_bp.route("/progression", methods=["GET"])
@auth_api.require_auth
def get_progression(user):
    """Phase 4.5: the signed-in user's own level/XP standing -- always
    the SAME user auth_api.require_auth resolved from the session,
    never a client-supplied id. There is no user_id (or any other)
    query parameter this route reads at all, so
    "GET /api/profile/progression?user_id=someone_else" has no field to
    even attach to; it would just be ignored and this user's own
    progression returned, same as any other extra query parameter.

    xp is read fresh from profiles.xp (kept authoritative by
    xp_service.py) on every call -- level and everything else here is
    recomputed from that single number through levels.py, never stored
    or trusted from anywhere else, so this can never disagree with the
    ledger that actually produced the xp total.
    """
    try:
        with appdb.get_connection() as conn:
            row = conn.execute("SELECT xp FROM profiles WHERE user_id = %s", [user["id"]]).fetchone()
    except (appdb.ConfigError, psycopg.Error):
        return _error(503, *DATABASE_UNAVAILABLE)

    xp = row[0] if row is not None else 0
    prog = levels.progression_for_xp(xp)
    return _ok({
        "xp": prog["xp"],
        "level": prog["level"],
        "nextLevelXp": prog["nextLevelXp"],
        "xpIntoLevel": prog["xpIntoLevel"],
        "xpToNextLevel": prog["xpToNextLevel"],
        "progressPercent": prog["progressPercent"],
    })


@profile_bp.route("", methods=["PATCH"])
@csrf.protect
@auth_api.require_auth
def update_profile(user):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return _error(400, "VALIDATION_ERROR", "Request body must be a JSON object.")

    unknown_fields = set(body.keys()) - profile_module.ALLOWED_UPDATE_FIELDS
    if unknown_fields:
        return _error(
            400, "VALIDATION_ERROR",
            f"Unsupported field(s): {', '.join(sorted(unknown_fields))}.",
        )

    updates = {}
    try:
        if "displayName" in body:
            updates["displayName"] = profile_module.validate_display_name(body["displayName"])
        if "avatarUrl" in body:
            updates["avatarUrl"] = profile_module.validate_avatar_url(body["avatarUrl"])
    except profile_module.ValidationError as e:
        return _error(400, "VALIDATION_ERROR", e.message)

    if not updates:
        return _error(400, "VALIDATION_ERROR", "Nothing to update.")

    try:
        with appdb.get_connection() as conn:
            row = profile_module.update_profile(conn, user["id"], updates, user["username"])
    except (appdb.ConfigError, psycopg.Error):
        return _error(503, *DATABASE_UNAVAILABLE)

    return _ok(_public_profile(user, row))

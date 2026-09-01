"""
auth_api.py

Phase 4.2's authentication endpoints: register, login, logout, and the
current-identity check. A separate blueprint from api.py's game
endpoints, for the same reason api.py itself was split out from app.py
originally: new surface area gets its own file rather than growing an
existing one, and the two can be read and tested independently.

Session handling reuses the exact mechanism the game already relies on
-- Flask's signed-cookie session -- under its own key ("auth_user_id")
so it can never collide with the game's own "api_game" key. Logging in
or out never touches api_game at all: an in-progress guest game
survives a login exactly as it was, and playing a guest game never
requires reaching any route in this file. The two are independent by
construction, not by a special case anywhere.

Every route here returns JSON in the same {"data": ...} / {"error":
{"code", "message"}} shape api.py already uses, and never returns
password_hash, a database connection string, a stack trace, or this
app's secret key -- see public_user() below, which is the only place a
user record is ever serialised for a response.

require_auth (used by profile_api.py too, for Phase 4.3) is the one
place "who's making this request" gets resolved from the session --
always session[SESSION_USER_KEY], NEVER a client-supplied id. A route
wrapped in it receives the current user's own dict as its first
argument and has no way to ask for anyone else's.
"""

from functools import wraps

import psycopg
from flask import Blueprint, jsonify, request, session

import appdb
import auth
import csrf
import profile as profile_module
import ratelimit

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

# Per-client-IP, in-memory (see ratelimit.py for what that does and does
# not protect against).
LOGIN_RATE_LIMIT = (10, 60)      # 10 attempts / 60s
REGISTER_RATE_LIMIT = (5, 300)   # 5 attempts / 5 min

SESSION_USER_KEY = "auth_user_id"

DATABASE_UNAVAILABLE = ("DATABASE_ERROR", "Accounts aren't available right now. Try again shortly.")
INVALID_CREDENTIALS = ("INVALID_CREDENTIALS", "Incorrect email/username or password.")


def _client_ip():
    return request.remote_addr or "unknown"


def _json_body():
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def _error(status, code, message):
    return jsonify({"error": {"code": code, "message": message}}), status


def public_user(user, profile=None):
    """The ONLY function anywhere in this file that turns a user record
    into a response body -- deliberately narrow, so nothing new ever
    gets added to the users table and silently starts leaking through
    an endpoint without this function being revisited. password_hash
    never passes through here, ever.

    `profile` (a {displayName, avatarUrl} dict from profile.py, or None)
    is folded into the SAME user object the frontend's AuthContext
    already holds -- Phase 4.3 deliberately doesn't introduce a second,
    parallel "profile state" alongside it. displayName falls back to the
    username so a caller that hasn't loaded a profile row yet still gets
    a sensible value rather than null.
    """
    created_at = user["createdAt"]
    return {
        "id": user["id"],
        "email": user["email"],
        "username": user["username"],
        "createdAt": created_at if isinstance(created_at, str) else created_at.isoformat(),
        "displayName": (profile or {}).get("displayName") or user["username"],
        "avatarUrl": (profile or {}).get("avatarUrl"),
    }


def _current_user_or_none():
    """Whoever session says is logged in, or None -- covers "never logged
    in", "session refers to an account that's since been deactivated or
    deleted" (clearing the stale session in that case), and "database
    briefly unreachable" alike, since none of those are meaningfully
    different from this function's one caller's point of view. Used by
    both /me and require_auth below, so there is exactly one place this
    check is implemented."""
    user_id = session.get(SESSION_USER_KEY)
    if user_id is None:
        return None
    try:
        with appdb.get_connection() as conn:
            user = auth.get_user_by_id(conn, user_id)
    except (appdb.ConfigError, psycopg.Error):
        return None
    if user is None or not user["isActive"]:
        session.pop(SESSION_USER_KEY, None)
        return None
    return user


def current_user_id_or_none():
    """Whoever's authenticated on this session, by id only, or None for a
    guest. Used by api.py (Phase 4.4) to decide whether a game should be
    persisted at all -- api.py never touches session[SESSION_USER_KEY]
    itself, or knows that key's name, it only ever asks this."""
    user = _current_user_or_none()
    return user["id"] if user else None


def require_auth(fn):
    """Wraps a view so it only runs for a genuinely signed-in user,
    passing that user's own dict as the first argument. There is no
    other way for a wrapped view to learn "which user" -- it is never
    read from the request body, a query parameter, or anywhere else a
    client could supply a different id."""

    @wraps(fn)
    def wrapped(*args, **kwargs):
        user = _current_user_or_none()
        if user is None:
            return _error(401, "NOT_AUTHENTICATED", "You need to be signed in to do that.")
        return fn(user, *args, **kwargs)

    return wrapped


@auth_bp.route("/register", methods=["POST"])
@csrf.protect
def register():
    if not ratelimit.check(f"register:{_client_ip()}", *REGISTER_RATE_LIMIT):
        return _error(429, "RATE_LIMITED", "Too many attempts. Try again in a few minutes.")

    body = _json_body()
    email, username, password = body.get("email"), body.get("username"), body.get("password")
    confirm_password = body.get("confirmPassword", password)

    if not isinstance(email, str) or not isinstance(username, str) or not isinstance(password, str):
        return _error(400, "VALIDATION_ERROR", "email, username and password are required.")

    try:
        norm_email, norm_username = auth.validate_registration(email, username, password, confirm_password)
    except auth.ValidationError as e:
        return _error(400, "VALIDATION_ERROR", e.message)

    try:
        with appdb.get_connection() as conn:
            user = auth.create_user(conn, norm_email, norm_username, password)
    except auth.ValidationError as e:
        return _error(409, "VALIDATION_ERROR", e.message)
    except (appdb.ConfigError, psycopg.Error):
        return _error(503, *DATABASE_UNAVAILABLE)

    session[SESSION_USER_KEY] = user["id"]
    session.permanent = True
    # auth.create_user() just created the profile row itself, with
    # display_name == username and no avatar -- no extra query needed to
    # know what it contains.
    new_profile = {"displayName": user["username"], "avatarUrl": None}
    return jsonify({"data": {"user": public_user(user, new_profile)}}), 201


@auth_bp.route("/login", methods=["POST"])
@csrf.protect
def login():
    if not ratelimit.check(f"login:{_client_ip()}", *LOGIN_RATE_LIMIT):
        return _error(429, "RATE_LIMITED", "Too many attempts. Try again in a minute.")

    body = _json_body()
    login_value, password = body.get("login"), body.get("password")
    if not isinstance(login_value, str) or not login_value.strip() or not isinstance(password, str):
        return _error(400, "VALIDATION_ERROR", "login and password are required.")

    try:
        with appdb.get_connection() as conn:
            user = auth.find_user_by_login(conn, login_value)
            # Deliberately one generic failure for "no such account",
            # "wrong password", and "account deactivated" alike --
            # telling them apart would tell an attacker which
            # emails/usernames are registered at all. See
            # auth.find_user_by_login/verify_password: this is the only
            # place their results are compared, so there's nowhere else
            # for a timing or message difference to leak from.
            if user is None or not user["isActive"] or not auth.verify_password(user["passwordHash"], password):
                return _error(401, *INVALID_CREDENTIALS)
            found_profile = profile_module.ensure_profile(conn, user["id"], user["username"])
    except (appdb.ConfigError, psycopg.Error):
        return _error(503, *DATABASE_UNAVAILABLE)

    session[SESSION_USER_KEY] = user["id"]
    session.permanent = True
    return jsonify({"data": {"user": public_user(user, found_profile)}}), 200


@auth_bp.route("/logout", methods=["POST"])
@csrf.protect
def logout():
    session.pop(SESSION_USER_KEY, None)
    return jsonify({"data": {"loggedOut": True}}), 200


@auth_bp.route("/me", methods=["GET"])
def me():
    # The database being briefly unreachable shouldn't read as "you got
    # logged out" to whoever's watching a status flip, but this request
    # also can't confirm the session is still valid -- and /me is called
    # on every page load, so it must never 500. _current_user_or_none()
    # already reports that case (and a deactivated/deleted account) as
    # "no user" rather than raising, so there's nothing more to special-
    # case here.
    user = _current_user_or_none()
    if user is None:
        return jsonify({"data": {"authenticated": False, "user": None}}), 200

    try:
        with appdb.get_connection() as conn:
            found_profile = profile_module.ensure_profile(conn, user["id"], user["username"])
    except (appdb.ConfigError, psycopg.Error):
        found_profile = None  # still authenticated -- just show the username as a fallback

    return jsonify({"data": {"authenticated": True, "user": public_user(user, found_profile)}}), 200

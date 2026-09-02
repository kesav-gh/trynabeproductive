"""
extensions.py

Holds the single Flask app instance and the single DuckDB connection, so
both app.py (the original HTML pages) and api.py (the new JSON API) can
share them without opening a second 1.6 GB database connection and without
app.py and api.py importing each other in a circle.

Also registers a pair of app-wide error handlers that keep JSON requests
JSON: any unhandled exception or 404 under /api/ gets a structured JSON
body instead of Flask's default HTML error page. The existing HTML routes
under app.py are untouched -- they still get Flask's normal error pages.

Phase 4.2 adds the session/cookie configuration authentication needs:
a secret key that is never a fixed string in source (see
_load_or_create_dev_secret_key below), and explicit HttpOnly/SameSite/
Secure/lifetime settings rather than relying on Flask's defaults.
Nothing about the GAME's own session usage changes -- api_game still
lives under its own key, unaffected by any of this.
"""

import logging
import os
import secrets
from datetime import timedelta
from pathlib import Path

import duckdb
from dotenv import load_dotenv
from flask import Flask, jsonify, request

import csrf
import question_gen

load_dotenv()

app = Flask(__name__)


def _load_or_create_dev_secret_key():
    """FLASK_SECRET_KEY should be set via the environment for anything
    beyond casual local dev (see .env.example) -- this fallback exists
    only so a fresh checkout still runs with zero setup, without going
    back to hardcoding a fixed key in source the way this file used to
    (a fixed key committed to git means anyone who reads the repo can
    forge a session). The generated key is written to a gitignored file
    next to this one and reused from there on subsequent starts, so it
    survives Flask's debug-mode auto-reloader -- which restarts the
    whole process on every file save -- instead of silently invalidating
    every session (the game's included) on each reload.
    """
    key_file = Path(__file__).resolve().parent / ".flask_secret_key"
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()
    key = secrets.token_hex(32)
    key_file.write_text(key, encoding="utf-8")
    return key


app.secret_key = os.environ.get("FLASK_SECRET_KEY") or _load_or_create_dev_secret_key()

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,   # never readable from JavaScript
    SESSION_COOKIE_SAMESITE="Lax",  # sent on same-site navigation/fetch, not cross-site
    # Plain HTTP in local dev (no TLS) can't set a Secure cookie at all --
    # the browser would just drop it. Real deployments over HTTPS should
    # set SESSION_COOKIE_SECURE=true in their environment.
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "false").strip().lower() == "true",
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
)

DB_PATH = question_gen.DB_PATH
con = duckdb.connect(DB_PATH, read_only=True)

log = logging.getLogger("cricket_api")


@app.after_request
def _csrf_cookie(response):
    return csrf.ensure_cookie(response)


@app.after_request
def _no_store_for_identity_endpoints(response):
    """/api/auth/* and /api/profile carry per-session identity data that
    must never be served from a cache after it's gone stale -- most
    importantly, a browser (or an intermediate proxy) reusing a cached
    "authenticated: true" GET /api/auth/me response after a real logout
    would make someone look signed in when they no longer are. Neither
    route sends a Cache-Control header by default, and GET responses
    with none can be heuristically cached, so this makes the "never
    cache this" intent explicit rather than relying on how JSON API
    responses without one happen to be treated today.

    Phase 4.4 extends this to /api/games/* for the same reason: a
    signed-in user's game history is private, per-account data, and a
    stale cached response could keep showing (or hiding) it after the
    real data -- or who's signed in -- has changed.

    Phase 4.5 extends the /api/profile match to cover
    /api/profile/progression too (level/XP is exactly the same kind of
    private, per-account data that just changed)."""
    if (
        request.path.startswith("/api/auth/")
        or request.path == "/api/profile"
        or request.path.startswith("/api/profile/")
        or request.path.startswith("/api/games/")
    ):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(404)
def _handle_404(err):
    if request.path.startswith("/api/"):
        return jsonify({"error": {"code": "NOT_FOUND", "message": "No such API endpoint."}}), 404
    return err


@app.errorhandler(500)
def _handle_500(err):
    if request.path.startswith("/api/"):
        log.exception("Unhandled error on %s", request.path)
        return jsonify({
            "error": {
                "code": "SERVER_ERROR",
                "message": "Something went wrong talking to the database. Try again.",
            }
        }), 500
    return err

"""
csrf.py

Double-submit-cookie CSRF protection for the auth endpoints that change
server-side session state on behalf of whoever's cookies are attached
to the request: register, login, logout.

How it works: `ensure_cookie` (wired up as an after_request hook in
extensions.py) sets a `csrf_token` cookie -- a random value, readable by
JavaScript, since the frontend has to read it back -- on any response
where the request didn't already carry one. A route wrapped in
`@protect` then additionally requires that SAME value to arrive as an
`X-CSRF-Token` header. A cross-site page can make the victim's browser
SEND the csrf_token cookie automatically (that is exactly the CSRF
exploit), but it cannot READ that cookie's value -- browsers enforce
same-origin for cookie access via JavaScript -- and so cannot construct
a matching header. That gap is the entire defense.

This is why the frontend's fetch wrapper (frontend/src/lib/http.ts)
reads document.cookie itself and attaches the header on every mutating
auth request, rather than this being a hidden form field: there is no
server-rendered form here to put one in, and a JSON API talking to a
frontend that (in dev) is proxied to look same-origin is exactly the
shape this pattern is designed for -- it's the same mechanism Django
and Rails both use for a JSON/API-driven frontend, not a homegrown
substitute for a real CSRF defense.

Originally scoped to just the three auth endpoints (Phase 4.2), back
when the game endpoints in api.py were unauthenticated, purely
session-local state with no account or persisted data behind them.
Phase 4.4 changed that -- a signed-in user's POST /api/game/start now
creates a real, permanent Postgres history tied to their account (see
game_persistence.py) -- so Phase 4.4.1 extends this SAME @protect
decorator to every state-changing route under /api/game/*, rather than
inventing a second CSRF mechanism. Nothing about the double-submit
pattern itself changes: guest games are protected too now (a forged
request could still corrupt a guest's live session game even with
nothing persisted behind it), and since every page load already
triggers GET /api/auth/me before a guest could reach a "start game"
button, a real browser session always already has a csrf_token cookie
by the time it needs one -- see frontend/src/lib/api.ts.
"""

import secrets
from functools import wraps

from flask import current_app, jsonify, request

COOKIE_NAME = "csrf_token"
HEADER_NAME = "X-CSRF-Token"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days -- matches the session lifetime in extensions.py


def ensure_cookie(response):
    """Call from an after_request hook. Issues a csrf_token cookie on any
    response where the request didn't already have a valid one, so the
    frontend always has a fresh token available before it ever needs to
    submit one -- in practice, by the time a user reaches a login or
    signup form, GET /api/auth/me (called on every app load) has already
    set this."""
    if not request.cookies.get(COOKIE_NAME):
        token = secrets.token_urlsafe(32)
        response.set_cookie(
            COOKIE_NAME,
            token,
            httponly=False,  # the frontend MUST be able to read this
            samesite="Lax",
            secure=current_app.config.get("SESSION_COOKIE_SECURE", False),
            max_age=COOKIE_MAX_AGE,
        )
    return response


def protect(fn):
    """Require a valid, matching X-CSRF-Token header for this route."""

    @wraps(fn)
    def wrapped(*args, **kwargs):
        cookie_token = request.cookies.get(COOKIE_NAME)
        header_token = request.headers.get(HEADER_NAME)
        if not cookie_token or not header_token or not secrets.compare_digest(cookie_token, header_token):
            return jsonify({
                "error": {
                    "code": "CSRF_FAILURE",
                    "message": "Request could not be verified. Refresh the page and try again.",
                }
            }), 403
        return fn(*args, **kwargs)

    return wrapped

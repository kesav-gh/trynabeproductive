"""
test_auth.py

Tests for Phase 4.2 authentication: registration, login, session
identity, logout, and the security properties that make those safe
(hashing, CSRF, generic failure messages, no leaked internals).

Every test here needs a real, reachable PostgreSQL -- unlike the game
tests, there's no meaningful way to test "does registration create a
real account" without a real database, so this whole file (not just
part of it) skips itself when one isn't configured, the same way
test_appdb.py's connection tests do.
"""

import json

import pytest

import appdb
import auth
import ratelimit
from conftest import csrf_post

_HEALTHY, _HEALTH_DETAIL = appdb.health_check()

pytestmark = pytest.mark.skipif(
    not _HEALTHY,
    reason=f"application database not reachable: {_HEALTH_DETAIL}",
)


@pytest.fixture(autouse=True)
def _clean_users_table_and_rate_limits():
    """Every test starts from a clean `users` table (profiles cascade
    with it) and a clean rate-limit counter, so registering "the same"
    test account in two different tests never collides, and one test's
    login attempts never trip another test's rate limit."""
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM users")
        conn.commit()
    ratelimit.reset()
    yield
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM users")
        conn.commit()
    ratelimit.reset()


VALID_USER = {
    "email": "player@example.com",
    "username": "player_one",
    "password": "correct-horse-battery",
    "confirmPassword": "correct-horse-battery",
}


def register(client, **overrides):
    body = {**VALID_USER, **overrides}
    return csrf_post(client, "/api/auth/register", body)


def login(client, login_value, password):
    return csrf_post(client, "/api/auth/login", {"login": login_value, "password": password})


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def test_valid_registration(client):
    status, body = register(client)
    assert status == 201
    user = body["data"]["user"]
    assert user["email"] == VALID_USER["email"]
    assert user["username"] == VALID_USER["username"]
    assert "id" in user and "createdAt" in user


def test_registration_logs_the_user_in(client):
    register(client)
    r = client.get("/api/auth/me")
    body = r.get_json()
    assert body["data"]["authenticated"] is True
    assert body["data"]["user"]["username"] == VALID_USER["username"]


def test_registration_creates_a_profile_row(client, app):
    status, body = register(client)
    user_id = body["data"]["user"]["id"]
    with appdb.get_connection() as conn:
        row = conn.execute(
            "SELECT display_name FROM profiles WHERE user_id = %s", [user_id],
        ).fetchone()
    assert row is not None
    assert row[0] == VALID_USER["username"]


def test_invalid_email_rejected(client):
    status, body = register(client, email="not-an-email")
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_invalid_username_rejected(client):
    for bad in ["ab", "way-too-long-a-username-to-be-valid", "has spaces", "has-dash"]:
        status, body = register(client, username=bad)
        assert status == 400, bad
        assert body["error"]["code"] == "VALIDATION_ERROR"


def test_weak_password_rejected(client):
    status, body = register(client, password="short1", confirmPassword="short1")
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_mismatched_password_confirmation_rejected(client):
    status, body = register(client, confirmPassword="something-else-entirely")
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_duplicate_email_rejected(client):
    register(client)
    status, body = register(client, username="a_different_name")
    assert status == 409
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "email" in body["error"]["message"].lower()


def test_duplicate_username_rejected(client):
    register(client)
    status, body = register(client, email="different@example.com")
    assert status == 409
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "username" in body["error"]["message"].lower()


def test_duplicate_username_is_case_insensitive(client):
    register(client)
    status, body = register(
        client, email="different@example.com", username=VALID_USER["username"].upper(),
    )
    assert status == 409


def test_email_is_normalized_case_insensitively(client):
    register(client)
    status, body = register(client, email=VALID_USER["email"].upper(), username="another_name")
    assert status == 409


def test_registration_database_failure_returns_generic_error(client, monkeypatch):
    def _broken():
        raise appdb.ConfigError("simulated: could not connect to postgresql://real-host/real-db")

    monkeypatch.setattr(appdb, "get_connection", _broken)
    status, body = register(client)
    assert status == 503
    assert body["error"]["code"] == "DATABASE_ERROR"
    dumped = json.dumps(body)
    assert "postgresql://" not in dumped
    assert "ConfigError" not in dumped
    assert "real-host" not in dumped


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

def test_login_with_email(client):
    register(client)
    status, body = login(client, VALID_USER["email"], VALID_USER["password"])
    assert status == 200
    assert body["data"]["user"]["username"] == VALID_USER["username"]


def test_login_with_username(client):
    register(client)
    status, body = login(client, VALID_USER["username"], VALID_USER["password"])
    assert status == 200
    assert body["data"]["user"]["email"] == VALID_USER["email"]


def test_login_with_email_is_case_insensitive(client):
    register(client)
    status, body = login(client, VALID_USER["email"].upper(), VALID_USER["password"])
    assert status == 200


def test_login_wrong_password(client):
    register(client)
    status, body = login(client, VALID_USER["username"], "the-wrong-password")
    assert status == 401
    assert body["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_unknown_account(client):
    status, body = login(client, "nobody_registered", "whatever-password")
    assert status == 401
    assert body["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_wrong_password_and_unknown_account_are_indistinguishable(client):
    """The core anti-enumeration property: both failure modes must
    produce byte-identical error bodies and status codes."""
    register(client)
    _, wrong_password_body = login(client, VALID_USER["username"], "definitely-wrong")
    _, unknown_account_body = login(client, "nobody-with-this-name", "definitely-wrong")
    assert wrong_password_body == unknown_account_body


def test_login_malformed_request(client):
    status, body = csrf_post(client, "/api/auth/login", {"login": "someone"})  # no password field
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"

    status, body = csrf_post(client, "/api/auth/login", {"login": 123, "password": "x"})
    assert status == 400


def test_login_rate_limited_after_repeated_failures(client):
    register(client)
    statuses = []
    for _ in range(15):
        status, _ = login(client, VALID_USER["username"], "wrong-every-time")
        statuses.append(status)
    assert 429 in statuses
    # every attempt before the limit kicked in was a normal credential
    # failure, not something else going wrong
    assert all(s in (401, 429) for s in statuses)


def test_login_requires_csrf_token(client):
    register(client)
    csrf_post(client, "/api/auth/logout")
    r = client.post(
        "/api/auth/login",
        data=json.dumps({"login": VALID_USER["username"], "password": VALID_USER["password"]}),
        content_type="application/json",
        # deliberately no X-CSRF-Token header
    )
    assert r.status_code == 403
    assert r.get_json()["error"]["code"] == "CSRF_FAILURE"


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

def test_me_unauthenticated_by_default(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.get_json()["data"] == {"authenticated": False, "user": None}


def test_me_authenticated_after_login(client):
    register(client)
    r = client.get("/api/auth/me")
    body = r.get_json()["data"]
    assert body["authenticated"] is True
    assert body["user"]["email"] == VALID_USER["email"]


def test_session_survives_unrelated_requests(client):
    """Logging in must not disturb, and must not be disturbed by, the
    game's own session usage under a completely different key."""
    register(client)
    csrf_post(client, "/api/game/start", {"playerNames": ["Alice", "Bob"]})
    r = client.get("/api/auth/me")
    assert r.get_json()["data"]["authenticated"] is True


def test_logout_invalidates_the_session(client):
    register(client)
    assert client.get("/api/auth/me").get_json()["data"]["authenticated"] is True
    csrf_post(client, "/api/auth/logout")
    assert client.get("/api/auth/me").get_json()["data"]["authenticated"] is False


def test_logout_does_not_clear_an_in_progress_guest_game(client):
    """Backward compatibility: logging in/out must never touch api_game."""
    register(client)
    csrf_post(client, "/api/game/start", {"playerNames": ["Alice", "Bob"]})
    csrf_post(client, "/api/auth/logout")
    r = client.get("/api/game/state")
    assert r.status_code == 200  # the game is still there, unauthenticated or not


# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------

def test_password_is_hashed_not_stored_in_plaintext(client):
    register(client)
    with appdb.get_connection() as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE username = %s", [VALID_USER["username"]],
        ).fetchone()
    assert row[0] != VALID_USER["password"]
    assert row[0].startswith("scrypt:")


def test_password_hash_never_appears_in_any_auth_response(client):
    status, register_body = register(client)
    status, login_body = login(client, VALID_USER["username"], VALID_USER["password"])
    me_body = client.get("/api/auth/me").get_json()

    for body in (register_body, login_body, me_body):
        dumped = json.dumps(body)
        assert "password_hash" not in dumped
        assert "passwordHash" not in dumped
        assert "scrypt:" not in dumped
        assert VALID_USER["password"] not in dumped


def test_verify_password_uses_werkzeug_not_a_custom_comparison():
    """Guards against ever swapping in a naive `==` comparison later:
    hash_password's output must be real, Werkzeug-produced scrypt --
    genuinely verifiable by Werkzeug's own check_password_hash, not just
    by auth.verify_password calling back into itself -- and a wrong
    password must still fail against it."""
    from werkzeug.security import check_password_hash

    produced = auth.hash_password("correct-horse-battery")
    assert produced.startswith("scrypt:")
    assert check_password_hash(produced, "correct-horse-battery") is True
    assert check_password_hash(produced, "wrong-password") is False
    assert auth.verify_password(produced, "correct-horse-battery") is True
    assert auth.verify_password(produced, "wrong-password") is False


def test_secret_key_is_not_the_old_hardcoded_string(app):
    assert app.app.secret_key != "cricket-stats-game-local-only"
    assert app.app.secret_key  # not empty either


def test_session_cookie_security_settings(app):
    assert app.app.config["SESSION_COOKIE_HTTPONLY"] is True
    assert app.app.config["SESSION_COOKIE_SAMESITE"] == "Lax"
    assert app.app.config["PERMANENT_SESSION_LIFETIME"].days == 7


def test_auth_and_profile_responses_are_never_cached(client):
    """Regression test for a real bug found during Phase 4.3's browser
    verification: GET /api/auth/me carried no Cache-Control header at
    all, which let a real browser serve a stale cached
    "authenticated: true" response after an actual logout had already
    succeeded server-side (confirmed live: the session cookie's own
    encoded value genuinely changed on logout, but the browser kept
    showing the old identity anyway until this header was added).
    A curl-with-a-fresh-cookie-jar test would never have caught this --
    curl doesn't apply HTTP heuristic caching the way a real browser does."""
    register(client)
    assert client.get("/api/auth/me").headers.get("Cache-Control") == "no-store"

    csrf_post(client, "/api/auth/logout")
    assert client.get("/api/auth/me").headers.get("Cache-Control") == "no-store"


def test_database_errors_never_leak_internals_in_login(client, monkeypatch):
    def _broken():
        raise appdb.ConfigError("simulated: postgresql://user:secret@host/db unreachable")

    monkeypatch.setattr(appdb, "get_connection", _broken)
    status, body = login(client, "anyone", "anything")
    assert status == 503
    dumped = json.dumps(body)
    assert "postgresql://" not in dumped
    assert "secret" not in dumped

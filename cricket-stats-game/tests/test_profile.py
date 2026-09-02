"""
test_profile.py

Tests for Phase 4.3's profile endpoints: GET /api/profile and
PATCH /api/profile, plus the "every account gets a profile row"
invariant registration is supposed to maintain.

Like test_auth.py, every test here needs a real, reachable PostgreSQL
and skips itself (not fails) when one isn't configured.
"""

import json

import psycopg
import pytest

import appdb
import ratelimit
from conftest import csrf_post, csrf_request

_HEALTHY, _HEALTH_DETAIL = appdb.health_check()

pytestmark = pytest.mark.skipif(
    not _HEALTHY,
    reason=f"application database not reachable: {_HEALTH_DETAIL}",
)


@pytest.fixture(autouse=True)
def _clean_users_table_and_rate_limits():
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM users")
        conn.commit()
    ratelimit.reset()
    yield
    with appdb.get_connection() as conn:
        conn.execute("DELETE FROM users")
        conn.commit()
    ratelimit.reset()


def register(client, username="profile_owner", email="owner@example.com"):
    status, body = csrf_post(client, "/api/auth/register", {
        "email": email, "username": username,
        "password": "password123", "confirmPassword": "password123",
    })
    assert status == 201, body
    return body["data"]["user"]


def patch_profile(client, body):
    return csrf_request(client, "PATCH", "/api/profile", body)


# ---------------------------------------------------------------------------
# Registration creates a profile
# ---------------------------------------------------------------------------

def test_registration_creates_a_readable_profile(client, app):
    user = register(client)
    with appdb.get_connection() as conn:
        row = conn.execute(
            "SELECT display_name, avatar_url FROM profiles WHERE user_id = %s", [user["id"]],
        ).fetchone()
    assert row is not None
    assert row[0] == "profile_owner"
    assert row[1] is None


# ---------------------------------------------------------------------------
# GET /api/profile
# ---------------------------------------------------------------------------

def test_get_profile_is_never_cached(client):
    """Same regression class as auth's -- a stale cached GET /api/profile
    would keep showing a display name someone already changed."""
    register(client)
    assert client.get("/api/profile").headers.get("Cache-Control") == "no-store"


def test_get_profile_authenticated(client):
    register(client)
    r = client.get("/api/profile")
    assert r.status_code == 200
    data = r.get_json()["data"]
    assert data["username"] == "profile_owner"
    assert data["email"] == "owner@example.com"
    assert data["displayName"] == "profile_owner"
    assert data["avatarUrl"] is None
    assert "id" in data and "createdAt" in data


def test_get_profile_unauthenticated(client):
    r = client.get("/api/profile")
    assert r.status_code == 401
    assert r.get_json()["error"]["code"] == "NOT_AUTHENTICATED"


def test_get_profile_never_returns_password_hash(client):
    register(client)
    r = client.get("/api/profile")
    dumped = json.dumps(r.get_json())
    assert "password_hash" not in dumped
    assert "passwordHash" not in dumped
    assert "scrypt:" not in dumped


def test_get_profile_reflects_a_previous_update(client):
    register(client)
    patch_profile(client, {"displayName": "Updated Name"})
    r = client.get("/api/profile")
    assert r.get_json()["data"]["displayName"] == "Updated Name"


# ---------------------------------------------------------------------------
# PATCH /api/profile
# ---------------------------------------------------------------------------

def test_patch_display_name(client):
    register(client)
    status, body = patch_profile(client, {"displayName": "New Display Name"})
    assert status == 200
    assert body["data"]["displayName"] == "New Display Name"
    assert body["data"]["username"] == "profile_owner"  # unaffected


def test_patch_avatar_url(client):
    register(client)
    status, body = patch_profile(client, {"avatarUrl": "https://example.com/pic.png"})
    assert status == 200
    assert body["data"]["avatarUrl"] == "https://example.com/pic.png"


def test_patch_avatar_url_can_be_cleared(client):
    register(client)
    patch_profile(client, {"avatarUrl": "https://example.com/pic.png"})
    status, body = patch_profile(client, {"avatarUrl": ""})
    assert status == 200
    assert body["data"]["avatarUrl"] is None


def test_patch_partial_update_preserves_other_field(client):
    register(client)
    patch_profile(client, {"avatarUrl": "https://example.com/pic.png"})
    status, body = patch_profile(client, {"displayName": "Just The Name Changed"})
    assert body["data"]["displayName"] == "Just The Name Changed"
    assert body["data"]["avatarUrl"] == "https://example.com/pic.png"  # untouched


def test_patch_invalid_display_name_empty(client):
    register(client)
    status, body = patch_profile(client, {"displayName": "   "})
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_patch_invalid_display_name_too_long(client):
    register(client)
    status, body = patch_profile(client, {"displayName": "x" * 41})
    assert status == 400


def test_patch_invalid_avatar_url(client):
    register(client)
    status, body = patch_profile(client, {"avatarUrl": "not-a-url-at-all"})
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_patch_malformed_request(client):
    register(client)
    if client.get_cookie("csrf_token") is None:
        client.get("/api/auth/me")
    token = client.get_cookie("csrf_token").value
    r = client.patch(
        "/api/profile", data="not json at all",
        content_type="application/json", headers={"X-CSRF-Token": token},
    )
    assert r.status_code == 400
    assert r.get_json()["error"]["code"] == "VALIDATION_ERROR"


def test_patch_empty_body_is_rejected(client):
    register(client)
    status, body = patch_profile(client, {})
    assert status == 400


def test_patch_unsupported_field_rejected(client):
    """Also the concrete guard against exactly the fields this phase
    must not expose for editing -- xp, level, id, createdAt."""
    register(client)
    for forbidden in ({"xp": 9999}, {"level": 99}, {"id": 1}, {"createdAt": "2000-01-01"}, {"username": "hacker"}):
        status, body = patch_profile(client, forbidden)
        assert status == 400, forbidden
        assert body["error"]["code"] == "VALIDATION_ERROR"


def test_patch_unauthenticated_rejected(client):
    status, body = patch_profile(client, {"displayName": "Nope"})
    assert status == 401
    assert body["error"]["code"] == "NOT_AUTHENTICATED"


def test_patch_requires_csrf_token(client):
    register(client)
    r = client.patch(
        "/api/profile",
        data=json.dumps({"displayName": "No CSRF"}),
        content_type="application/json",
        # deliberately no X-CSRF-Token header
    )
    assert r.status_code == 403
    assert r.get_json()["error"]["code"] == "CSRF_FAILURE"


def test_patch_database_failure_returns_generic_error(client, monkeypatch):
    """Breaking appdb.get_connection entirely would also break
    require_auth's OWN lookup (a genuinely fully-down database takes
    auth down with it) -- so this targets the profile-specific write
    instead, to isolate "you're signed in fine, but saving failed"."""
    register(client)

    import profile as profile_module

    def _broken(*args, **kwargs):
        raise psycopg.errors.OperationalError(
            "simulated: postgresql://user:secret@host/db unreachable",
        )

    monkeypatch.setattr(profile_module, "update_profile", _broken)
    status, body = patch_profile(client, {"displayName": "Doesn't matter"})
    assert status == 503
    assert body["error"]["code"] == "DATABASE_ERROR"
    dumped = json.dumps(body)
    assert "postgresql://" not in dumped
    assert "secret" not in dumped
    assert "OperationalError" not in dumped


# ---------------------------------------------------------------------------
# Cross-user isolation -- the core security property of this phase
# ---------------------------------------------------------------------------

def test_one_user_cannot_read_or_modify_another_users_profile():
    """Two separate clients (separate session cookies, exactly like two
    different browsers) -- user B's actions must never be visible to, or
    affect, user A's profile, and vice versa."""
    import app as flask_app_module

    client_a = flask_app_module.app.test_client()
    client_b = flask_app_module.app.test_client()

    user_a = register(client_a, username="user_alpha", email="alpha@example.com")
    user_b = register(client_b, username="user_beta", email="beta@example.com")
    assert user_a["id"] != user_b["id"]

    patch_profile(client_a, {"displayName": "Alpha Display"})
    patch_profile(client_b, {"displayName": "Beta Display"})

    profile_a = client_a.get("/api/profile").get_json()["data"]
    profile_b = client_b.get("/api/profile").get_json()["data"]

    assert profile_a["displayName"] == "Alpha Display"
    assert profile_a["username"] == "user_alpha"
    assert profile_b["displayName"] == "Beta Display"
    assert profile_b["username"] == "user_beta"

    # There is no request shape that lets client_a even name user_b's id
    # -- confirm the database itself agrees the two rows stayed separate.
    with appdb.get_connection() as conn:
        row_a = conn.execute(
            "SELECT display_name FROM profiles WHERE user_id = %s", [user_a["id"]],
        ).fetchone()
        row_b = conn.execute(
            "SELECT display_name FROM profiles WHERE user_id = %s", [user_b["id"]],
        ).fetchone()
    assert row_a[0] == "Alpha Display"
    assert row_b[0] == "Beta Display"


# ---------------------------------------------------------------------------
# Persistence across logout/login
# ---------------------------------------------------------------------------

def test_profile_persists_across_logout_and_login(client):
    register(client)
    patch_profile(client, {"displayName": "Persisted Name"})
    csrf_post(client, "/api/auth/logout")

    assert client.get("/api/profile").status_code == 401  # logged out now

    csrf_post(client, "/api/auth/login", {"login": "profile_owner", "password": "password123"})
    r = client.get("/api/profile")
    assert r.status_code == 200
    assert r.get_json()["data"]["displayName"] == "Persisted Name"


def test_me_reflects_profile_changes_immediately(client):
    """The property the frontend's AuthContext relies on: /api/auth/me
    (not just /api/profile) shows an update made through PATCH, with no
    separate 'profile state' to fall out of sync."""
    register(client)
    patch_profile(client, {"displayName": "Shows Up In Me Too"})
    r = client.get("/api/auth/me")
    assert r.get_json()["data"]["user"]["displayName"] == "Shows Up In Me Too"

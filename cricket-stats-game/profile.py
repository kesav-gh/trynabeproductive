"""
profile.py

Validation and database operations for Phase 4.3's profile endpoints.
profile_api.py (the Flask/HTTP layer) calls into this; like auth.py,
this module never imports flask and never touches a request or response.

Reuses the `profiles` table Phase 4.1 already created -- one row per
user, created alongside the user itself in auth.create_user(). Nothing
here creates a second profile table, and profile data is never stored
anywhere else. Username and email are NOT handled here at all: this
phase keeps username as the fixed account identifier (see AUTH.md /
PROFILE.md), and email changes are explicitly out of scope until a
dedicated verified-email workflow exists.
"""

import re

DISPLAY_NAME_MIN = 1
DISPLAY_NAME_MAX = 40
# A free-text label, not an identifier -- more permissive than the
# username pattern in auth.py. The only real rule is "no line breaks or
# tabs", so a display name can't break the single-line UI it renders in.
DISPLAY_NAME_RE = re.compile(r"^[^\r\n\t]+$")

# Loose but real format check: http(s) scheme, then something after it.
# Not a fetch -- confirming the URL actually resolves to an image is a
# different (and heavier) kind of validation, out of scope here.
AVATAR_URL_RE = re.compile(r"^https?://\S+$")
AVATAR_URL_MAX = 500

ALLOWED_UPDATE_FIELDS = {"displayName", "avatarUrl"}


class ValidationError(Exception):
    """A specific, user-facing problem with a profile update -- carries a
    `field` name so the frontend can attach the message to the right
    input rather than a generic banner."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field = field
        self.message = message


def get_profile(conn, user_id):
    row = conn.execute(
        "SELECT display_name, avatar_url FROM profiles WHERE user_id = %s", [user_id],
    ).fetchone()
    if row is None:
        return None
    return {"displayName": row[0], "avatarUrl": row[1]}


def ensure_profile(conn, user_id, fallback_display_name):
    """Every account gets a profile row at registration (see
    auth.create_user) -- this exists only as a safety net for the case
    that row is somehow missing later (a manually edited database, a
    future migration gap), so reading a profile never has to fail just
    because that invariant didn't hold. Safe to call whether or not a
    row already exists."""
    existing = get_profile(conn, user_id)
    if existing is not None:
        return existing
    conn.execute(
        "INSERT INTO profiles (user_id, display_name) VALUES (%s, %s) ON CONFLICT (user_id) DO NOTHING",
        [user_id, fallback_display_name],
    )
    conn.commit()
    return get_profile(conn, user_id)


def validate_display_name(value):
    if not isinstance(value, str):
        raise ValidationError("displayName", "Display name must be text.")
    value = value.strip()
    if len(value) < DISPLAY_NAME_MIN:
        raise ValidationError("displayName", "Display name can't be empty.")
    if len(value) > DISPLAY_NAME_MAX:
        raise ValidationError("displayName", f"Display name must be at most {DISPLAY_NAME_MAX} characters.")
    if not DISPLAY_NAME_RE.match(value):
        raise ValidationError("displayName", "Display name can't contain line breaks or tabs.")
    return value


def validate_avatar_url(value):
    """None, or an empty/whitespace-only string, both mean "clear the
    avatar" -- a real URL is the only thing that gets stored as-is."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError("avatarUrl", "Avatar URL must be text.")
    value = value.strip()
    if not value:
        return None
    if len(value) > AVATAR_URL_MAX:
        raise ValidationError("avatarUrl", f"Avatar URL must be at most {AVATAR_URL_MAX} characters.")
    if not AVATAR_URL_RE.match(value):
        raise ValidationError("avatarUrl", "Avatar URL must be a valid http:// or https:// URL.")
    return value


def update_profile(conn, user_id, updates, fallback_display_name):
    """
    `updates` is a dict of already-validated {displayName?, avatarUrl?} --
    only the keys actually present get written, so omitting a field
    leaves it unchanged (the request only needs to send what's changing).

    Column names in the UPDATE come only from a fixed, hardcoded mapping
    below -- never from a client-supplied key -- so this stays a safe,
    parameterized query no matter what a request's JSON body happens to
    contain; profile_api.py additionally rejects any field outside
    ALLOWED_UPDATE_FIELDS before this is ever called.

    Self-heals a missing profile row (see ensure_profile) rather than
    silently updating zero rows.
    """
    if get_profile(conn, user_id) is None:
        conn.execute(
            "INSERT INTO profiles (user_id, display_name, avatar_url) VALUES (%s, %s, %s) "
            "ON CONFLICT (user_id) DO NOTHING",
            [user_id, updates.get("displayName", fallback_display_name), updates.get("avatarUrl")],
        )
        conn.commit()

    column_map = {"displayName": "display_name", "avatarUrl": "avatar_url"}
    set_clauses = [f"{column_map[key]} = %s" for key in updates]
    if set_clauses:
        params = [updates[key] for key in updates] + [user_id]
        set_clauses.append("updated_at = now()")
        conn.execute(
            f"UPDATE profiles SET {', '.join(set_clauses)} WHERE user_id = %s",
            params,
        )
        conn.commit()

    return get_profile(conn, user_id)

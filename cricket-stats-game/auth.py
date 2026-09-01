"""
auth.py

Registration, login and identity logic for Phase 4.2: password hashing,
input validation, and the database operations behind
POST /api/auth/register, POST /api/auth/login and GET /api/auth/me.
auth_api.py (the Flask/HTTP layer) calls into this; this module never
imports flask and never touches a request or response object, the same
separation game_state.py, scoring.py and difficulty.py already keep
from api.py.

Passwords are hashed with Werkzeug's generate_password_hash /
check_password_hash -- scrypt by default in the Werkzeug version this
project pins (see requirements.txt), a memory-hard KDF built
specifically for password storage, already a transitive dependency of
Flask itself. Nothing here implements its own hashing or its own
comparison -- that would be exactly the mistake modern password-storage
guidance exists to prevent. check_password_hash does a
constant-time comparison internally, so this module never needs to
reach for one itself.

Every duplicate-email/duplicate-username case is handled at the
DATABASE level (catching a UNIQUE violation on insert), not just by a
pre-check query -- a pre-check alone has a race: two requests for the
same email arriving close together could both pass the check and both
attempt the insert. Only one still succeeds, because the constraint
itself is what's authoritative.
"""

import re

import psycopg
from werkzeug.security import check_password_hash, generate_password_hash

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128


class ValidationError(Exception):
    """A specific, user-facing problem with registration or login input --
    "that username is taken", "password too short". Carries a `field`
    name so the frontend can attach the message to the right input
    instead of a generic banner."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field = field
        self.message = message


def normalize_email(email):
    return email.strip().lower()


def validate_registration(email, username, password, confirm_password):
    """Raises ValidationError on the first problem found and stops there
    -- registration re-validates from scratch on every submit anyway, so
    there's no benefit to collecting every error at once, only more
    complexity. Returns (normalized_email, username) on success.

    Password rules are deliberately just a length check (8-128 chars),
    not a composition rule (must contain a digit/symbol/uppercase/...).
    That is current guidance, not a shortcut: composition rules push
    people toward predictable substitutions ("password" -> "Passw0rd!")
    that are easier, not harder, to guess, while contributing nothing
    real users' password managers weren't already going to do anyway.
    """
    email = normalize_email(email)
    username = (username or "").strip()

    if not EMAIL_RE.match(email):
        raise ValidationError("email", "Enter a valid email address.")

    if not USERNAME_RE.match(username):
        raise ValidationError(
            "username",
            "Username must be 3-20 characters: letters, numbers and underscores only.",
        )

    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        raise ValidationError(
            "password", f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
        )
    if len(password) > MAX_PASSWORD_LENGTH:
        raise ValidationError(
            "password", f"Password must be at most {MAX_PASSWORD_LENGTH} characters.",
        )

    if password != confirm_password:
        raise ValidationError("confirmPassword", "Passwords don't match.")

    return email, username


def hash_password(password):
    return generate_password_hash(password)


def verify_password(password_hash, password):
    return check_password_hash(password_hash, password)


# ---------------------------------------------------------------------------
# Database operations. Each takes an open connection rather than opening
# its own -- callers are already inside a `with appdb.get_connection()`
# block, since they also need to catch appdb.ConfigError around it.
# ---------------------------------------------------------------------------

def create_user(conn, email, username, password):
    """
    Creates the user AND their profile row as one transaction -- the
    Phase 4.1 schema requires a profile to exist (display_name is
    NOT NULL with no default), so an account is never left in a
    half-created state where the row exists but has no profile.
    display_name starts as the username; no customization beyond that
    is in scope for this phase.

    Raises ValidationError("email", ...) or ValidationError("username", ...)
    on a duplicate, detected from which unique index Postgres reports as
    violated -- never from a pre-check alone (see module docstring).

    Returns the new user's public record: id, email, username, created_at.
    """
    password_hash = hash_password(password)
    try:
        row = conn.execute(
            """
            INSERT INTO users (email, username, password_hash)
            VALUES (%s, %s, %s)
            RETURNING id, email, username, created_at
            """,
            [email, username, password_hash],
        ).fetchone()
        conn.execute(
            "INSERT INTO profiles (user_id, display_name) VALUES (%s, %s)",
            [row[0], username],
        )
        conn.commit()
    except psycopg.errors.UniqueViolation as e:
        conn.rollback()
        constraint = (getattr(e.diag, "constraint_name", None) or "").lower()
        if "email" in constraint:
            raise ValidationError("email", "An account with this email already exists.") from e
        if "username" in constraint:
            raise ValidationError("username", "That username is already taken.") from e
        # Constraint name didn't match either pattern (a schema change
        # elsewhere, perhaps) -- still a genuine duplicate, just report
        # it against the field most registration forms show first.
        raise ValidationError("email", "An account with these details already exists.") from e

    return {
        "id": row[0],
        "email": row[1],
        "username": row[2],
        "createdAt": row[3].isoformat(),
    }


def find_user_by_login(conn, login):
    """`login` is whatever the user typed into the single sign-in field --
    their email or their username, either works. Returns the full row
    (password_hash included, for verify_password) or None if nothing
    matches either column. Comparison is case-insensitive on both sides,
    matching the unique indexes from migration 0002."""
    login = (login or "").strip()
    row = conn.execute(
        """
        SELECT id, email, username, password_hash, created_at, is_active
        FROM users
        WHERE lower(email) = lower(%s) OR lower(username) = lower(%s)
        """,
        [login, login],
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "email": row[1],
        "username": row[2],
        "passwordHash": row[3],
        "createdAt": row[4],
        "isActive": row[5],
    }


def get_user_by_id(conn, user_id):
    row = conn.execute(
        "SELECT id, email, username, created_at, is_active FROM users WHERE id = %s",
        [user_id],
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "email": row[1],
        "username": row[2],
        "createdAt": row[3].isoformat(),
        "isActive": row[4],
    }

# Authentication (Phase 4.2)

Optional accounts, layered on top of the Phase 4.1 PostgreSQL
foundation. **Guest play is unaffected and unchanged** — nothing here
is required to play a game; every existing screen and endpoint works
exactly as it did before this phase, whether or not anyone is signed in.

Read [DATABASE.md](DATABASE.md) first if you haven't set up PostgreSQL
yet — this phase builds directly on its `users` and `profiles` tables
and its `appdb.py` connection helper.

## Architecture

Four new backend modules, kept as separate, single-purpose files the
same way `game_state.py`, `scoring.py` and `difficulty.py` already are:

| File | Responsibility |
|---|---|
| `auth.py` | Password hashing, input validation, the actual database reads/writes. No Flask imports — it never touches a request or response. |
| `auth_api.py` | The Flask blueprint: `/api/auth/register`, `/login`, `/logout`, `/me`. Calls into `auth.py`; never queries the database directly itself. |
| `csrf.py` | The double-submit-cookie CSRF check (see below). |
| `ratelimit.py` | The in-memory per-IP rate limiter (see below). |

`extensions.py` gained the session/cookie configuration this all needs:
a secret key that's never a fixed string in source, and explicit
cookie security settings.

## Password hashing

**Werkzeug's `generate_password_hash` / `check_password_hash`** — a
transitive Flask dependency already, pinned explicitly in
`requirements.txt` because Phase 4.2 deliberately relies on its
behaviour. It hashes with **scrypt** by default (Werkzeug 2.3+), a
memory-hard key-derivation function built specifically for password
storage, and does a constant-time comparison internally. Nothing in
this codebase implements its own hashing or its own comparison — that
would be exactly the mistake modern password-storage guidance exists to
prevent.

Password rules are a length check only (8–128 characters), not a
composition rule. That's current guidance (NIST 800-63B), not a
shortcut: forcing "one digit, one symbol, one uppercase" pushes people
toward predictable substitutions that are easier, not harder, to guess.

## Sessions

Reuses the exact mechanism the game already relies on — Flask's signed,
client-side session cookie — under its own key (`auth_user_id`), kept
completely separate from the game's own `api_game` key. **Logging in or
out never touches an in-progress guest game**; the two are independent
by construction, not by a special case anywhere. This is tested
directly (`test_logout_does_not_clear_an_in_progress_guest_game`) and
verified live in a browser: registering mid-game, then refreshing, then
logging out, all left the guest game's state untouched throughout.

Session cookie configuration (`extensions.py`):

- `HttpOnly` — always on; never readable from JavaScript.
- `SameSite=Lax` — sent on same-site navigation and fetches, not
  cross-site ones.
- `Secure` — off by default (a `Secure` cookie is silently dropped by
  the browser over plain HTTP, which is all local dev uses). Set
  `SESSION_COOKIE_SECURE=true` in any real HTTPS deployment.
- Lifetime — 7 days (`PERMANENT_SESSION_LIFETIME`), applied once
  `session.permanent = True` is set on a successful login/register.

**The secret key is never hardcoded.** It previously was (a fixed
string committed to source — anyone who read the repo could forge a
session). Now: `FLASK_SECRET_KEY` from the environment if set;
otherwise a key is generated once and persisted to a gitignored
`.flask_secret_key` file next to `extensions.py`; either way it never
appears in source. The file-based fallback exists specifically so
Flask's debug-mode auto-reloader (which restarts the whole process on
every file save) doesn't invalidate every session, the game's included,
on each hot reload during local development.

## CSRF protection

A **double-submit cookie**: any response sets a `csrf_token` cookie (a
random value, readable by JavaScript on purpose) if the request didn't
already carry one. `POST /api/auth/register`, `/login` and `/logout`
then each require that same value to also arrive as an `X-CSRF-Token`
header. A cross-site page can make a victim's browser *send* the
`csrf_token` cookie automatically — that's the exploit CSRF relies on —
but it cannot *read* that cookie's value, since browsers enforce
same-origin for cookie access from JavaScript, and so it cannot
construct a matching header. That gap is the entire defense — it's the
same mechanism Django and Rails both use for a JSON-API-driven
frontend, not a homegrown substitute.

The frontend's fetch wrapper (`frontend/src/lib/authApi.ts`, via
`lib/csrf.ts`) reads the cookie itself and attaches the header on every
mutating auth request. In practice the cookie always already exists by
the time a form is submitted, since `GET /api/auth/me` — called once on
every app load — sets it as a side effect.

**Scope**: only the three auth POST endpoints are protected this phase,
matching what Phase 4.2 actually adds — routes that change which
account a session is signed in as. The existing game endpoints
(`POST /api/game/...`) are unauthenticated, session-only game state with
no account behind them yet; extending the same `@csrf.protect` decorator
to them is a reasonable near-term follow-up once a logged-in user's
session backs something worth forging a request against, but wasn't in
scope here.

## Rate limiting

A small, **in-memory, per-process** limiter (`ratelimit.py`): a fixed
window of attempts per client IP, held in a plain dict guarded by a
lock. Login: 10 attempts / 60 seconds. Registration: 5 attempts / 5
minutes. No Redis, no new infrastructure — appropriate for the single
local Flask process this runs as today.

**Real limitations, worth knowing before this goes anywhere near a real
deployment:**
- Resets completely on every process restart.
- Doesn't share state across multiple worker processes — behind a
  multi-process WSGI server, each worker enforces its own separate
  counter, so the effective limit multiplies by worker count.
- Keyed by `request.remote_addr`, which is only meaningful if requests
  reach this process directly. Behind a reverse proxy that doesn't
  forward the real client IP, every request looks like it comes from
  the proxy, and one legitimate user behind it could exhaust the limit
  for everyone else behind the same proxy.
- An attacker who can vary their source IP (a botnet, many VPNs, most
  residential proxy services) is barely slowed by a per-IP limit alone.

Good enough to stop a careless script hammering one endpoint from one
machine. Not a substitute for a real distributed rate limiter before
this is exposed to the internet.

## Enumeration and generic errors

- **Login** returns one identical error — status 401, code
  `INVALID_CREDENTIALS`, message "Incorrect email/username or
  password." — for a wrong password, an unknown account, and a
  deactivated one alike. Tested directly
  (`test_login_wrong_password_and_unknown_account_are_indistinguishable`
  asserts the response bodies are byte-identical).
- **Registration** *does* say which field collided ("that username is
  already taken", "an account with this email already exists"). This
  is a deliberate, different trade-off from login: a signup form needs
  to tell someone their chosen email/username is taken so they can fix
  it, the same way GitHub, Google and most real signup flows do — full
  anti-enumeration on registration would make the form nearly unusable.
  Login has no equivalent need to reveal that, so it doesn't.
- Duplicate detection happens at the **database** level (catching a
  `UniqueViolation`), not only a pre-check query — a pre-check alone
  has a race where two near-simultaneous signups for the same email
  could both pass the check; only the database's own constraint is
  authoritative.

## API endpoints

| Endpoint | Method | Auth required | Notes |
|---|---|---|---|
| `/api/auth/register` | POST | No | Creates the user + profile row in one transaction; logs the new account in |
| `/api/auth/login` | POST | No | `login` field accepts email or username, case-insensitively |
| `/api/auth/logout` | POST | No (no-op if already logged out) | Clears only `auth_user_id`; never touches `api_game` |
| `/api/auth/me` | GET | No | Always 200 — `{authenticated: false, user: null}` when signed out |

All four return the same envelope shape the game API already uses:
`{"data": ...}` on success, `{"error": {"code", "message"}}` otherwise.
`_public_user()` in `auth_api.py` is the **only** place a user record is
ever serialised for a response — four fields (`id`, `email`, `username`,
`createdAt`), never `password_hash`, never `is_active`, never anything
added to the table later without that function being revisited.

## Environment variables

Add to `cricket-stats-game/.env` (see `.env.example`):

```bash
FLASK_SECRET_KEY=<generate with: py -c "import secrets; print(secrets.token_hex(32))">
SESSION_COOKIE_SECURE=false   # true only behind real HTTPS
```

`.flask_secret_key` (the auto-generated fallback) and `.env` itself are
both gitignored — neither should ever be committed.

## Running it locally

Same commands as before this phase — nothing new to start:

```bash
cd cricket-stats-game
py app.py            # Flask, :5000
```
```bash
cd frontend
npm run dev           # Vite, :5173
```

Open **http://localhost:5173**. "Log in" / "Sign up" now appear in the
nav; guest play needs neither.

## Running the tests

```bash
cd cricket-stats-game
py -m pytest tests/test_auth.py -v
```

Every test in this file needs a real, reachable PostgreSQL and skips
itself (doesn't fail) when one isn't configured — matching
`test_appdb.py`'s pattern. An autouse fixture clears the `users` table
and the rate limiter's counters before and after every test, so tests
never collide with each other's accounts or attempt counts.

```bash
py -m pytest tests/    # the full suite, 93 tests as of this phase
```

## Security considerations (and what this deliberately does not claim)

This is a local, single-process development setup. Specifically **not**
covered, and not claimed to be:
- Email verification — an account is usable immediately on registration,
  with no confirmation step.
- Password reset / "forgot password" — doesn't exist yet.
- Account lockout after repeated failed logins (only a time-boxed rate
  limit, which resets).
- Any protection against an attacker who controls many source IPs (see
  Rate limiting, above).
- HTTPS itself — that's the deploying environment's job; this phase
  only makes sure cookie flags respect it correctly when it's there
  (`SESSION_COOKIE_SECURE`).

What *is* covered, and tested: passwords are never stored or returned
in plaintext or in any recoverable form; login can't be used to
enumerate accounts; CSRF is blocked on every state-changing auth
request; database errors never leak a connection string, a stack trace,
or which internal exception was raised; and the secret key is never a
fixed value in source.

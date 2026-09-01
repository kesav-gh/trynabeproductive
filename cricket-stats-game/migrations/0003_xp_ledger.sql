-- 0003_xp_ledger.sql
--
-- Phase 4.5: a permanent, auditable ledger of every XP award a signed-in
-- user's account has ever received. profiles.xp and profiles.level
-- already exist (0001_initial_schema.sql) -- this migration doesn't
-- recreate them, only makes xp the column this phase actually keeps
-- authoritative, and adds a floor so it can never go negative.
--
-- Guests never appear in this table. Nothing here enforces that at the
-- schema level (there is no "is this a guest" concept for a user_id
-- column that's NOT NULL by definition) -- it's enforced in
-- game_persistence.complete_game(), which only ever calls into
-- xp_service.py for the one seat (if any) that has a real user_id in
-- the first place. A guest's game_player_id never does.

CREATE TABLE xp_transactions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Nullable, ON DELETE SET NULL rather than CASCADE: if a game row
    -- is ever deleted, the XP a player earned actually playing it is
    -- not retroactively un-awarded -- only the traceability back to
    -- which specific game earned it is lost.
    game_id     BIGINT REFERENCES games(id) ON DELETE SET NULL,
    amount      INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The core idempotency guarantee this phase's "duplicate completion
-- must not duplicate XP" requirement rests on: at most one row per
-- (user, game, reason). A retried "complete this game" request can
-- insert GAME_COMPLETED, FIRST_PLACE, EXACT_TARGET, etc. at most once
-- each for the same game, no matter how many times the completion code
-- path runs (see xp_service.award_game_xp()'s ON CONFLICT DO NOTHING).
-- Rows with a NULL game_id (a future non-game XP source) are exempt
-- from this uniqueness -- Postgres already treats every NULL as
-- distinct from every other NULL in a unique index, which is exactly
-- the "not a one-time-per-game reward" behaviour that case would want.
CREATE UNIQUE INDEX xp_transactions_user_game_reason_idx
    ON xp_transactions (user_id, game_id, reason);

CREATE INDEX idx_xp_transactions_user_id ON xp_transactions(user_id);
CREATE INDEX idx_xp_transactions_game_id ON xp_transactions(game_id);

-- A database-level backstop for "do not allow negative total XP",
-- alongside xp_service.py's own GREATEST(0, ...) clamp on every write --
-- belt and suspenders, so this invariant holds even against a write
-- that didn't go through xp_service.py at all.
ALTER TABLE profiles ADD CONSTRAINT profiles_xp_non_negative CHECK (xp >= 0);

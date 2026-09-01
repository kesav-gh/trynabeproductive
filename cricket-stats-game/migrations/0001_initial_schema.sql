-- 0001_initial_schema.sql
--
-- Phase 4.1: the persistent application database foundation.
--
-- This is a SEPARATE database from data/cricket.duckdb. Nothing in here
-- duplicates the cricket statistics dataset -- picks.cricket_player_id
-- is a plain reference column holding a DuckDB players.player_id value,
-- not a foreign key (it cannot be one: the two live in different
-- database engines entirely). question_gen.py, name_match.py and the
-- DuckDB file itself are completely untouched by this migration.
--
-- Nothing in the existing game flow writes to these tables yet -- that
-- is later work. This migration only creates the shape.

CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
    user_id         BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name    TEXT NOT NULL,
    avatar_url      TEXT,
    xp              BIGINT NOT NULL DEFAULT 0,
    level           INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- game_mode and difficulty are free-form text rather than a Postgres ENUM
-- on purpose: they mirror game_state.py's own string values (which are
-- plain strings, not a fixed enum in Python either), and a CHECK
-- constraint is far cheaper to extend later than an ENUM type is.
CREATE TABLE games (
    id              BIGSERIAL PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'finished', 'abandoned')),
    game_mode       TEXT NOT NULL DEFAULT 'classic',
    difficulty      TEXT NOT NULL DEFAULT 'normal'
                        CHECK (difficulty IN ('easy', 'normal', 'hard', 'insane')),
    rounds_total    INTEGER,  -- NULL = unlimited, matching game_state.py's rounds_total
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ
);

-- One row per seat at the table for a game, whether or not that seat
-- belongs to a signed-in user -- guest play (today's only mode) stays
-- fully supported once games ARE persisted, by leaving user_id null.
CREATE TABLE game_players (
    id              BIGSERIAL PRIMARY KEY,
    game_id         BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    guest_name      TEXT,
    player_order    INTEGER NOT NULL,
    final_score     INTEGER,
    placement       INTEGER,
    CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL),
    UNIQUE (game_id, player_order)
);

-- question is stored as the exact dict generate_target() returns
-- (question_text, stat, format, country, role_bucket, num_players,
-- target) -- JSONB rather than separate columns, since it is a single
-- opaque record this schema only ever needs to store and redisplay, not
-- query into.
CREATE TABLE rounds (
    id              BIGSERIAL PRIMARY KEY,
    game_id         BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    round_number    INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'complete')),
    question        JSONB NOT NULL,
    target          INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    UNIQUE (game_id, round_number)
);

CREATE TABLE round_players (
    id                  BIGSERIAL PRIMARY KEY,
    round_id            BIGINT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    game_player_id      BIGINT NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
    score               INTEGER,
    difference          INTEGER,
    hints_used          INTEGER NOT NULL DEFAULT 0,
    duration_seconds    DOUBLE PRECISION,
    placement           INTEGER,
    UNIQUE (round_id, game_player_id)
);

-- cricket_player_id deliberately has no foreign key -- it references a
-- row in DuckDB's players table, which lives in a different database
-- engine entirely and cannot be the target of a Postgres constraint.
-- selected_name and stat_value are kept alongside it (denormalised) so a
-- round's history is still readable even if the DuckDB dataset is ever
-- rebuilt with different ids.
CREATE TABLE picks (
    id                  BIGSERIAL PRIMARY KEY,
    round_player_id     BIGINT NOT NULL REFERENCES round_players(id) ON DELETE CASCADE,
    cricket_player_id   TEXT,
    selected_name       TEXT NOT NULL,
    stat_value          INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE achievements (
    id              BIGSERIAL PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    xp_reward       INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_achievements (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id  BIGINT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, achievement_id)
);

CREATE TABLE user_stats (
    user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    games_played        INTEGER NOT NULL DEFAULT 0,
    games_won           INTEGER NOT NULL DEFAULT 0,
    questions_answered  INTEGER NOT NULL DEFAULT 0,
    exact_targets       INTEGER NOT NULL DEFAULT 0,
    hints_used          INTEGER NOT NULL DEFAULT 0,
    current_streak      INTEGER NOT NULL DEFAULT 0,
    longest_streak      INTEGER NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Postgres indexes every PRIMARY KEY and UNIQUE constraint automatically,
-- but not plain foreign key columns -- these back the join/lookup
-- patterns the tables above will actually be queried by (a game's
-- players, a game's rounds, a round's players, a player's picks, a
-- user's unlocked achievements).
CREATE INDEX idx_game_players_game_id ON game_players(game_id);
CREATE INDEX idx_game_players_user_id ON game_players(user_id);
CREATE INDEX idx_rounds_game_id ON rounds(game_id);
CREATE INDEX idx_round_players_round_id ON round_players(round_id);
CREATE INDEX idx_round_players_game_player_id ON round_players(game_player_id);
CREATE INDEX idx_picks_round_player_id ON picks(round_player_id);
CREATE INDEX idx_user_achievements_user_id ON user_achievements(user_id);

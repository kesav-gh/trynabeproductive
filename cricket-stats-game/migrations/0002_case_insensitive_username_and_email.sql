-- 0002_case_insensitive_username_and_email.sql
--
-- Phase 4.2: registration and login treat usernames and emails as
-- case-insensitive for uniqueness and lookup ("Kesav" and "kesav" can't
-- both be registered), while a username's original capitalization is
-- still preserved for display -- only email is normalized to lowercase
-- by application code before it's ever stored.
--
-- Additive only: the plain UNIQUE(email) and UNIQUE(username)
-- constraints from 0001 stay in place (harmless, now redundant given
-- the stricter expression indexes below) rather than being dropped and
-- recreated, keeping this migration a pure addition with nothing to
-- roll back if it needs reverting.

CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

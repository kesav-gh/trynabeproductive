"""
xp_service.py

Phase 4.5: turns a completed, authenticated game's ALREADY-PERSISTED,
server-computed results (via xp.py's pure calculation) into an actual
XP award -- the ledger write (xp_transactions) and the profile's
running total (profiles.xp/level) update together, in one transaction,
so the two can never drift apart. Like game_persistence.py, this module
never imports flask; it is called from INSIDE
game_persistence.complete_game() with the same open connection that
game's own completion already uses, so "game finished" and "XP awarded"
commit as one atomic unit -- there is no window where the database
holds one without the other.

Only ever invoked for the ONE seat (if any) tied to a real account --
see complete_game()'s own lookup. A guest's game_player_id has no
user_id, so this module is simply never called for one; "guests never
receive persistent XP" is enforced by the caller never reaching in
here, the exact same pattern game_persistence.py already uses for
"guest games are never persisted at all".

Idempotency: every ledger row inserted below is UNIQUE on
(user_id, game_id, reason) (migrations/0003_xp_ledger.sql). Even if
this were somehow invoked twice for the same game -- it isn't, in
practice: complete_game() only ever reaches this code on the ONE UPDATE
that actually flips a game from 'in_progress' to 'finished', which the
database guarantees happens at most once -- the second attempt's
inserts are silently no-ops (ON CONFLICT DO NOTHING), net_delta comes
out to 0, and the profile's XP is left completely untouched rather than
double-counted.
"""

import levels
import xp as xp_rules


def award_game_xp(conn, *, user_id, db_game_id, player_rounds, placement, timer_seconds):
    """
    player_rounds, placement, timer_seconds: see xp.calculate_game_xp --
    passed straight through, all of it already server-computed data with
    no path from any request body.

    Returns a dict describing what happened: xpAwarded (the NET amount
    actually newly credited -- 0 on a duplicate/retried call),
    oldXp, newXp, oldLevel, newLevel, leveledUp, and the raw
    per-component breakdown from xp.py (useful for a detailed result
    screen later, unused by the minimal one this phase ships).
    """
    # Row-level lock, taken FIRST, before any ledger write: serializes
    # this read-then-write against any other concurrent award for the
    # SAME user (there is no legitimate way for two to overlap given how
    # complete_game() only reaches here once per game, but this makes
    # "old xp" and "new xp" exact regardless), and -- just as
    # importantly -- means a missing profile row is caught and returned
    # on BEFORE inserting anything, so this function is a true, total
    # no-op rather than leaving an orphaned ledger row with nothing to
    # credit it against.
    old_row = conn.execute(
        "SELECT xp FROM profiles WHERE user_id = %s FOR UPDATE", [user_id],
    ).fetchone()
    if old_row is None:
        # No profile row at all -- shouldn't happen (every account gets
        # one at registration; see profile.ensure_profile).
        return None
    old_xp = old_row[0]
    old_level = levels.level_for_xp(old_xp)

    breakdown = xp_rules.calculate_game_xp(
        player_rounds=player_rounds, placement=placement, timer_seconds=timer_seconds,
    )

    # GAME_COMPLETED is unconditional; the rest are only worth a ledger
    # row when they actually happened -- a placement outside the podium,
    # a game with no exact hits, no fast rounds, or no hints used should
    # never leave a zero-amount row cluttering the ledger.
    entries = [("GAME_COMPLETED", breakdown["gameCompletedXp"])]
    if breakdown["placementReason"]:
        entries.append((breakdown["placementReason"], breakdown["placementBonus"]))
    if breakdown["exactTargetCount"] > 0:
        entries.append(("EXACT_TARGET", breakdown["exactTargetBonus"]))
    if breakdown["speedRoundCount"] > 0:
        entries.append(("SPEED_BONUS", breakdown["speedBonus"]))
    if breakdown["hintCount"] > 0:
        entries.append(("HINT_PENALTY", breakdown["hintPenalty"]))

    net_delta = 0
    for reason, amount in entries:
        row = conn.execute(
            """
            INSERT INTO xp_transactions (user_id, game_id, amount, reason)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (user_id, game_id, reason) DO NOTHING
            RETURNING amount
            """,
            [user_id, db_game_id, amount, reason],
        ).fetchone()
        if row is not None:
            net_delta += row[0]

    if net_delta == 0:
        # Every entry above hit ON CONFLICT -- a genuinely retried
        # completion for a game that's already been fully credited.
        # Nothing about the profile changes.
        return {
            "xpAwarded": 0, "oldXp": old_xp, "newXp": old_xp,
            "oldLevel": old_level, "newLevel": old_level, "leveledUp": False,
            "breakdown": breakdown,
        }

    new_xp = max(0, old_xp + net_delta)  # the database CHECK constraint backs this up too
    new_level = levels.level_for_xp(new_xp)
    conn.execute(
        "UPDATE profiles SET xp = %s, level = %s, updated_at = now() WHERE user_id = %s",
        [new_xp, new_level, user_id],
    )

    return {
        "xpAwarded": net_delta,
        "oldXp": old_xp,
        "newXp": new_xp,
        "oldLevel": old_level,
        "newLevel": new_level,
        "leveledUp": new_level > old_level,
        "breakdown": breakdown,
    }

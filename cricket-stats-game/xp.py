"""
xp.py

Central XP-earning rules for Phase 4.5 -- calculated ENTIRELY from
already-persisted, server-computed game data (game_state.py's
rounds_history, and the same server-computed placement
game_persistence.py's own complete_game() already derives), never from
anything a request body could set. Mirrors scoring.py's own separation:
this module is pure and stateless -- no Flask, no database -- the same
way scoring.py never touches a session or a connection; xp_service.py
is what actually turns a calculation from here into a persisted award.

XP is a SEPARATE currency from a round's in-game score (scoring.py) --
a huge in-game score doesn't automatically mean huge XP. This module
rewards a specific, narrow set of events (finishing a game at all,
placing well, hitting a target exactly, being fast, using hints) at the
flat amounts configured below, so retuning one system never silently
changes the other.

Every number below is a single named constant specifically so
balancing this system later means editing constants here, not hunting
through xp_service.py's orchestration logic (or worse, api.py's route
handlers) for a magic number buried in an expression.
"""

GAME_COMPLETION_XP = 50

# Awarded once, for the player's own FINAL placement in the game overall
# (game_persistence.py's own cumulative-score ranking) -- never per
# round, and never for a placement outside the podium.
PLACEMENT_XP = {
    1: 200,
    2: 100,
    3: 50,
}

# Both of the following are PER ROUND that qualified, then summed across
# the whole game into one ledger entry (see xp_service.py) -- a 5-round
# game with 3 exact hits earns 3x this, not a flat one-time bonus.
EXACT_TARGET_BONUS_PER_ROUND = 75
SPEED_BONUS_PER_ROUND = 25

# A round counts as "fast" once it finished with more than this fraction
# of its timer still remaining -- the same "time to spare" condition
# scoring.py's own speed_bonus_for() rewards on a continuous 0..200
# scale; this is a flat, discrete version of the same idea for XP.
# Untimed (Casual) rounds can never qualify, matching scoring.py.
FAST_ROUND_TIME_REMAINING_FRACTION = 0.5

# Applied PER HINT used, across the whole game, as a straight deduction
# -- always <= 0. Heavy hint use CAN make one game's raw total negative
# (see calculate_game_xp) -- it's the player's ACCOUNT total that's
# floored at zero, not any single game in isolation (xp_service.py,
# backed by a database CHECK constraint), so a hint-heavy loss can cost
# XP already banked from earlier games, but never push the running
# total negative.
HINT_PENALTY_PER_HINT = -10


def placement_reason(placement):
    """The xp_transactions.reason this placement earns, or None for
    4th place and beyond (which still earns GAME_COMPLETED, just no
    placement-specific bonus)."""
    return {1: "FIRST_PLACE", 2: "SECOND_PLACE", 3: "THIRD_PLACE"}.get(placement)


def calculate_game_xp(*, player_rounds, placement, timer_seconds):
    """
    player_rounds: THIS player's own per-round results only -- a list of
    {"difference": int, "hintsUsed": int, "duration_seconds": float | None},
    one entry per round they actually played, drawn straight from
    game_state.py's rounds_history (see game_persistence.complete_game()
    for how that's extracted). Every field here is something scoring.py
    or game_state.py already computed server-side; nothing in this
    function's input could have been supplied by a request body.

    placement: this player's final 1-based placement in the just-
    finished game, from game_persistence.py's own cumulative-score
    ranking -- never anything else.

    timer_seconds: this game's configured turn limit, or None/0 for
    Casual mode, exactly like scoring.py's own speed_bonus_for() takes.

    Returns a breakdown dict -- every component named separately so
    xp_service.py can turn each into its own ledger reason (each stored
    at its true, un-floored magnitude, for an honest, auditable ledger),
    and `total`, this game's raw net sum. `total` genuinely CAN be
    negative on an extreme heavy-hint run -- nothing here floors it, on
    purpose: "don't allow negative total XP" is a promise about the
    ACCOUNT's cumulative total, not about any one game in isolation, and
    the account-level floor is xp_service.py's job (backed by a
    database CHECK constraint), not this pure function's.
    """
    exact_target_count = sum(1 for r in player_rounds if r["difference"] == 0)
    hint_count = sum(r["hintsUsed"] for r in player_rounds)

    speed_round_count = 0
    if timer_seconds:
        threshold = timer_seconds * FAST_ROUND_TIME_REMAINING_FRACTION
        for r in player_rounds:
            duration = r.get("duration_seconds")
            if duration is not None and duration <= threshold:
                speed_round_count += 1

    game_completed_xp = GAME_COMPLETION_XP
    placement_bonus = PLACEMENT_XP.get(placement, 0)
    exact_target_bonus = exact_target_count * EXACT_TARGET_BONUS_PER_ROUND
    speed_bonus = speed_round_count * SPEED_BONUS_PER_ROUND
    hint_penalty = hint_count * HINT_PENALTY_PER_HINT  # <= 0

    total = game_completed_xp + placement_bonus + exact_target_bonus + speed_bonus + hint_penalty

    return {
        "gameCompletedXp": game_completed_xp,
        "placementBonus": placement_bonus,
        "placementReason": placement_reason(placement),
        "exactTargetBonus": exact_target_bonus,
        "exactTargetCount": exact_target_count,
        "speedBonus": speed_bonus,
        "speedRoundCount": speed_round_count,
        "hintPenalty": hint_penalty,
        "hintCount": hint_count,
        "total": total,
    }

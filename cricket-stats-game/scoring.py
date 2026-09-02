"""
scoring.py

A points score layered ON TOP OF the original "closest combined total
wins" mechanic. It never changes who wins a single round -- that is still
decided purely by whose total is closest to the target, exactly as
api.py's reveal() always computed it. What this adds is a number that
IS comparable across rounds (unlike a raw difference, which depends on
that round's target and is meaningless to add to a different round's
difference), so a multi-round game can track an overall leader.

Four components, always non-negative, summed:
  - closeness:     up to MAX_CLOSENESS points, scaled by how close the
                    total was to the target relative to the target's own
                    size (so being off by 10 matters a lot on a target of
                    20 and barely at all on a target of 5,000).
  - exact bonus:    a flat bonus for matching the target exactly.
  - speed bonus:    up to MAX_SPEED_BONUS points for finishing a *timed*
                    turn with time to spare. Always zero when the turn had
                    no timer (Casual mode) -- there is nothing to be fast
                    relative to.
  - hint penalty:   a flat deduction per hint used during the turn. The
                    total score is floored at zero, so hints can cost a
                    round's ranking but never produce a negative score.
"""

EXACT_BONUS = 500
MAX_SPEED_BONUS = 200
HINT_PENALTY = 75
MAX_CLOSENESS = 1000


def closeness_score(total, target):
    """0..MAX_CLOSENESS, scaled by relative (not absolute) distance from
    the target. A target of 0 is a degenerate edge case generate_target()
    should never actually produce, but is handled without dividing by zero."""
    if target == 0:
        return MAX_CLOSENESS if total == 0 else 0
    diff = abs(total - target)
    ratio = max(0.0, 1 - (diff / target))
    return round(ratio * MAX_CLOSENESS)


def speed_bonus_for(elapsed_seconds, timer_seconds):
    """0..MAX_SPEED_BONUS. Zero whenever there was no timer running, or no
    elapsed time was recorded (e.g. a Casual-mode turn)."""
    if not timer_seconds or elapsed_seconds is None:
        return 0
    remaining_ratio = max(0.0, (timer_seconds - elapsed_seconds) / timer_seconds)
    return round(remaining_ratio * MAX_SPEED_BONUS)


def score_turn(total, target, elapsed_seconds, timer_seconds, hints_used):
    """
    total, target:            the player's combined pick total and the
                               question's target -- exactly what decides
                               the round's actual winner elsewhere.
    elapsed_seconds:          time the player's LAST pick of the turn took
                               to arrive after the turn started, or None.
    timer_seconds:            this game's configured turn limit, or None
                               (Casual mode -- no speed bonus is possible).
    hints_used:                total hint count for this player this turn.

    Returns a breakdown dict; `total` is what gets added to a player's
    cumulative score for the game.
    """
    diff = abs(total - target)
    closeness = closeness_score(total, target)
    exact = EXACT_BONUS if diff == 0 else 0
    speed = speed_bonus_for(elapsed_seconds, timer_seconds)
    penalty = hints_used * HINT_PENALTY
    final = max(0, closeness + exact + speed - penalty)

    return {
        "closeness": closeness,
        "exactBonus": exact,
        "speedBonus": speed,
        "hintPenalty": penalty,
        "total": final,
    }

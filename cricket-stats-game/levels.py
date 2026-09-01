"""
levels.py

The single place level <-> XP conversion happens, so nothing else in
this codebase (profile_api.py, xp_service.py, the Profile page, a
future achievements phase) ever reimplements or hardcodes this curve --
every caller asks this module, never the other way around. Mirrors
difficulty.py's role for question generation: a small, pure,
Flask-free module the rest of the app treats as the one source of
truth for a single concept.

Progression curve: level N requires xp_required_for_level(N) total,
cumulative XP to REACH it (level 1 needs 0). This is a smooth
quadratic-ish ramp -- each level costs more than the last, scaled by a
constant growth factor -- rather than a hand-authored table, so the
curve never needs manually extending as players approach whatever the
current ceiling happens to be. LEVEL_BASE_XP and LEVEL_GROWTH below are
the only two numbers that would ever need retuning to change the whole
system's pacing; MAX_LEVEL is a hard ceiling past which XP still
accumulates (and is still shown) but no longer raises the level number.

The full table is computed once, at import time, into
_CUMULATIVE_XP_FOR_LEVEL -- every lookup afterwards is an exact,
consistent list index rather than re-deriving slightly different
floating-point results on every call.
"""

LEVEL_BASE_XP = 100      # cumulative XP required to reach level 2
LEVEL_GROWTH = 1.15      # each subsequent level costs this much more than the last
MAX_LEVEL = 100


def _build_cumulative_xp_table():
    table = {1: 0}
    total = 0
    step = float(LEVEL_BASE_XP)
    for level in range(2, MAX_LEVEL + 1):
        total += round(step)
        table[level] = total
        step *= LEVEL_GROWTH
    return table


_CUMULATIVE_XP_FOR_LEVEL = _build_cumulative_xp_table()


def xp_required_for_level(level):
    """Total cumulative XP needed to REACH `level`. Clamped to
    [1, MAX_LEVEL] -- there's no level 0, and nothing beyond MAX_LEVEL
    has a defined requirement (see progression_for_xp)."""
    level = max(1, min(level, MAX_LEVEL))
    return _CUMULATIVE_XP_FOR_LEVEL[level]


def level_for_xp(xp):
    """The highest level whose cumulative requirement `xp` meets or
    exceeds. Never returns above MAX_LEVEL no matter how large xp is,
    and never below 1 no matter how small (including negative, which
    should never happen -- see xp_service.py's own floor -- but this
    stays defined rather than raising either way)."""
    xp = max(0, xp)
    level = 1
    for lvl in range(2, MAX_LEVEL + 1):
        if xp >= _CUMULATIVE_XP_FOR_LEVEL[lvl]:
            level = lvl
        else:
            break
    return level


def progression_for_xp(xp):
    """The full picture GET /api/profile/progression needs: current
    level, how far into that level `xp` is, how much more is needed for
    the next one, and that as a percentage. At MAX_LEVEL, there is no
    "next" level -- xpToNextLevel is 0 and progress reads 100%, rather
    than dividing by a level width that doesn't exist."""
    xp = max(0, xp)
    level = level_for_xp(xp)
    current_floor = xp_required_for_level(level)

    if level >= MAX_LEVEL:
        return {
            "xp": xp,
            "level": level,
            "currentLevelXp": current_floor,
            "nextLevelXp": current_floor,
            "xpIntoLevel": xp - current_floor,
            "xpToNextLevel": 0,
            "progressPercent": 100.0,
        }

    next_floor = xp_required_for_level(level + 1)
    xp_into_level = xp - current_floor
    xp_for_this_level = next_floor - current_floor
    progress = (xp_into_level / xp_for_this_level * 100) if xp_for_this_level else 100.0

    return {
        "xp": xp,
        "level": level,
        "currentLevelXp": current_floor,
        "nextLevelXp": next_floor,
        "xpIntoLevel": xp_into_level,
        "xpToNextLevel": next_floor - xp,
        "progressPercent": round(progress, 1),
    }

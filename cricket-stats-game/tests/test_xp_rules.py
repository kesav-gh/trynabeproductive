"""
test_xp_rules.py

Pure, no-database unit tests for xp.py (the XP formula) and levels.py
(the level curve) -- both are Flask-free, DB-free modules by design
(see their own docstrings), so these tests always run, unlike the
Postgres-backed integration tests in test_xp_service.py.

Run with:  py -m pytest        (from inside cricket-stats-game/)
"""

import levels
import xp


# ---------------------------------------------------------------------------
# xp.calculate_game_xp
# ---------------------------------------------------------------------------

def test_game_completion_xp_always_awarded():
    result = xp.calculate_game_xp(player_rounds=[], placement=None, timer_seconds=None)
    assert result["gameCompletedXp"] == xp.GAME_COMPLETION_XP
    assert result["placementBonus"] == 0
    assert result["placementReason"] is None
    assert result["total"] == xp.GAME_COMPLETION_XP


def test_first_place_bonus():
    result = xp.calculate_game_xp(player_rounds=[], placement=1, timer_seconds=None)
    assert result["placementBonus"] == xp.PLACEMENT_XP[1]
    assert result["placementReason"] == "FIRST_PLACE"
    assert result["total"] == xp.GAME_COMPLETION_XP + xp.PLACEMENT_XP[1]


def test_second_place_bonus():
    result = xp.calculate_game_xp(player_rounds=[], placement=2, timer_seconds=None)
    assert result["placementBonus"] == xp.PLACEMENT_XP[2]
    assert result["placementReason"] == "SECOND_PLACE"


def test_third_place_bonus():
    result = xp.calculate_game_xp(player_rounds=[], placement=3, timer_seconds=None)
    assert result["placementBonus"] == xp.PLACEMENT_XP[3]
    assert result["placementReason"] == "THIRD_PLACE"


def test_placement_beyond_third_gets_no_placement_bonus():
    for placement in (4, 5, 8):
        result = xp.calculate_game_xp(player_rounds=[], placement=placement, timer_seconds=None)
        assert result["placementBonus"] == 0, placement
        assert result["placementReason"] is None, placement


def test_placement_of_none_gets_no_placement_bonus():
    """A defensive edge case -- placement should always be a real int in
    practice (game_persistence.py always ranks every seat), but a
    missing/unknown placement must never crash or accidentally grant a
    bonus."""
    result = xp.calculate_game_xp(player_rounds=[], placement=None, timer_seconds=None)
    assert result["placementBonus"] == 0
    assert result["placementReason"] is None


def test_exact_target_bonus_counts_only_zero_difference_rounds():
    rounds = [
        {"difference": 0, "hintsUsed": 0, "duration_seconds": None},
        {"difference": 5, "hintsUsed": 0, "duration_seconds": None},
        {"difference": 0, "hintsUsed": 0, "duration_seconds": None},
    ]
    result = xp.calculate_game_xp(player_rounds=rounds, placement=None, timer_seconds=None)
    assert result["exactTargetCount"] == 2
    assert result["exactTargetBonus"] == 2 * xp.EXACT_TARGET_BONUS_PER_ROUND


def test_no_exact_target_bonus_when_never_exact():
    rounds = [{"difference": 3, "hintsUsed": 0, "duration_seconds": None}]
    result = xp.calculate_game_xp(player_rounds=rounds, placement=None, timer_seconds=None)
    assert result["exactTargetCount"] == 0
    assert result["exactTargetBonus"] == 0


def test_speed_bonus_awarded_for_a_fast_round():
    # timer_seconds=30, threshold = 30 * 0.5 = 15 -- 10s is well within it.
    rounds = [{"difference": 5, "hintsUsed": 0, "duration_seconds": 10}]
    result = xp.calculate_game_xp(player_rounds=rounds, placement=None, timer_seconds=30)
    assert result["speedRoundCount"] == 1
    assert result["speedBonus"] == xp.SPEED_BONUS_PER_ROUND


def test_no_speed_bonus_for_a_slow_round():
    rounds = [{"difference": 5, "hintsUsed": 0, "duration_seconds": 25}]
    result = xp.calculate_game_xp(player_rounds=rounds, placement=None, timer_seconds=30)
    assert result["speedRoundCount"] == 0
    assert result["speedBonus"] == 0


def test_no_speed_bonus_without_a_timer():
    """Casual mode (timer_seconds falsy) can never earn a speed bonus,
    matching scoring.py's own speed_bonus_for() rule exactly."""
    rounds = [{"difference": 5, "hintsUsed": 0, "duration_seconds": 1}]
    for timer_seconds in (None, 0):
        result = xp.calculate_game_xp(player_rounds=rounds, placement=None, timer_seconds=timer_seconds)
        assert result["speedRoundCount"] == 0
        assert result["speedBonus"] == 0


def test_no_speed_bonus_when_duration_unknown():
    """A round with no recorded duration (e.g. the turn never had a
    timer running) never counts as fast, even in a timed game."""
    rounds = [{"difference": 5, "hintsUsed": 0, "duration_seconds": None}]
    result = xp.calculate_game_xp(player_rounds=rounds, placement=None, timer_seconds=30)
    assert result["speedRoundCount"] == 0


def test_hint_penalty_scales_with_hint_count():
    rounds = [
        {"difference": 5, "hintsUsed": 2, "duration_seconds": None},
        {"difference": 5, "hintsUsed": 1, "duration_seconds": None},
    ]
    result = xp.calculate_game_xp(player_rounds=rounds, placement=None, timer_seconds=None)
    assert result["hintCount"] == 3
    assert result["hintPenalty"] == 3 * xp.HINT_PENALTY_PER_HINT
    assert result["hintPenalty"] < 0


def test_no_hint_penalty_when_no_hints_used():
    rounds = [{"difference": 5, "hintsUsed": 0, "duration_seconds": None}]
    result = xp.calculate_game_xp(player_rounds=rounds, placement=None, timer_seconds=None)
    assert result["hintCount"] == 0
    assert result["hintPenalty"] == 0


def test_heavy_hint_penalty_can_make_a_single_games_total_negative():
    """Deliberately NOT floored per-game (see xp.py's module docstring) --
    only the ACCOUNT's cumulative total is protected from going negative
    (xp_service.py). A pure calculation with a large hint count can
    genuinely produce a negative `total`."""
    rounds = [{"difference": 5, "hintsUsed": 50, "duration_seconds": None}]
    result = xp.calculate_game_xp(player_rounds=rounds, placement=None, timer_seconds=None)
    assert result["total"] < 0


def test_full_breakdown_sums_to_total():
    rounds = [
        {"difference": 0, "hintsUsed": 1, "duration_seconds": 5},
        {"difference": 2, "hintsUsed": 0, "duration_seconds": 40},
    ]
    result = xp.calculate_game_xp(player_rounds=rounds, placement=1, timer_seconds=30)
    expected = (
        result["gameCompletedXp"] + result["placementBonus"]
        + result["exactTargetBonus"] + result["speedBonus"] + result["hintPenalty"]
    )
    assert result["total"] == expected


# ---------------------------------------------------------------------------
# levels.py
# ---------------------------------------------------------------------------

def test_level_one_requires_zero_xp():
    assert levels.xp_required_for_level(1) == 0
    assert levels.level_for_xp(0) == 1


def test_negative_xp_treated_as_zero():
    assert levels.level_for_xp(-500) == 1
    prog = levels.progression_for_xp(-500)
    assert prog["xp"] == 0
    assert prog["level"] == 1


def test_level_for_xp_at_exact_boundary():
    boundary = levels.xp_required_for_level(2)
    assert levels.level_for_xp(boundary) == 2
    assert levels.level_for_xp(boundary - 1) == 1


def test_level_for_xp_climbs_multiple_levels_at_once():
    """A huge XP grant (e.g. from a very large single-game award) can
    jump straight past several levels in one update, and level_for_xp
    must reflect the real, final level -- not increment by one."""
    boundary_5 = levels.xp_required_for_level(5)
    assert levels.level_for_xp(boundary_5) == 5


def test_progression_fields_are_internally_consistent():
    prog = levels.progression_for_xp(150)
    assert prog["xp"] == 150
    assert prog["xpIntoLevel"] == prog["xp"] - prog["currentLevelXp"]
    assert prog["xpToNextLevel"] == prog["nextLevelXp"] - prog["xp"]
    assert 0 <= prog["progressPercent"] <= 100


def test_progress_percent_is_zero_right_at_a_level_boundary():
    boundary = levels.xp_required_for_level(3)
    prog = levels.progression_for_xp(boundary)
    assert prog["level"] == 3
    assert prog["xpIntoLevel"] == 0
    assert prog["progressPercent"] == 0.0


def test_very_large_xp_caps_at_max_level():
    huge = levels.xp_required_for_level(levels.MAX_LEVEL) + 10_000_000
    prog = levels.progression_for_xp(huge)
    assert prog["level"] == levels.MAX_LEVEL
    assert prog["xpToNextLevel"] == 0
    assert prog["progressPercent"] == 100.0


def test_level_for_xp_never_exceeds_max_level():
    assert levels.level_for_xp(10 ** 12) == levels.MAX_LEVEL


def test_levels_are_monotonically_increasing_in_required_xp():
    """Every level must cost strictly more cumulative XP than the one
    before it -- a broken growth constant could otherwise flatten or
    reverse the curve without any single lookup looking wrong."""
    for level in range(1, levels.MAX_LEVEL):
        assert levels.xp_required_for_level(level) < levels.xp_required_for_level(level + 1)

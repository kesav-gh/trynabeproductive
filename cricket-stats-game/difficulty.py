"""
difficulty.py

Difficulty is implemented purely as a CHOICE OF ARGUMENTS to hand to
question_gen.generate_target() -- nothing in question_gen.py is touched,
and every fairness guardrail already in there (the blocked role/stat
combos, the per-format run floors, the auto-excluded top-of-pool slice)
applies exactly as it always has, whatever a question ends up asking for.

"normal" hands back every field as None, which is exactly what a call to
generate_target() with no extra arguments already did before this module
existed -- so a game that doesn't request a difficulty behaves identically
to Phase 2.

One rule this module has to enforce ITSELF, because generate_target()
can't: it only protects against a nonsensical (role, stat) pairing (a
Batter with five-fers, a Bowler with centuries) at the moment IT is the
one choosing the role. Pass an explicit role_bucket and that check is
skipped entirely -- the caller is trusted to have already made sense.
So whenever this module forces a role, it also restricts the stat choice
to one that role can actually produce. ROLE_COMPATIBLE_STATS below
mirrors question_gen.py's own BATTING_ROLES / BLOCKED_ROLE_STAT_COMBOS
logic; keep the two in sync if that logic ever changes.
"""

import random

from question_gen import COUNTRIES, generate_target

# Mirrors question_gen.py's BLOCKED_ROLE_STAT_COMBOS, inverted into "what
# IS allowed" for each role: batting-only roles can't take wickets or
# five-fers, and a Bowler can't score centuries.
ROLE_COMPATIBLE_STATS = {
    "Opening Batter": ["runs", "centuries"],
    "Batter": ["runs", "centuries"],
    "Wicketkeeper Batter": ["runs", "centuries"],
    "Bowler": ["runs", "wickets", "five_fers"],
    "Allrounder": ["runs", "wickets", "centuries", "five_fers"],
}

NICHE_ROLES = ["Wicketkeeper Batter", "Opening Batter", "Allrounder", "Bowler"]
RARE_STATS = {"centuries", "five_fers"}


def _stat_for_role(role, prefer_rare):
    options = ROLE_COMPATIBLE_STATS[role]
    if prefer_rare:
        rare = [s for s in options if s in RARE_STATS]
        if rare:
            return random.choice(rare)
    return random.choice(options)


def params_for(difficulty):
    """
    Returns {"stat", "format_", "country", "role_bucket"} biases for this
    difficulty tier -- any of which may be None. The caller (api.py) merges
    these UNDER an explicit mode config: a client that already asked for a
    specific stat/format/country/role (e.g. the "Wicket Hunt" game mode)
    keeps getting exactly that, unaffected by difficulty.
    """
    if difficulty == "easy":
        # Familiar formats, familiar stats, no role or country narrowing --
        # the widest, most forgiving pool of correct answers.
        return {
            "stat": random.choice(["runs", "wickets"]),
            "format_": random.choice(["ODI", "IT20"]),
            "country": None,
            "role_bucket": None,
        }

    if difficulty == "hard":
        role = random.choice(NICHE_ROLES)
        return {
            "stat": _stat_for_role(role, prefer_rare=True),
            "format_": random.choice(["Test", "ODI"]),
            "country": random.choice(COUNTRIES),
            "role_bucket": role,
        }

    if difficulty == "insane":
        # The two roles hardest to recall players for, Test cricket only
        # (the deepest back-catalogue, least recently played), a specific
        # country always required, and a bias toward the rarer milestone
        # stats wherever the role allows it.
        role = random.choice(["Wicketkeeper Batter", "Opening Batter"])
        return {
            "stat": _stat_for_role(role, prefer_rare=True),
            "format_": "Test",
            "country": random.choice(COUNTRIES),
            "role_bucket": role,
        }

    # "normal" (default): identical to pre-difficulty behaviour.
    return {"stat": None, "format_": None, "country": None, "role_bucket": None}


def generate_target_for_difficulty(con, num_players, difficulty, mode, outer_attempts=12):
    """
    Calls generate_target() repeatedly, drawing a FRESH difficulty-biased
    combo each attempt, until one succeeds or outer_attempts is exhausted.

    This matters: a single difficulty-biased combo (say, Insane's Test +
    Wicketkeeper Batter + centuries + Zimbabwe) can happen to be too
    narrow for num_players. Handing that one fixed combo to
    generate_target's own 25 internal retries is pointless -- every one
    of those retries would be identical and fail identically, since
    generate_target only re-randomises the arguments *it* was left to
    choose, not ones the caller pinned down. Rolling a new combo out here
    on each outer attempt is what actually gives the difficulty tier a
    real chance to succeed, the same way generate_target's own internal
    loop gives ITS random choices a chance to succeed.

    An explicit mode field (e.g. a game mode that pins stat="wickets")
    always wins over the difficulty's bias for that field.
    """
    for _ in range(outer_attempts):
        bias = params_for(difficulty)
        kwargs = {
            "num_players": num_players,
            "stat": mode.get("stat") if mode.get("stat") is not None else bias["stat"],
            "format_": mode.get("format") if mode.get("format") is not None else bias["format_"],
            "country": mode.get("country") if mode.get("country") is not None else bias["country"],
            "role_bucket": mode.get("role_bucket") if mode.get("role_bucket") is not None else bias["role_bucket"],
        }
        q = generate_target(con, **kwargs)
        if q is not None:
            return q
    return None

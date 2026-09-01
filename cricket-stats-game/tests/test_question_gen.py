"""
test_question_gen.py

Regression tests for the duplicate-player-name bug (Phase 3.5): the
database contains multiple distinct players sharing an identical name --
these are real, confirmed collisions in this specific dataset, not
synthetic fixtures, so a pass here means the fix holds against the
actual data the game runs on, not a stand-in for it.

    Rashid Khan:  5f547c8b Afghanistan / Bowling Allrounder
                  69cccff3 Nepal       / NA
                  3f811de0 Pakistan    / NA
    Junaid Khan:  086f5984 Pakistan    / Bowler
                  670e6804 (none)      / (none)
                  be0077ba Portugal    / NA

If either the ALLOWED_COUNTRIES set in name_match.py or the specific
rows in the dataset ever change, these ids may need updating -- that's
a feature, not a flaw: a failure here would mean the fixture assumption
itself moved, worth knowing either way.
"""

import question_gen
from conftest import get_player_ids_by_name


def test_resolve_player_is_deterministic_for_duplicate_names(app):
    con = app.con
    first = question_gen.resolve_player(con, "Rashid Khan")
    for _ in range(5):
        again = question_gen.resolve_player(con, "Rashid Khan")
        assert again == first, "resolve_player must not vary across repeated calls"


def test_resolve_player_picks_the_correct_duplicate_by_prominence(app):
    """The specific, real defect this phase fixes: resolve_player() used
    to do an unranked SQL fetchone() over duplicate names, and could
    return a player with no country/role at all even though a fully
    enriched, far more prominent player shares the exact same name."""
    con = app.con
    resolved = question_gen.resolve_player(con, "Rashid Khan")
    assert resolved[2] == "Afghanistan"
    assert resolved[3] == "Bowling Allrounder"

    resolved = question_gen.resolve_player(con, "Junaid Khan")
    assert resolved[2] == "Pakistan"
    assert resolved[3] == "Bowler"


def test_resolve_player_by_id_is_unambiguous(app):
    con = app.con
    ids = get_player_ids_by_name(con, "Rashid Khan")
    assert len(ids) >= 3, "fixture assumption moved -- expected 3+ Rashid Khans"

    for player_id, expected_country in ids.items():
        row = question_gen.resolve_player_by_id(con, player_id)
        assert row[0] == player_id
        assert row[2] == expected_country


def test_evaluate_guess_with_player_id_uses_the_selected_player(app):
    """The actual regression: given an explicit player_id, evaluate_guess
    must evaluate THAT specific player -- not whichever duplicate a
    name-only lookup happens to return. Checked both ways: the right
    duplicate is accepted, and a wrong one is correctly rejected, rather
    than silently accepted or silently swapped for a third player."""
    con = app.con
    ids = get_player_ids_by_name(con, "Rashid Khan")
    afghan_id = next(pid for pid, country in ids.items() if country == "Afghanistan")
    nepal_id = next(pid for pid, country in ids.items() if country == "Nepal")

    accepted = question_gen.evaluate_guess(
        con, "Rashid Khan", "wickets", "IPL",
        country="Afghanistan", role_bucket="Allrounder", player_id=afghan_id,
    )
    assert accepted["valid"] is True
    assert accepted["value"] > 0

    rejected = question_gen.evaluate_guess(
        con, "Rashid Khan", "wickets", "IPL",
        country="Afghanistan", role_bucket="Allrounder", player_id=nepal_id,
    )
    assert rejected["valid"] is False
    assert "Nepal" in rejected["reason"]
    assert "Afghanistan" in rejected["reason"]


def test_evaluate_guess_without_player_id_still_works_deterministically(app):
    """Backward-compatible fallback path: no id given at all still picks
    the correct (most prominent) duplicate, rather than an arbitrary one."""
    con = app.con
    result = question_gen.evaluate_guess(
        con, "Rashid Khan", "wickets", "IPL",
        country="Afghanistan", role_bucket="Allrounder",
    )
    assert result["valid"] is True
    assert result["value"] > 0

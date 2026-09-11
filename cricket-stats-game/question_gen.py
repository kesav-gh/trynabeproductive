"""
question_gen.py

Cricket stat guessing-game logic against the cricket-mcp DuckDB database
(Cricsheet data, enriched with player role/country).

Split into two halves on purpose:
  - generate_target(): produces a question (constraints + a real,
    achievable target number X). Does NOT expose which players were used
    to build X — that's an implementation detail, not something the game
    needs or should reveal.
  - evaluate_guess(): given a name a player typed, looks the player up in
    the DB, checks they actually fit the question's constraints (country/
    role), and — if they fit — computes their REAL stat value directly
    from the data. If they don't fit, returns a reason so game.py can
    reject the guess and let the player reselect.

Schema (from cricket-mcp):
  players(player_id, player_name, batting_style, bowling_style,
          bowling_style_broad, bowling_style_arm, playing_role, country)
  matches(match_id, match_type, gender, season, date_start, date_end,
          team1, team2, event_name, ...)
  deliveries(match_id, innings_number, over_number, ball_number,
             batter, batter_id, bowler, bowler_id, runs_batter, ...,
             is_wicket, wicket_kind, wicket_player_out_id, ...)
"""

import random
import duckdb

DB_PATH = "data/cricket.duckdb"  # relative to cricket-mcp/ — adjust if needed

# Collapse cricket-mcp's fine-grained playing_role values into the 5 buckets
# Kesav wants. Edit this dict alone if the bucketing needs to change later.
ROLE_BUCKETS = {
    # Top-order batters: batting positions 1, 2, 3 (mapped to playing_role
    # "Top order Batter" in Cricsheet data).
    "Top-order Batter": ["Top order Batter"],
    # Batter is broader and includes Top order Batter too — a top-order
    # batter IS a batter, so should satisfy a generic "Batter" requirement.
    # This is one-directional: a plain/Middle order Batter does NOT
    # satisfy a "Top-order Batter" requirement (see the bucket above).
    "Batter": ["Batter", "Top order Batter", "Middle order Batter"],
    "Bowler": ["Bowler"],
    "Allrounder": ["Allrounder", "Batting Allrounder", "Bowling Allrounder"],
    "Wicketkeeper Batter": ["Wicketkeeper Batter", "Wicketkeeper"],
}

# Dismissal kinds that should NOT be credited to the bowler
NON_BOWLER_DISMISSALS = (
    "run out", "retired hurt", "retired not out",
    "retired out", "obstructing the field", "timed out",
)

IPL_EVENT_NAME = "Indian Premier League"

# Real Cricsheet match_type values: IT20 (international T20), ODI, Test,
# T20/ODM/MDM (domestic). "IPL" is not a real match_type — it's handled as
# a special case below (T20 + event_name = Indian Premier League).
FORMATS = ["IT20", "ODI", "Test", "IPL"]

# Major test-playing nations only — dropped associate/less prominent teams
COUNTRIES = [
    "India", "Australia", "England", "Pakistan", "South Africa",
    "New Zealand", "Sri Lanka", "Bangladesh", "West Indies", "Afghanistan",
]

# For these countries, most people's knowledge goes deep enough for
# fine-grained roles (Top-order Batter, Wicketkeeper Batter, Allrounder).
# For everyone else, auto-picked role constraints stay to Batter/Bowler
# only — "5 wicketkeepers from Sri Lanka" is a much harder ask than
# "3 bowlers from Sri Lanka". Doesn't affect an explicitly-passed role_bucket,
# only the random auto-selection.
DEEP_KNOWLEDGE_COUNTRIES = {"India", "Australia", "England", "Afghanistan"}
BROAD_ROLES = ["Batter", "Bowler"]

# Regional constraint buckets — SENA (South Africa, England, New Zealand, Australia)
# Used as an alternative to single-country constraints.
SENA_COUNTRIES = ["South Africa", "England", "New Zealand", "Australia"]

# Team exclusion constraints — for "excluding India" style questions.
EXCLUSION_COUNTRIES = ["India", "Australia", "England", "Sri Lanka"]
EXCLUSION_GROUPS = {
    "SENA": ["South Africa", "England", "New Zealand", "Australia"],
}


def _role_values(role_bucket):
    """Raw playing_role strings for a bucket name, or None if bucket is None."""
    if role_bucket is None:
        return None
    return ROLE_BUCKETS[role_bucket]


def _format_filter(format_):
    """
    WHERE clause + params for filtering matches by format alone
    (used for scoring an already-validated player's real stat).
    """
    if format_ == "IPL":
        return "m.match_type = ? AND m.event_name = ?", ["T20", IPL_EVENT_NAME]
    if format_ == "IT20":
        # International T20s can be stored as match_type 'IT20' OR as 'T20'
        # (where event_name is NOT 'Indian Premier League' or is NULL).
        return (
            "(m.match_type = ? OR (m.match_type = ? AND (m.event_name IS NULL OR m.event_name != ?)))",
            ["IT20", "T20", IPL_EVENT_NAME],
        )
    return "m.match_type = ?", [format_]


def _base_filters(con, format_, country, role_bucket, exclude_country=None):
    """
    WHERE clause + params for the pool-building queries (format + optional
    country + optional role bucket + optional exclusion). Used only during
    question generation.
    """
    where_sql, params = _format_filter(format_)
    clauses = [where_sql]

    # Inclusion: filter FOR specific country
    if country == "Pakistan":
        # Some Pakistani players are misattributed to 'Portugal' in Cricsheet
        clauses.append("p.country IN ('Pakistan', 'Portugal')")
    elif country == "SENA":
        # SENA regional constraint: South Africa, England, New Zealand, Australia
        placeholders = ",".join("?" for _ in SENA_COUNTRIES)
        clauses.append(f"p.country IN ({placeholders})")
        params.extend(SENA_COUNTRIES)
    elif country:
        clauses.append("p.country = ?")
        params.append(country)

    # Exclusion: filter OUT specific country or group
    if exclude_country:
        if exclude_country in EXCLUSION_GROUPS:
            excl_vals = EXCLUSION_GROUPS[exclude_country]
            placeholders = ",".join("?" for _ in excl_vals)
            clauses.append(f"p.country NOT IN ({placeholders})")
            params.extend(excl_vals)
        else:
            # Single country exclusion — handle Pakistan/Portugal misattribution
            if exclude_country == "Pakistan":
                clauses.append("p.country NOT IN ('Pakistan', 'Portugal')")
            else:
                clauses.append("p.country != ?")
                params.append(exclude_country)

    role_vals = _role_values(role_bucket)
    if role_vals:
        placeholders = ",".join("?" for _ in role_vals)
        clauses.append(f"p.playing_role IN ({placeholders})")
        params.extend(role_vals)

    return " AND ".join(clauses), params


# ---------------------------------------------------------------------------
# Pool queries — used only during question generation, to pick a real,
# achievable target number. Not used for scoring individual guesses.
# ---------------------------------------------------------------------------

def compute_runs(con, format_, country=None, role_bucket=None, exclude_country=None):
    where_sql, params = _base_filters(con, format_, country, role_bucket, exclude_country)
    query = f"""
        SELECT p.player_id, p.player_name, SUM(d.runs_batter) AS value
        FROM deliveries d
        JOIN players p ON d.batter_id = p.player_id
        WHERE d.match_id IN (SELECT match_id FROM matches m WHERE {where_sql})
        GROUP BY p.player_id, p.player_name
        HAVING SUM(d.runs_batter) > 0
        ORDER BY value DESC
    """
    return con.execute(query, params).fetchall()


def compute_wickets(con, format_, country=None, role_bucket=None, exclude_country=None):
    where_sql, params = _base_filters(con, format_, country, role_bucket, exclude_country)
    excl_placeholders = ",".join("?" for _ in NON_BOWLER_DISMISSALS)
    query = f"""
        SELECT p.player_id, p.player_name, COUNT(*) AS value
        FROM deliveries d
        JOIN players p ON d.bowler_id = p.player_id
        WHERE d.match_id IN (SELECT match_id FROM matches m WHERE {where_sql})
          AND d.is_wicket = TRUE
          AND (d.wicket_kind IS NULL OR d.wicket_kind NOT IN ({excl_placeholders}))
        GROUP BY p.player_id, p.player_name
        HAVING COUNT(*) > 0
        ORDER BY value DESC
    """
    return con.execute(query, params + list(NON_BOWLER_DISMISSALS)).fetchall()


def compute_centuries(con, format_, country=None, role_bucket=None, exclude_country=None):
    where_sql, params = _base_filters(con, format_, country, role_bucket, exclude_country)
    query = f"""
        WITH innings_runs AS (
            SELECT p.player_id, p.player_name, d.match_id, d.innings_number,
                   SUM(d.runs_batter) AS runs_in_innings
            FROM deliveries d
            JOIN players p ON d.batter_id = p.player_id
            WHERE d.match_id IN (SELECT match_id FROM matches m WHERE {where_sql})
            GROUP BY p.player_id, p.player_name, d.match_id, d.innings_number
        )
        SELECT player_id, player_name, COUNT(*) AS value
        FROM innings_runs
        WHERE runs_in_innings >= 100
        GROUP BY player_id, player_name
        HAVING COUNT(*) > 0
        ORDER BY value DESC
    """
    return con.execute(query, params).fetchall()


def compute_five_fers(con, format_, country=None, role_bucket=None, exclude_country=None):
    where_sql, params = _base_filters(con, format_, country, role_bucket, exclude_country)
    excl_placeholders = ",".join("?" for _ in NON_BOWLER_DISMISSALS)
    query = f"""
        WITH innings_wkts AS (
            SELECT p.player_id, p.player_name, d.match_id, d.innings_number,
                   COUNT(*) AS wkts_in_innings
            FROM deliveries d
            JOIN players p ON d.bowler_id = p.player_id
            WHERE d.match_id IN (SELECT match_id FROM matches m WHERE {where_sql})
              AND d.is_wicket = TRUE
              AND (d.wicket_kind IS NULL OR d.wicket_kind NOT IN ({excl_placeholders}))
            GROUP BY p.player_id, p.player_name, d.match_id, d.innings_number
        )
        SELECT player_id, player_name, COUNT(*) AS value
        FROM innings_wkts
        WHERE wkts_in_innings >= 5
        GROUP BY player_id, player_name
        HAVING COUNT(*) > 0
        ORDER BY value DESC
    """
    return con.execute(query, params + list(NON_BOWLER_DISMISSALS)).fetchall()


STAT_FUNCS = {
    "runs": compute_runs,
    "wickets": compute_wickets,
    "centuries": compute_centuries,
    "five_fers": compute_five_fers,
}


# ---------------------------------------------------------------------------
# Question generation
# ---------------------------------------------------------------------------

def generate_target(con, num_players=None,
                     stat=None, format_=None, country=None, role_bucket=None,
                     exclude_country=None, max_attempts=25):
    """
    Produce a question: constraints + a real, achievable target number X.

    Internally samples a few real players to build X (so X is always
    hittable), but deliberately does NOT return which players were used —
    the game doesn't need or want that leaked. It also auto-excludes a
    random small slice of the top of the ranked pool (scaled to pool size)
    so the obvious #1 player isn't always the easy answer.

    num_players: 3 or 5 only. If not passed, randomly picks one per question.

    Returns a dict:
      { question_text, stat, format, country, role_bucket, num_players, target }
    or None if no valid combo was found within max_attempts.
    """
    if num_players is None:
        num_players = random.choice([3, 5])
    elif num_players not in (3, 5):
        raise ValueError("num_players must be 3 or 5")

    # Some role+stat combos are basically nonsensical, not just "rare" —
    # batters essentially never take five-fers, bowlers essentially never
    # score centuries. These aren't fun trick questions, they're degenerate
    # (near-zero regardless of window size), so block them from
    # auto-selection entirely. Doesn't affect an explicitly-passed
    # role_bucket — only filters what gets randomly picked.
    BATTING_ROLES = {"Top-order Batter", "Batter", "Wicketkeeper Batter"}
    BLOCKED_ROLE_STAT_COMBOS = (
        {(role, "wickets") for role in BATTING_ROLES}
        | {(role, "five_fers") for role in BATTING_ROLES}
        | {("Bowler", "centuries")}
    )

    def _window_size(stat_, format_):
        if stat_ in ("centuries", "five_fers"):
            return 15
        if format_ in ("Test", "ODI"):
            return 15
        return 30  # IT20 / IPL runs or wickets

    for _ in range(max_attempts):
        s = stat or random.choice(list(STAT_FUNCS.keys()))

        # Role decided FIRST, right after stat, and always explicit — never
        # left as None. This is deliberate: whether a runs/wickets total is
        # "high" or "normal" only makes sense once you know the role (a
        # bowler with 600 runs is huge, a batter with 600 is nothing), so
        # role has to be pinned down before target magnitude is judged.
        if role_bucket is not None:
            r = role_bucket
        else:
            valid_roles = [
                role for role in ROLE_BUCKETS
                if (role, s) not in BLOCKED_ROLE_STAT_COMBOS
            ]
            r = random.choice(valid_roles)

        f = format_ or random.choice(FORMATS)

        # Decide between inclusion (specific country) and exclusion (excluding teams)
        # ~30% chance of exclusion when no explicit country is passed
        use_exclusion = (
            country is None
            and random.random() < 0.3
            and exclude_country is None  # not explicitly set
        )

        if use_exclusion:
            # Randomly pick exclusion type: single country or SENA group
            if random.random() < 0.7:
                # Single country exclusion
                excl_pool = [c for c in EXCLUSION_COUNTRIES if c != "Pakistan" or f != "IPL"]
                curr_exclude_country = random.choice(excl_pool)
            else:
                # SENA group exclusion
                curr_exclude_country = "SENA"
            c = None  # no inclusion constraint when excluding
        else:
            curr_exclude_country = exclude_country  # keep explicit value or None
            # Country choices depend on the role now: niche roles (anything
            # other than plain Batter/Bowler) only get auto-picked alongside
            # countries the friend group actually knows deeply. Broad roles
            # (Batter/Bowler) are fine with any major country.
            if r in BROAD_ROLES:
                country_choices = list(COUNTRIES) + ["SENA"]
            else:
                country_choices = list(DEEP_KNOWLEDGE_COUNTRIES) + ["SENA"]

            # Pakistani players have been barred from the IPL since 2008 —
            # any Pakistan+IPL data in Cricsheet is a tiny 2008-season-only
            # historical footnote, not a fair/real question.
            if f == "IPL":
                country_choices = [cc for cc in country_choices if cc != "Pakistan"]

            c = country if country is not None else (
                random.choice(country_choices + [None] * 3)  # bias toward "any country"
            )

        pool = STAT_FUNCS[s](con, f, country=c, role_bucket=r, exclude_country=curr_exclude_country)

        # Auto-exclude a random slice of the top of the pool (up to ~20%,
        # capped at 4) so the obvious #1 player isn't always in play.
        max_exclude = min(4, len(pool) // 5)
        exclude_n = random.randint(0, max_exclude) if max_exclude > 0 else 0

        window = _window_size(s, f)
        eligible = pool[exclude_n:exclude_n + window]

        # Afghanistan has smaller player pools — relax the minimum if needed
        required = num_players
        if c == "Afghanistan" and len(eligible) < num_players and len(eligible) >= 3:
            required = 3

        if len(eligible) < required:
            continue  # constraints too narrow, retry with new random combo

        chosen = random.sample(eligible, required)
        target = sum(v for _, _, v in chosen)

        # Hard floors, scaled by role — this is the actual fix for
        # "sub-5k runs is only feasible for bowlers": the floor now checks
        # the SPECIFIC role chosen, not just "is it Bowler or not". Any
        # batting-capable role (Top-order Batter, Batter, Wicketkeeper
        # Batter, Allrounder) has to clear a real per-format floor;
        # Bowler stays low on purpose (that's the intentional trick
        # question — bowlers incidentally scoring some runs).
        if s in ("centuries", "five_fers") and target < required * 4:
            continue
        if s == "wickets" and target < required * 5:
            continue
        if s == "runs":
            if r == "Bowler":
                if target < required * 30:  # still needs to be non-trivial
                    continue
            else:
                runs_floor_per_player = {"Test": 400, "ODI": 400, "IT20": 150, "IPL": 300}
                floor = required * runs_floor_per_player.get(f, 200)
                if target < floor:
                    continue

        constraint_bits = [f"{f}"]
        if curr_exclude_country:
            if curr_exclude_country == "SENA":
                constraint_bits.append("excluding SENA countries")
            else:
                constraint_bits.append(f"excluding {curr_exclude_country}")
        elif c:
            if c == "SENA":
                constraint_bits.append("players from SENA nations")
            else:
                constraint_bits.append(f"players from {c}")
        if r:
            constraint_bits.append(f"role: {r}")
        constraint_bits.append(f"stat: {s.replace('_', ' ')}")

        question_text = (
            f"Name {required} players ({', '.join(constraint_bits)}) "
            f"whose combined {s.replace('_', ' ')} is closest to {target}."
        )

        return {
            "question_text": question_text,
            "stat": s,
            "format": f,
            "country": c,
            "exclude_country": curr_exclude_country,
            "role_bucket": r,
            "num_players": required,
            "target": target,
        }

    return None  # exhausted attempts, constraints kept being too narrow


# ---------------------------------------------------------------------------
# Guess resolution and scoring
# ---------------------------------------------------------------------------

def resolve_player(con, name):
    """
    Look up a player by name. Exact match first, then case-insensitive.
    Returns (player_id, player_name, country, playing_role) or None.

    NOTE: this is a plain exact/case-insensitive lookup, not fuzzy typo
    matching — that's name_match.py's job (next module to build). This
    function is what name_match.py will eventually hand a cleaned-up
    name to, or it can be used standalone for now.
    """
    name = name.strip()
    row = con.execute(
        "SELECT player_id, player_name, country, playing_role "
        "FROM players WHERE player_name = ?", [name]
    ).fetchone()
    if row:
        return row
    row = con.execute(
        "SELECT player_id, player_name, country, playing_role "
        "FROM players WHERE lower(player_name) = lower(?)", [name]
    ).fetchone()
    return row


def get_player_stat_value(con, player_id, stat, format_):
    """Compute a single player's REAL stat value for a given format."""
    where_sql, params = _format_filter(format_)

    if stat == "runs":
        query = f"""
            SELECT COALESCE(SUM(d.runs_batter), 0)
            FROM deliveries d
            WHERE d.batter_id = ?
              AND d.match_id IN (SELECT match_id FROM matches m WHERE {where_sql})
        """
        return con.execute(query, [player_id] + params).fetchone()[0]

    if stat == "wickets":
        excl_placeholders = ",".join("?" for _ in NON_BOWLER_DISMISSALS)
        query = f"""
            SELECT COUNT(*)
            FROM deliveries d
            WHERE d.bowler_id = ?
              AND d.match_id IN (SELECT match_id FROM matches m WHERE {where_sql})
              AND d.is_wicket = TRUE
              AND (d.wicket_kind IS NULL OR d.wicket_kind NOT IN ({excl_placeholders}))
        """
        return con.execute(query, [player_id] + params + list(NON_BOWLER_DISMISSALS)).fetchone()[0]

    if stat == "centuries":
        query = f"""
            WITH innings_runs AS (
                SELECT d.match_id, d.innings_number, SUM(d.runs_batter) AS runs_in_innings
                FROM deliveries d
                WHERE d.batter_id = ?
                  AND d.match_id IN (SELECT match_id FROM matches m WHERE {where_sql})
                GROUP BY d.match_id, d.innings_number
            )
            SELECT COUNT(*) FROM innings_runs WHERE runs_in_innings >= 100
        """
        return con.execute(query, [player_id] + params).fetchone()[0]

    if stat == "five_fers":
        excl_placeholders = ",".join("?" for _ in NON_BOWLER_DISMISSALS)
        query = f"""
            WITH innings_wkts AS (
                SELECT d.match_id, d.innings_number, COUNT(*) AS wkts_in_innings
                FROM deliveries d
                WHERE d.bowler_id = ?
                  AND d.match_id IN (SELECT match_id FROM matches m WHERE {where_sql})
                  AND d.is_wicket = TRUE
                  AND (d.wicket_kind IS NULL OR d.wicket_kind NOT IN ({excl_placeholders}))
                GROUP BY d.match_id, d.innings_number
            )
            SELECT COUNT(*) FROM innings_wkts WHERE wkts_in_innings >= 5
        """
        return con.execute(query, [player_id] + params + list(NON_BOWLER_DISMISSALS)).fetchone()[0]

    raise ValueError(f"Unknown stat: {stat}")


def evaluate_guess(con, player_name, stat, format_, country=None, role_bucket=None, exclude_country=None):
    """
    Given a name a player typed, resolve it, check it fits the question's
    constraints, and score it if it does.

    Returns one of:
      {"valid": False, "reason": "..."}                     — not found
      {"valid": False, "reason": "...", "player_name": ...}  — found but
                                                                 doesn't fit
      {"valid": True, "player_name": ..., "value": N}        — fits, scored

    game.py should show `reason` to the player and let them reselect
    whenever valid is False.
    """
    player = resolve_player(con, player_name)
    if player is None:
        return {"valid": False, "reason": f'"{player_name}" wasn\'t found in the database.'}

    player_id, resolved_name, p_country, p_role = player

    # Check exclusion first — if player is from excluded country/group, reject
    if exclude_country:
        is_excluded = False
        if exclude_country == "SENA":
            is_excluded = p_country in SENA_COUNTRIES
        elif exclude_country == "Pakistan":
            # Handle Pakistan/Portugal misattribution
            is_excluded = p_country in ("Pakistan", "Portugal")
        else:
            is_excluded = p_country == exclude_country

        if is_excluded:
            if exclude_country == "SENA":
                reason = f"{resolved_name} is from {p_country} (SENA), which is excluded from this question."
            else:
                reason = f"{resolved_name} is from {p_country}, which is excluded from this question."
            return {"valid": False, "player_name": resolved_name, "reason": reason}

    # Check inclusion — if specific country required, player must be from there
    if country and p_country != country:
        # Some Pakistani players are misattributed to 'Portugal' in Cricsheet
        if country == "Pakistan" and p_country == "Portugal":
            pass  # acceptable
        elif country == "SENA" and p_country in SENA_COUNTRIES:
            pass  # acceptable
        else:
            return {
                "valid": False,
                "player_name": resolved_name,
                "reason": f"{resolved_name} is from {p_country}, doesn't fit the required constraints (needs {country}).",
            }

    if role_bucket:
        allowed_roles = _role_values(role_bucket)
        if p_role not in allowed_roles:
            return {
                "valid": False,
                "player_name": resolved_name,
                "reason": f"{resolved_name}'s role is {p_role}, doesn't fit the required constraints (needs {role_bucket}).",
            }

    value = get_player_stat_value(con, player_id, stat, format_)
    return {"valid": True, "player_name": resolved_name, "value": value}


if __name__ == "__main__":
    con = duckdb.connect(DB_PATH, read_only=True)

    print("Generating 3 sample questions...\n")
    for i in range(3):
        q = generate_target(con)
        if q is None:
            print(f"[{i+1}] Failed to generate — pool too small after 25 attempts")
            continue
        print(f"[{i+1}] {q['question_text']}")

    con.close()

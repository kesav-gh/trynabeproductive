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
    "Opening Batter": ["Opening Batter"],
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
# fine-grained roles (Opening Batter, Wicketkeeper Batter, Allrounder).
# For everyone else, auto-picked role constraints stay to Batter/Bowler
# only — "5 wicketkeepers from Sri Lanka" is a much harder ask than
# "3 bowlers from Sri Lanka". Doesn't affect an explicitly-passed role_bucket,
# only the random auto-selection.
DEEP_KNOWLEDGE_COUNTRIES = {"India", "Australia", "England", "Afghanistan"}
BROAD_ROLES = ["Batter", "Bowler"]


def _role_values(role_bucket):
    """Raw playing_role strings for a bucket name, or None if bucket is None."""
    if role_bucket is None:
        return None
    return ROLE_BUCKETS[role_bucket]


def _role_bucket_for(playing_role):
    """Reverse lookup: raw playing_role -> which bucket it belongs to (or None)."""
    for bucket, vals in ROLE_BUCKETS.items():
        if playing_role in vals:
            return bucket
    return None


def _format_filter(format_):
    """
    WHERE clause + params for filtering matches by format alone
    (used for scoring an already-validated player's real stat).
    """
    if format_ == "IPL":
        return "m.match_type = ? AND m.event_name = ?", ["T20", IPL_EVENT_NAME]
    return "m.match_type = ?", [format_]


def _base_filters(con, format_, country, role_bucket):
    """
    WHERE clause + params for the pool-building queries (format + optional
    country + optional role bucket). Used only during question generation.
    """
    where_sql, params = _format_filter(format_)
    clauses = [where_sql]

    if country:
        clauses.append("p.country = ?")
        params.append(country)

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

def compute_runs(con, format_, country=None, role_bucket=None):
    where_sql, params = _base_filters(con, format_, country, role_bucket)
    query = f"""
        SELECT p.player_id, p.player_name, SUM(d.runs_batter) AS value
        FROM deliveries d
        JOIN players p ON d.batter_id = p.player_id
        JOIN matches m ON d.match_id = m.match_id
        WHERE {where_sql}
        GROUP BY p.player_id, p.player_name
        HAVING SUM(d.runs_batter) > 0
        ORDER BY value DESC
    """
    return con.execute(query, params).fetchall()


def compute_wickets(con, format_, country=None, role_bucket=None):
    where_sql, params = _base_filters(con, format_, country, role_bucket)
    excl_placeholders = ",".join("?" for _ in NON_BOWLER_DISMISSALS)
    query = f"""
        SELECT p.player_id, p.player_name, COUNT(*) AS value
        FROM deliveries d
        JOIN players p ON d.bowler_id = p.player_id
        JOIN matches m ON d.match_id = m.match_id
        WHERE {where_sql}
          AND d.is_wicket = TRUE
          AND (d.wicket_kind IS NULL OR d.wicket_kind NOT IN ({excl_placeholders}))
        GROUP BY p.player_id, p.player_name
        HAVING COUNT(*) > 0
        ORDER BY value DESC
    """
    return con.execute(query, params + list(NON_BOWLER_DISMISSALS)).fetchall()


def compute_centuries(con, format_, country=None, role_bucket=None):
    where_sql, params = _base_filters(con, format_, country, role_bucket)
    query = f"""
        WITH innings_runs AS (
            SELECT p.player_id, p.player_name, d.match_id, d.innings_number,
                   SUM(d.runs_batter) AS runs_in_innings
            FROM deliveries d
            JOIN players p ON d.batter_id = p.player_id
            JOIN matches m ON d.match_id = m.match_id
            WHERE {where_sql}
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


def compute_five_fers(con, format_, country=None, role_bucket=None):
    where_sql, params = _base_filters(con, format_, country, role_bucket)
    excl_placeholders = ",".join("?" for _ in NON_BOWLER_DISMISSALS)
    query = f"""
        WITH innings_wkts AS (
            SELECT p.player_id, p.player_name, d.match_id, d.innings_number,
                   COUNT(*) AS wkts_in_innings
            FROM deliveries d
            JOIN players p ON d.bowler_id = p.player_id
            JOIN matches m ON d.match_id = m.match_id
            WHERE {where_sql}
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
                     max_attempts=25):
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
    BATTING_ROLES = {"Opening Batter", "Batter", "Wicketkeeper Batter"}
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

        # Country choices depend on the role now: niche roles (anything
        # other than plain Batter/Bowler) only get auto-picked alongside
        # countries the friend group actually knows deeply. Broad roles
        # (Batter/Bowler) are fine with any major country.
        if r in BROAD_ROLES:
            country_choices = list(COUNTRIES)
        else:
            country_choices = list(DEEP_KNOWLEDGE_COUNTRIES)

        # Pakistani players have been barred from the IPL since 2008 —
        # any Pakistan+IPL data in Cricsheet is a tiny 2008-season-only
        # historical footnote, not a fair/real question.
        if f == "IPL":
            country_choices = [c for c in country_choices if c != "Pakistan"]

        c = country if country is not None else (
            random.choice(country_choices + [None] * 3)  # bias toward "any country"
        )

        pool = STAT_FUNCS[s](con, f, country=c, role_bucket=r)

        # Auto-exclude a random slice of the top of the pool (up to ~20%,
        # capped at 4) so the obvious #1 player isn't always in play.
        max_exclude = min(4, len(pool) // 5)
        exclude_n = random.randint(0, max_exclude) if max_exclude > 0 else 0

        window = _window_size(s, f)
        eligible = pool[exclude_n:exclude_n + window]

        if len(eligible) < num_players:
            continue  # constraints too narrow, retry with new random combo

        chosen = random.sample(eligible, num_players)
        target = sum(v for _, _, v in chosen)

        # Hard floors, scaled by role — this is the actual fix for
        # "sub-5k runs is only feasible for bowlers": the floor now checks
        # the SPECIFIC role chosen, not just "is it Bowler or not". Any
        # batting-capable role (Opening Batter, Batter, Wicketkeeper
        # Batter, Allrounder) has to clear a real per-format floor;
        # Bowler stays low on purpose (that's the intentional trick
        # question — bowlers incidentally scoring some runs).
        if s in ("centuries", "five_fers") and target < num_players * 4:
            continue
        if s == "wickets" and target < num_players * 5:
            continue
        if s == "runs":
            if r == "Bowler":
                if target < num_players * 30:  # still needs to be non-trivial
                    continue
            else:
                runs_floor_per_player = {"Test": 400, "ODI": 400, "IT20": 150, "IPL": 300}
                floor = num_players * runs_floor_per_player.get(f, 200)
                if target < floor:
                    continue

        constraint_bits = [f"{f}"]
        if c:
            constraint_bits.append(f"players from {c}")
        if r:
            constraint_bits.append(f"role: {r}")
        constraint_bits.append(f"stat: {s.replace('_', ' ')}")

        question_text = (
            f"Name {num_players} players ({', '.join(constraint_bits)}) "
            f"whose combined {s.replace('_', ' ')} is closest to {target}."
        )

        return {
            "question_text": question_text,
            "stat": s,
            "format": f,
            "country": c,
            "role_bucket": r,
            "num_players": num_players,
            "target": target,
        }

    return None  # exhausted attempts, constraints kept being too narrow


# ---------------------------------------------------------------------------
# Guess resolution and scoring
# ---------------------------------------------------------------------------

def _prominence(con, player_ids):
    """delivery-appearance counts for player_ids -- a proxy for fame, used
    below to break ties deterministically among players who share an
    identical name. Mirrors name_match.py's _prominence_map; duplicated
    rather than imported, since these two modules are kept independent
    of each other by design (see name_match.py's own docstring on why
    resolution and constraint-checking stay separate concerns)."""
    if not player_ids:
        return {}
    placeholders = ",".join("?" for _ in player_ids)
    rows = con.execute(f"""
        SELECT player_id, COUNT(*) AS appearances FROM (
            SELECT batter_id AS player_id FROM deliveries WHERE batter_id IN ({placeholders})
            UNION ALL
            SELECT bowler_id AS player_id FROM deliveries WHERE bowler_id IN ({placeholders})
        ) t
        GROUP BY player_id
    """, player_ids + player_ids).fetchall()
    return dict(rows)


def resolve_player(con, name):
    """
    Look up a player by name. Exact match first, then case-insensitive.
    Returns (player_id, player_name, country, playing_role) or None.

    The database contains multiple distinct players sharing an identical
    name (three different "Rashid Khan"s, confirmed) -- when that
    happens, the most prominent one (by delivery-appearance count) wins,
    deterministically. That is a heuristic, not a guarantee of picking
    the SPECIFIC player someone meant, which is exactly why
    evaluate_guess() below prefers to be given a player_id and bypass
    this function entirely whenever the caller already knows which
    player they mean -- from a non-ambiguous name_match.py resolution,
    or from an explicit disambiguation choice. This name-only path
    remains here as the fallback for callers (or console/debug use) that
    only ever have a plain string to go on.
    """
    name = name.strip()
    rows = con.execute(
        "SELECT player_id, player_name, country, playing_role "
        "FROM players WHERE player_name = ?", [name]
    ).fetchall()
    if not rows:
        rows = con.execute(
            "SELECT player_id, player_name, country, playing_role "
            "FROM players WHERE lower(player_name) = lower(?)", [name]
        ).fetchall()
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    prominence = _prominence(con, [r[0] for r in rows])
    rows.sort(key=lambda r: prominence.get(r[0], 0), reverse=True)
    return rows[0]


def resolve_player_by_id(con, player_id):
    """Unambiguous lookup by id. Use this whenever the caller already
    knows exactly which player is meant -- see evaluate_guess()."""
    return con.execute(
        "SELECT player_id, player_name, country, playing_role "
        "FROM players WHERE player_id = ?", [player_id]
    ).fetchone()


def get_player_stat_value(con, player_id, stat, format_):
    """Compute a single player's REAL stat value for a given format."""
    where_sql, params = _format_filter(format_)

    if stat == "runs":
        query = f"""
            SELECT COALESCE(SUM(d.runs_batter), 0)
            FROM deliveries d JOIN matches m ON d.match_id = m.match_id
            WHERE d.batter_id = ? AND {where_sql}
        """
        return con.execute(query, [player_id] + params).fetchone()[0]

    if stat == "wickets":
        excl_placeholders = ",".join("?" for _ in NON_BOWLER_DISMISSALS)
        query = f"""
            SELECT COUNT(*)
            FROM deliveries d JOIN matches m ON d.match_id = m.match_id
            WHERE d.bowler_id = ? AND {where_sql}
              AND d.is_wicket = TRUE
              AND (d.wicket_kind IS NULL OR d.wicket_kind NOT IN ({excl_placeholders}))
        """
        return con.execute(query, [player_id] + params + list(NON_BOWLER_DISMISSALS)).fetchone()[0]

    if stat == "centuries":
        query = f"""
            WITH innings_runs AS (
                SELECT d.match_id, d.innings_number, SUM(d.runs_batter) AS runs_in_innings
                FROM deliveries d JOIN matches m ON d.match_id = m.match_id
                WHERE d.batter_id = ? AND {where_sql}
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
                FROM deliveries d JOIN matches m ON d.match_id = m.match_id
                WHERE d.bowler_id = ? AND {where_sql}
                  AND d.is_wicket = TRUE
                  AND (d.wicket_kind IS NULL OR d.wicket_kind NOT IN ({excl_placeholders}))
                GROUP BY d.match_id, d.innings_number
            )
            SELECT COUNT(*) FROM innings_wkts WHERE wkts_in_innings >= 5
        """
        return con.execute(query, [player_id] + params + list(NON_BOWLER_DISMISSALS)).fetchone()[0]

    raise ValueError(f"Unknown stat: {stat}")


def evaluate_guess(
    con,
    player_name,
    stat,
    format_,
    country=None,
    role_bucket=None,
    player_id=None,
):
    """
    Given a resolved player name, check all question constraints
    and calculate the player's actual stat value.

    player_id: pass this whenever the caller already knows exactly which
    player is meant -- an unambiguous name_match.py resolution, or an
    explicit disambiguation choice -- and it looks them up directly
    instead of re-resolving by name. That distinction matters: the
    database has multiple distinct players sharing an identical name
    (three different "Rashid Khan"s, confirmed), so re-resolving by name
    alone can silently land on the WRONG one -- exactly the ambiguity
    disambiguation exists to resolve, defeated by discarding its answer
    a moment later. Falls back to name-only resolution when no id is
    given (also now deterministic -- see resolve_player()).

    Returns:
        {"valid": False, "reason": "..."}
        {"valid": False, "reason": "...", "player_name": "..."}
        {"valid": True, "player_name": "...", "value": N}
    """

    player = resolve_player_by_id(con, player_id) if player_id else resolve_player(con, player_name)

    if player is None:
        return {
            "valid": False,
            "reason": f'"{player_name}" wasn\'t found in the database.',
        }

    player_id, resolved_name, p_country, p_role = player

    # ---------------------------------------------------------
    # Country constraint
    # ---------------------------------------------------------

    if country and p_country != country:
        return {
            "valid": False,
            "player_name": resolved_name,
            "reason": (
                f"{resolved_name} is from {p_country}, "
                f"doesn't fit the required constraints "
                f"(needs {country})."
            ),
        }

    # ---------------------------------------------------------
    # Role constraint
    # ---------------------------------------------------------

    if role_bucket:
        actual_bucket = _role_bucket_for(p_role)

        if actual_bucket != role_bucket:
            return {
                "valid": False,
                "player_name": resolved_name,
                "reason": (
                    f"{resolved_name}'s role is {p_role}, "
                    f"doesn't fit the required constraints "
                    f"(needs {role_bucket})."
                ),
            }

    # ---------------------------------------------------------
    # IPL eligibility
    # ---------------------------------------------------------

    if format_ == "IPL":
        played_ipl = con.execute(
            """
            SELECT EXISTS (
                SELECT 1
                FROM deliveries d
                JOIN matches m
                    ON d.match_id = m.match_id
                WHERE
                    m.match_type = 'T20'
                    AND m.event_name = 'Indian Premier League'
                    AND (
                        d.batter_id = ?
                        OR d.bowler_id = ?
                    )
            )
            """,
            [player_id, player_id],
        ).fetchone()[0]

        if not played_ipl:
            return {
                "valid": False,
                "player_name": resolved_name,
                "reason": (
                    f"{resolved_name} has not played in the IPL."
                ),
            }

    # ---------------------------------------------------------
    # Calculate real stat
    # ---------------------------------------------------------

    value = get_player_stat_value(
        con,
        player_id,
        stat,
        format_,
    )

    return {
        "valid": True,
        "player_name": resolved_name,
        "value": value,
    }

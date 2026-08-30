"""
name_match.py

Resolves whatever a player actually types ("kohli", "MS Dhoni", a typo like
"Kohlee") into a real player row, before handing off to question_gen.py's
evaluate_guess() for scoring.

IMPORTANT — deliberately does NOT filter by the current question's
country/role/format. That's evaluate_guess()'s job, which gives a clear
"X doesn't fit because Y" rejection message. If name resolution also
filtered by those constraints, a real player who doesn't fit would be
indistinguishable from a name that doesn't exist at all, AND fuzzy
matching could silently lock onto a totally different, unintended player
who happens to survive the narrowed filter (this actually happened: a
constraint-filtered version of this file resolved "ashwin" to an obscure
"Ashwin Hebbar" instead of R Ashwin, because R Ashwin's role didn't match
the current question and got filtered out of the search before matching
even ran). Keep resolution and constraint-checking as two separate steps.

Does apply ALLOWED_COUNTRIES as a permanent, question-independent
relevance filter — dropping obscure associate-nation namesakes (Israel,
Vanuatu, Cambodia, etc.) that were cluttering ambiguous-match lists for
common surnames like "Broad" or "Samson".

Uses DuckDB's built-in jaro_winkler_similarity for typo tolerance,
compared against individual name tokens (not the whole "V Kohli" string).
For multi-word typed queries (e.g. "sanju samson"), only the LAST word is
used for fuzzy comparison, since the design is "type the last name" —
using the whole multi-word string was previously causing wrong matches
(e.g. "sanju samson" matching "Krishan Sanjula" via a shared substring in
"sanjula", ignoring "samson" entirely).

Resolution order, first thing that finds candidates wins:
  1. Exact match (case-insensitive) on the full name
  2. Substring match on the full name, ranked by prominence
  3. Fuzzy last-token match (typo tolerance), ranked by similarity score

Design (per Kesav):
  - Multiple plausible matches -> return a short list to pick from
  - No plausible match at all -> clean rejection, no "did you mean" guessing
"""

MAX_CANDIDATES = 5
FUZZY_THRESHOLD = 0.85  # jaro_winkler score (0-1) — tuned with headroom
                        # above known-good cases like "Kohlee"->Kohli (0.893)

# Major cricket nations + well-known associate/emerging teams. Permanent
# relevance filter — NOT tied to any specific question's constraints.
ALLOWED_COUNTRIES = {
    "India", "Australia", "England", "Pakistan", "South Africa",
    "New Zealand", "Sri Lanka", "Bangladesh", "West Indies", "Afghanistan",
    "Ireland", "Zimbabwe", "Netherlands", "Scotland",
    "USA", "United States of America",
    "Nepal", "UAE", "United Arab Emirates",
    "Namibia", "Canada", "Oman",
}


def _prominence_map(con, ids):
    """dict of player_id -> delivery-appearance count, for the given ids."""
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = con.execute(f"""
        SELECT player_id, COUNT(*) AS appearances FROM (
            SELECT batter_id AS player_id FROM deliveries WHERE batter_id IN ({placeholders})
            UNION ALL
            SELECT bowler_id AS player_id FROM deliveries WHERE bowler_id IN ({placeholders})
        ) t
        GROUP BY player_id
    """, ids + ids).fetchall()
    return dict(rows)


def _rank_by_prominence(con, candidates):
    """
    Sort candidates by how many deliveries they appear in — a proxy for
    fame. Prevents well-known players from being truncated out by
    obscure namesakes.
    candidates: list of (player_id, player_name, country, playing_role)
    """
    if not candidates:
        return candidates
    prominence = _prominence_map(con, [c[0] for c in candidates])
    return sorted(candidates, key=lambda c: prominence.get(c[0], 0), reverse=True)


def _country_filter_clause():
    placeholders = ",".join("?" for _ in ALLOWED_COUNTRIES)
    return f"p.country IN ({placeholders})", list(ALLOWED_COUNTRIES)


def resolve_player_fuzzy(con, query, max_candidates=MAX_CANDIDATES):
    """
    Resolve a typed name to a player (or list of candidates, or nothing).
    Deliberately independent of any question's constraints — see module
    docstring for why.

    Returns one of:
      {"status": "exact", "player": (player_id, player_name, country, playing_role)}
      {"status": "ambiguous", "candidates": [(player_id, player_name, country, playing_role), ...]}
      {"status": "not_found"}
    """
    query = query.strip()
    if not query:
        return {"status": "not_found"}

    country_clause, country_params = _country_filter_clause()

    # 1. Exact match on full name
    exact = con.execute(f"""
        SELECT player_id, player_name, country, playing_role
        FROM players p
        WHERE lower(p.player_name) = lower(?) AND {country_clause}
    """, [query] + country_params).fetchall()
    if len(exact) == 1:
        return {"status": "exact", "player": exact[0]}
    if len(exact) > 1:
        ranked = _rank_by_prominence(con, exact)
        return {"status": "ambiguous", "candidates": ranked[:max_candidates]}

    # 2. Substring match on full name — handles "kohli" -> "V Kohli",
    #    "sharma" -> every Sharma. Ranked by prominence, not alphabet.
    substr = con.execute(f"""
        SELECT player_id, player_name, country, playing_role
        FROM players p
        WHERE lower(p.player_name) LIKE '%' || lower(?) || '%' AND {country_clause}
    """, [query] + country_params).fetchall()
    if substr:
        ranked = _rank_by_prominence(con, substr)
        if len(ranked) == 1:
            return {"status": "exact", "player": ranked[0]}
        return {"status": "ambiguous", "candidates": ranked[:max_candidates]}

    # 3. Fuzzy token match (typo tolerance) — only the LAST word of the
    #    typed query is used for comparison (design: type the last name),
    #    compared against individual tokens in every player's name.
    fuzzy_key = query.lower().split()[-1]

    fuzzy = con.execute(f"""
        WITH tokens AS (
            SELECT p.player_id, p.player_name, p.country, p.playing_role,
                   unnest(string_split(lower(p.player_name), ' ')) AS token
            FROM players p
            WHERE {country_clause}
        )
        SELECT player_id, player_name, country, playing_role,
               MAX(jaro_winkler_similarity(token, ?)) AS score
        FROM tokens
        GROUP BY player_id, player_name, country, playing_role
        HAVING MAX(jaro_winkler_similarity(token, ?)) >= ?
        ORDER BY score DESC
        LIMIT 50
    """, country_params + [fuzzy_key, fuzzy_key, FUZZY_THRESHOLD]).fetchall()

    if not fuzzy:
        return {"status": "not_found"}

    ids = [row[0] for row in fuzzy]
    prominence = _prominence_map(con, ids)
    fuzzy.sort(key=lambda row: (row[4], prominence.get(row[0], 0)), reverse=True)

    candidates = [(pid, name, country_, role) for pid, name, country_, role, score in fuzzy[:max_candidates]]

    if len(candidates) == 1:
        return {"status": "exact", "player": candidates[0]}
    return {"status": "ambiguous", "candidates": candidates}


if __name__ == "__main__":
    import duckdb
    DB_PATH = "data/cricket.duckdb"
    con = duckdb.connect(DB_PATH, read_only=True)

    test_queries = ["V Kohli", "kohli", "Kohlee", "sharma", "Dhomi", "sanju samson", "ashwin", "xyznotarealplayer"]
    for q in test_queries:
        result = resolve_player_fuzzy(con, q)
        print(f"{q!r:25s} -> {result}")

    con.close()

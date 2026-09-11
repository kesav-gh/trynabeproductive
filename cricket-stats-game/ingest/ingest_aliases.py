#!/usr/bin/env python3
"""
ingest_aliases.py

Downloads Cricsheet's official player register (people.csv) and populates
a `player_aliases` table in DuckDB. This enables name_match.py to resolve
alternate spellings, abbreviations, and nicknames without manual dictionaries.

Usage:
    python ingest/ingest_aliases.py [--db-path data/cricket.duckdb]
"""

import argparse
import csv
import io
import os
import sys
import urllib.request

import duckdb

CRICSHEET_PEOPLE_URL = "https://cricsheet.org/register/people.csv"

# Manual overrides for well-known nickname -> canonical name mappings.
# Cricsheet's people.csv uses abbreviated names (e.g. "V Kohli"), so these
# map common full names / nicknames to the identifier Cricsheet uses.
EXTRA_ALIASES = {
    # India
    "virat kohli": "b4a23876",
    "kohli": "b4a23876",
    "ms dhoni": "d74e17aa",
    "dhoni": "d74e17aa",
    "mahendra singh dhoni": "d74e17aa",
    "rohit sharma": "4833900c",
    "hitman": "4833900c",
    "jaspit bumrah": "0ce52978",
    "bumrah": "0ce52978",
    "ravindra jadeja": "a2513e6e",
    "jadeja": "a2513e6e",
    "r ashwin": "e21b3f94",
    "ashwin": "e21b3f94",
    "ravichandran ashwin": "e21b3f94",
    "hardik pandya": "c2a83f83",
    "pandya": "c2a83f83",
    "jasprit bumrah": "0ce52978",
    "yuzvendra chahal": "7ec47c64",
    "chahal": "7ec47c64",
    "kl rahul": "6938356a",
    "rahul": "6938356a",
    "rishabh pant": "a5b0391e",
    "pant": "a5b0391e",
    "shubman gill": "a9486578",
    "gill": "a9486578",
    "suryakumar yadav": "0c3b1e34",
    "sky": "0c3b1e34",
    "surya": "0c3b1e34",
    # Australia
    "steve smith": "0860493c",
    "smith": "0860493c",
    "marnus labuschagne": "a8f78938",
    "labuschagne": "a8f78938",
    "pat cummins": "8b63a899",
    "cummins": "8b63a899",
    "mitchell starc": "16e7e6cc",
    "starc": "16e7e6cc",
    "starcy": "16e7e6cc",
    "glenn maxwell": "49805e9e",
    "maxwell": "49805e9e",
    "david warner": "1a736495",
    "warner": "1a736495",
    "travis head": "1eaf205c",
    "head": "1eaf205c",
    "josh hazlewood": "30be5950",
    "hazlewood": "30be5950",
    # England
    "ben stokes": "0c43e144",
    "stokes": "0c43e144",
    "joe root": "0c43e144",
    "root": "a2790c76",
    "james anderson": "4897559c",
    "anderson": "4897559c",
    "jimmy anderson": "4897559c",
    "stuart broad": "9197d6ac",
    "broad": "9197d6ac",
    "jos buttler": "da5e0238",
    "buttler": "da5e0238",
    "jofra archer": "34392766",
    "archer": "34392766",
    "moeen ali": "6d42346c",
    "moeen": "6d42346c",
    "ali": "6d42346c",
    "adil rashid": "06f73e3e",
    "rashid": "06f73e3e",
    # Pakistan
    "babar azam": "d67e9cb6",
    "babar": "d67e9cb6",
    "shaheen afridi": "b8d80e78",
    "shaheen": "b8d80e78",
    "shaheen shah afridi": "b8d80e78",
    "mohammad rizwan": "b2dba132",
    "rizwan": "b2dba132",
    "shadab khan": "1e856a0e",
    "shadab": "1e856a0e",
    # South Africa
    "quinton de kock": "57e76f4c",
    "de kock": "57e76f4c",
    "quinton de kock": "57e76f4c",
    "kagiso rabada": "87840c2c",
    "rabada": "87840c2c",
    "anrich nortje": "2a728b94",
    "nortje": "2a728b94",
    "aiden markram": "8bd6ec02",
    "markram": "8bd6ec02",
    # New Zealand
    "kane williamson": "95a9316a",
    "williamson": "95a9316a",
    "trent boult": "467e4c8e",
    "boult": "467e4c8e",
    "trenty": "467e4c8e",
    "tim southee": "9887635c",
    "southee": "9887635c",
    "neesham": "40e2f776",
    "mitchell santner": "0ea75c2e",
    "santner": "0ea75c2e",
    # Sri Lanka
    "wanindu hasaranga": "a395e59c",
    "hasaranga": "a395e59c",
    "pwh de silva": "a395e59c",
    "lasith malinga": "7600c1de",
    "malinga": "7600c1de",
    "matheesha pathirana": "caec2f6e",
    "pathirana": "caec2f6e",
    # West Indies
    "chris gayle": "2e628878",
    "gayle": "2e628878",
    "universe boss": "2e628878",
    "kieron pollard": "2360342e",
    "pollard": "2360342e",
    "sunil narine": "1db8065e",
    "narine": "1db8065e",
    "shimron hetmyer": "1d74443e",
    "hetmyer": "1d74443e",
    # Bangladesh
    "shakib al hasan": "af48260c",
    "shakib": "af48260c",
    "mustafizur rahman": "4bba1bfc",
    "mustafizur": "4bba1bfc",
    "mushfiqur rahim": "e7cda48c",
    "mushfiqur": "e7cda48c",
    "mushfiq": "e7cda48c",
    # Afghanistan
    "rashid khan": "92072372",
    "mujeeb ur rahman": "64af829c",
    "mujeeb": "64af829c",
    "mohammad nabi": "b4f71de0",
    "nabi": "b4f71de0",
}


def fetch_people_csv():
    """Download Cricsheet's people.csv and return as list of dicts."""
    print(f"Fetching {CRICSHEET_PEOPLE_URL} ...")
    req = urllib.request.Request(CRICSHEET_PEOPLE_URL, headers={"User-Agent": "cricket-stats-game/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read().decode("utf-8")
    reader = csv.DictReader(io.StringIO(data))
    rows = list(reader)
    print(f"  Fetched {len(rows)} player records.")
    return rows


def _generate_aliases(name):
    """Generate plausible alias variations from a Cricsheet name.

    Cricsheet names are typically abbreviated like "V Kohli" or "MS Dhoni".
    We generate:
      - The full name as-is (lowercased)
      - Last name only (e.g. "kohli")
      - Initials + last name variants
    """
    aliases = set()
    name_lower = name.strip().lower()
    aliases.add(name_lower)

    parts = name_lower.split()
    if len(parts) < 2:
        return aliases

    last = parts[-1]
    aliases.add(last)

    # "v kohli" style (initials + last)
    if len(parts) == 2 and len(parts[0]) <= 2:
        aliases.add(f"{parts[0]} {last}")

    return aliases


def populate_aliases(con, people_rows):
    """Create and populate the player_aliases table."""
    con.execute("DROP TABLE IF EXISTS player_aliases")
    con.execute("""
        CREATE TABLE player_aliases (
            alias_name VARCHAR,
            player_id VARCHAR,
            unique_name VARCHAR
        )
    """)

    rows_to_insert = []
    identifier_to_name = {}

    for row in people_rows:
        identifier = row.get("identifier", "").strip()
        name = row.get("name", "").strip()
        unique_name = row.get("unique_name", "").strip() or name

        if not identifier or not name:
            continue

        identifier_to_name[identifier] = unique_name

        # Generate aliases from the Cricsheet name
        for alias in _generate_aliases(name):
            rows_to_insert.append((alias, identifier, unique_name))

    # Add extra manual aliases
    for alias, identifier in EXTRA_ALIASES.items():
        alias_lower = alias.strip().lower()
        unique_name = identifier_to_name.get(identifier, "")
        if unique_name:
            rows_to_insert.append((alias_lower, identifier, unique_name))

    # Deduplicate
    seen = set()
    unique_rows = []
    for alias, pid, uname in rows_to_insert:
        key = (alias, pid)
        if key not in seen:
            seen.add(key)
            unique_rows.append((alias, pid, uname))

    con.executemany(
        "INSERT INTO player_aliases (alias_name, player_id, unique_name) VALUES (?, ?, ?)",
        unique_rows,
    )

    count = con.execute("SELECT COUNT(*) FROM player_aliases").fetchone()[0]
    print(f"  Inserted {count} alias mappings into player_aliases.")

    # Show some sample aliases for verification
    samples = con.execute(
        "SELECT alias_name, unique_name FROM player_aliases "
        "WHERE alias_name IN ('kohli', 'dhoni', 'hasaranga', 'starc', 'de kock') "
        "ORDER BY alias_name"
    ).fetchall()
    if samples:
        print("  Sample aliases:")
        for alias, uname in samples:
            print(f"    {alias!r:25s} -> {uname}")


def main():
    parser = argparse.ArgumentParser(description="Ingest Cricsheet player register into DuckDB")
    parser.add_argument("--db-path", default="data/cricket.duckdb", help="Path to DuckDB database")
    args = parser.parse_args()

    db_path = args.db_path
    if not os.path.exists(db_path):
        print(f"Error: database not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    con = duckdb.connect(db_path)

    try:
        people_rows = fetch_people_csv()
        populate_aliases(con, people_rows)
        print("Done.")
    finally:
        con.close()


if __name__ == "__main__":
    main()

"""
game.py

Ties question_gen.py and name_match.py together into the actual playable
game.
"""

import duckdb

from question_gen import generate_target, evaluate_guess, DB_PATH
from name_match import resolve_player_fuzzy


def get_player_pick(con, q, already_picked_names):
    while True:
        typed = input("  Enter a player name: ").strip()
        if not typed:
            continue

        result = resolve_player_fuzzy(con, typed)

        if result["status"] == "not_found":
            print(f'"{typed}" wasn\'t found. Try another name.')
            continue

        if result["status"] == "ambiguous":
            candidates = result["candidates"]
            print("    Multiple matches — which one did you mean?")
            for i, c in enumerate(candidates, start=1):
                print(f"      {i}. {c[1]} ({c[2]}, {c[3]})")
            print(f"      {len(candidates)+1}. None of these — retype")

            choice = input("    Enter a number: ").strip()
            if not choice.isdigit():
                print("    Invalid choice.")
                continue
            choice = int(choice)
            if choice == len(candidates) + 1:
                continue
            if not (1 <= choice <= len(candidates)):
                print("    Invalid choice.")
                continue
            player = candidates[choice - 1]
        else:
            player = result["player"]

        player_name = player[1]

        if any(name == player_name for name, _ in already_picked_names):
            print(f"You've already picked {player_name}.")
            continue

        guess = evaluate_guess(
            con,
            player_name,
            q["stat"],
            q["format"],
            country=q["country"],
            role_bucket=q["role_bucket"],
        )

        if not guess["valid"]:
            print(f"{guess['reason']} Doesn't satisfy the constraints.")
            continue

        print(f"Locked in: {guess['player_name']}")
        return guess["player_name"], guess["value"]


def play_round(con):
    print("\nGenerating question...")
    q = generate_target(con)
    if q is None:
        print("Couldn't generate a fair question.")
        return

    print("\n" + q["question_text"] + "\n")

    while True:
        try:
            num_people = int(input("How many people are playing? "))
            if num_people >= 2:
                break
        except ValueError:
            pass
        print("Enter a number (minimum 2).")

    player_names = []
    for i in range(num_people):
        name = input(f"Enter name for Player {i+1}: ").strip() or f"Player {i+1}"
        player_names.append(name)

    results = {}

    for person in player_names:
        print(f"\n--- {person}'s Turn ---")
        picks = []
        total = 0
        for pick in range(q["num_players"]):
            print(f"Pick {pick+1}/{q['num_players']}")
            pname, value = get_player_pick(con, q, picks)
            picks.append((pname, value))
            total += value
        results[person] = {"picks": picks, "total": total}

    diffs = {p: abs(r["total"] - q["target"]) for p, r in results.items()}
    best = min(diffs.values())
    winners = [p for p, d in diffs.items() if d == best]

    print("\n===== REVEAL =====")
    print(f"Target: {q['target']}\n")

    for person in player_names:
        r = results[person]
        pick_display = ", ".join(
            f"{name} ({value})" for name, value in r["picks"]
        )
        print(f"{person}: {pick_display}")
        print(f"  Total = {r['total']} (off by {diffs[person]})\n")

    if len(winners) == 1:
        print(f"Winner: {winners[0]}!")
    else:
        print(f"Tied winners: {', '.join(winners)}!")


def main():
    con = duckdb.connect(DB_PATH, read_only=True)
    try:
        while True:
            play_round(con)
            if input("\nPlay another round? (y/n): ").strip().lower() != "y":
                break
    finally:
        con.close()


if __name__ == "__main__":
    main()

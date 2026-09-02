"""
game_persistence.py

Phase 4.4: writes and reads for the Postgres tables that give an
AUTHENTICATED user's game a permanent history -- games, game_players,
rounds, round_players, picks (all created by Phase 4.1's
0001_initial_schema.sql; nothing here creates a new table). Like
auth.py and profile.py, this module never imports flask -- api.py (the
live, session-based game engine) is the only caller, and it decides
WHEN to call these, never how the SQL itself is built.

Guest games never reach this module at all -- api.py only calls in here
once it already knows a real, signed-in user_id, so "no permanent
history for guests" is enforced by api.py simply never calling this,
not by a check inside it.

Design decisions worth being explicit about (also covered in api.py's
module docstring and the Phase 4.4 report):

- ONE seat per game is ever tied to an account: player_names[0], the
  first name entered in Player Setup -- the same seat the frontend's
  placeholder text ("Vishal", i.e. "you") already treats as the
  device's owner. Every other seat is a guest_name, exactly as today's
  pass-and-play design already treats every player after the first.
  This app has no per-seat login step, so there is no other information
  available to decide this from; a later phase could let a signed-in
  user explicitly claim a different seat if that's ever wanted.
- Every seat's guest_name is stored even for the account-linked seat --
  it is a denormalized snapshot of what that game actually displayed,
  independent of a display name changed afterwards, matching why
  picks.selected_name is denormalized too.
- Writes are batched at round/game boundaries only (see api.py's
  play_again()), never per-turn or per-pick -- "do not make Postgres
  responsible for every turn in real time" from the phase brief. A
  pick's `created_at` therefore reflects when its ROUND was persisted,
  not the exact moment it was typed; game_state.py has never tracked
  the latter, and synchronously writing on every keystroke-equivalent
  action is exactly what this phase says not to do.
- Each function that must leave the database internally consistent
  (a game's creation with its seats and first round; a round's
  completion with every player's result and picks) does all of its
  INSERT/UPDATE statements against one connection and calls conn.commit()
  exactly once, at the very end. Nothing above raises "commits" partway
  through, so an exception partway through a bundle leaves nothing
  behind for the caller's `with appdb.get_connection()` block to roll
  back on the way out.
- Every write that could plausibly be retried (a resumed session, a
  network retry) is an upsert keyed on the same unique constraint
  0001_initial_schema.sql already defined (rounds(game_id,
  round_number), round_players(round_id, game_player_id)), or a
  status-guarded UPDATE (games.status = 'in_progress' at completion
  time) -- calling the same function twice with the same arguments
  produces the same rows, not duplicates.

Phase 4.5: complete_game() also awards XP (see xp_service.py) to the
one seat (if any) tied to a real account, inside the SAME transaction
that marks the game finished -- "game finished" and "XP awarded" commit
together or not at all, and the exact status-guarded UPDATE above that
already made game completion single-fire is what makes the XP award
single-fire too.
"""

from psycopg.types.json import Jsonb

import xp_service

GAME_MODE_DEFAULT = "classic"


# ---------------------------------------------------------------------------
# Placement helpers -- purely a display field for persisted history.
# Neither of these touches, reads from, or feeds back into scoring.py or
# game_state.py: the live game's own winner detection (api.py's `won`
# boolean, `is_round_complete`, `can_start_next_round`, ...) is completely
# untouched by this module existing at all.
# ---------------------------------------------------------------------------

def _placements_by_difference(standings):
    """1-based rank by difference ascending (closest to the target wins);
    ties share a rank, matching how a real tie is already treated as a
    joint win elsewhere in this app."""
    ordered = sorted({s["difference"] for s in standings})
    rank = {diff: i + 1 for i, diff in enumerate(ordered)}
    return {s["participant_name"]: rank[s["difference"]] for s in standings}


def _placements_by_score_desc(cumulative_scores):
    """1-based rank by total game score descending; ties share a rank."""
    ordered = sorted(set(cumulative_scores.values()), reverse=True)
    rank = {score: i + 1 for i, score in enumerate(ordered)}
    return {name: rank[score] for name, score in cumulative_scores.items()}


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def start_persisted_game(conn, *, difficulty, rounds_total, player_names, owner_user_id, question, target):
    """
    Creates the games row, one game_players row per seat, and round 1's
    row -- all as ONE atomic unit (a single commit at the end). A
    persisted game is never observed with zero seats or zero rounds:
    either every insert below succeeds together, or none of them are
    kept, because nothing commits until all of them have run.

    `player_names[0]` becomes the account-linked seat when owner_user_id
    is not None (see the module docstring for why); every other name is
    a guest seat, same as this app's pass-and-play design already treats
    every player after the first.

    Returns (db_game_id, {player_name: game_player_id}, db_round_id).
    """
    game_row = conn.execute(
        """
        INSERT INTO games (status, game_mode, difficulty, rounds_total, started_at)
        VALUES ('in_progress', %s, %s, %s, now())
        RETURNING id
        """,
        [GAME_MODE_DEFAULT, difficulty, rounds_total],
    ).fetchone()
    db_game_id = game_row[0]

    player_ids = {}
    for i, name in enumerate(player_names):
        user_id = owner_user_id if i == 0 else None
        row = conn.execute(
            """
            INSERT INTO game_players (game_id, user_id, guest_name, player_order)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            [db_game_id, user_id, name, i],
        ).fetchone()
        player_ids[name] = row[0]

    round_row = conn.execute(
        """
        INSERT INTO rounds (game_id, round_number, status, question, target)
        VALUES (%s, 1, 'in_progress', %s, %s)
        RETURNING id
        """,
        [db_game_id, Jsonb(question), target],
    ).fetchone()
    db_round_id = round_row[0]

    conn.commit()
    return db_game_id, player_ids, db_round_id


def create_round(conn, db_game_id, round_number, question, target):
    """Persists a NEW round beginning (round 2 onward -- round 1 is
    created by start_persisted_game). Upserted on (game_id, round_number)
    so a retried call for the same round number never creates a second
    row for it."""
    row = conn.execute(
        """
        INSERT INTO rounds (game_id, round_number, status, question, target)
        VALUES (%s, %s, 'in_progress', %s, %s)
        ON CONFLICT (game_id, round_number) DO UPDATE SET
            question = EXCLUDED.question,
            target = EXCLUDED.target
        RETURNING id
        """,
        [db_game_id, round_number, Jsonb(question), target],
    ).fetchone()
    conn.commit()
    return row[0]


def complete_round(conn, round_id, standings, game_player_ids):
    """
    `standings` is exactly what api.py's _compute_standings() returns --
    server-computed only; nothing here ever takes a score, difference or
    pick value from a request body. `game_player_ids` is the
    {participant_name: game_player_id} mapping start_persisted_game()
    already returned for this game.

    One atomic bundle (single commit at the end): the round's own status,
    every player's round_players row, and every player's picks all land
    together, or none of them do.

    Idempotent: each player's round_players row is upserted on
    (round_id, game_player_id), and that player's picks are fully
    replaced (deleted, then re-inserted) rather than appended -- calling
    this twice with the same standings leaves the same rows behind, not
    duplicates.
    """
    conn.execute(
        "UPDATE rounds SET status = 'complete', completed_at = now() WHERE id = %s",
        [round_id],
    )

    placements = _placements_by_difference(standings)
    for s in standings:
        game_player_id = game_player_ids.get(s["participant_name"])
        if game_player_id is None:
            continue  # shouldn't happen -- every participant has a seat

        row = conn.execute(
            """
            INSERT INTO round_players
                (round_id, game_player_id, score, difference, hints_used, duration_seconds, placement)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (round_id, game_player_id) DO UPDATE SET
                score = EXCLUDED.score,
                difference = EXCLUDED.difference,
                hints_used = EXCLUDED.hints_used,
                duration_seconds = EXCLUDED.duration_seconds,
                placement = EXCLUDED.placement
            RETURNING id
            """,
            [
                round_id, game_player_id, s["score"], s["difference"], s["hintsUsed"],
                s.get("duration_seconds"), placements[s["participant_name"]],
            ],
        ).fetchone()
        round_player_id = row[0]

        conn.execute("DELETE FROM picks WHERE round_player_id = %s", [round_player_id])
        for pick in s["picks"]:
            conn.execute(
                """
                INSERT INTO picks (round_player_id, selected_name, stat_value)
                VALUES (%s, %s, %s)
                """,
                [round_player_id, pick["playerName"], pick["value"]],
            )

    conn.commit()


def _player_rounds_from_history(rounds_history, participant_name):
    """This one player's own per-round results, extracted from
    game_state.py's rounds_history -- exactly the shape xp.py's
    calculate_game_xp() wants: [{"difference", "hintsUsed",
    "duration_seconds"}, ...], one entry per round they actually played.
    Every field here came from api.py's _compute_standings(), never
    from a request body."""
    player_rounds = []
    for round_record in rounds_history:
        entry = next(
            (s for s in round_record["standings"] if s["participant_name"] == participant_name),
            None,
        )
        if entry is not None:
            player_rounds.append({
                "difference": entry["difference"],
                "hintsUsed": entry["hintsUsed"],
                "duration_seconds": entry.get("duration_seconds"),
            })
    return player_rounds


def complete_game(conn, db_game_id, cumulative_scores, game_player_ids, rounds_history, timer_seconds):
    """
    Marks the game finished and records each seat's final_score and
    placement -- server-computed cumulative_scores only, the same dict
    api.py's game_state.py has been accumulating round-by-round all
    along, never anything a request body could set.

    Idempotent: the UPDATE only touches a row that is still
    'in_progress'; a repeat call (api.py's own session-side guard
    already prevents this in practice -- see its module docstring) finds
    nothing to update and returns without touching game_players again,
    so a game's final numbers can't be silently overwritten by a second,
    stale completion attempt. The SAME guard is what makes the XP award
    below single-fire too (see the early return just below it).

    Returns xp_service.award_game_xp()'s result dict for the account-
    linked seat (if any), or None for a guest game / a no-op repeat call
    -- api.py forwards this straight into the response so the frontend
    can show a "+175 XP" / level-up moment right after the game that
    earned it.
    """
    updated = conn.execute(
        """
        UPDATE games SET status = 'finished', finished_at = now()
        WHERE id = %s AND status = 'in_progress'
        RETURNING id
        """,
        [db_game_id],
    ).fetchone()
    if updated is None:
        conn.commit()
        return None

    placements = _placements_by_score_desc(cumulative_scores)
    for name, game_player_id in game_player_ids.items():
        conn.execute(
            "UPDATE game_players SET final_score = %s, placement = %s WHERE id = %s",
            [cumulative_scores.get(name, 0), placements.get(name), game_player_id],
        )

    # Phase 4.5: award XP to the one seat (if any) tied to a real
    # account. A guest game has no game_players row with a non-null
    # user_id at all, so owner_row is None and this is a plain no-op --
    # "guests never receive persistent XP" needs no separate check here,
    # it falls out of guest seats never having a user_id in the first
    # place (see start_persisted_game()).
    xp_result = None
    owner_row = conn.execute(
        "SELECT id, user_id FROM game_players WHERE game_id = %s AND user_id IS NOT NULL",
        [db_game_id],
    ).fetchone()
    if owner_row is not None:
        owner_game_player_id, owner_user_id = owner_row
        owner_name = next(
            (name for name, gpid in game_player_ids.items() if gpid == owner_game_player_id),
            None,
        )
        if owner_name is not None:
            xp_result = xp_service.award_game_xp(
                conn,
                user_id=owner_user_id,
                db_game_id=db_game_id,
                player_rounds=_player_rounds_from_history(rounds_history, owner_name),
                placement=placements.get(owner_name),
                timer_seconds=timer_seconds,
            )

    conn.commit()
    return xp_result


# ---------------------------------------------------------------------------
# Reads -- both take user_id from the caller, which games_api.py always
# derives from auth_api.require_auth (the signed-in session), never from
# a client-supplied field. Ownership is enforced INSIDE the SQL itself
# (the WHERE/JOIN on gp.user_id), not as a check bolted on afterwards.
# ---------------------------------------------------------------------------

def list_games_for_user(conn, user_id, limit, offset):
    """This user's own COMPLETED games, newest-finished first. A game
    that's still in_progress (including one abandoned mid-play) never
    appears here -- only play_again() finishing the last round ever
    marks a game 'finished'."""
    rows = conn.execute(
        """
        SELECT g.id, g.game_mode, g.difficulty, g.rounds_total, g.status,
               g.created_at, g.finished_at, gp.final_score, gp.placement
        FROM games g
        JOIN game_players gp ON gp.game_id = g.id
        WHERE gp.user_id = %s AND g.status = 'finished'
        ORDER BY g.finished_at DESC NULLS LAST, g.id DESC
        LIMIT %s OFFSET %s
        """,
        [user_id, limit, offset],
    ).fetchall()
    return [
        {
            "gameId": r[0],
            "gameMode": r[1],
            "difficulty": r[2],
            "roundsTotal": r[3],
            "status": r[4],
            "createdAt": r[5].isoformat(),
            "finishedAt": r[6].isoformat() if r[6] else None,
            "finalScore": r[7],
            "placement": r[8],
        }
        for r in rows
    ]


def get_game_for_user(conn, user_id, game_id):
    """One game's full detail, or None if it doesn't exist OR belongs to
    someone else -- both cases are indistinguishable on purpose (see
    games_api.py), so this never confirms or denies that a game with
    this id exists for a different account."""
    game_row = conn.execute(
        """
        SELECT g.id, g.game_mode, g.difficulty, g.rounds_total, g.status,
               g.created_at, g.started_at, g.finished_at
        FROM games g
        JOIN game_players gp ON gp.game_id = g.id
        WHERE g.id = %s AND gp.user_id = %s
        """,
        [game_id, user_id],
    ).fetchone()
    if game_row is None:
        return None

    player_rows = conn.execute(
        """
        SELECT id, user_id, guest_name, player_order, final_score, placement
        FROM game_players
        WHERE game_id = %s
        ORDER BY player_order
        """,
        [game_id],
    ).fetchall()

    round_rows = conn.execute(
        """
        SELECT id, round_number, status, question, target, created_at, completed_at
        FROM rounds
        WHERE game_id = %s
        ORDER BY round_number
        """,
        [game_id],
    ).fetchall()

    rounds = []
    for rr in round_rows:
        round_id = rr[0]
        rp_rows = conn.execute(
            """
            SELECT game_player_id, score, difference, hints_used, placement
            FROM round_players
            WHERE round_id = %s
            """,
            [round_id],
        ).fetchall()
        rounds.append({
            "roundNumber": rr[1],
            "status": rr[2],
            "question": rr[3],
            "target": rr[4],
            "createdAt": rr[5].isoformat(),
            "completedAt": rr[6].isoformat() if rr[6] else None,
            "players": [
                {"gamePlayerId": p[0], "score": p[1], "difference": p[2], "hintsUsed": p[3], "placement": p[4]}
                for p in rp_rows
            ],
        })

    return {
        "gameId": game_row[0],
        "gameMode": game_row[1],
        "difficulty": game_row[2],
        "roundsTotal": game_row[3],
        "status": game_row[4],
        "createdAt": game_row[5].isoformat(),
        "startedAt": game_row[6].isoformat() if game_row[6] else None,
        "finishedAt": game_row[7].isoformat() if game_row[7] else None,
        "players": [
            {
                "gamePlayerId": p[0], "userId": p[1], "name": p[2],
                "playerOrder": p[3], "finalScore": p[4], "placement": p[5],
            }
            for p in player_rows
        ],
        "rounds": rounds,
    }

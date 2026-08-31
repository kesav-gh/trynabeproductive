"""
app.py

Web-based GUI for the cricket stats guessing game — a local Flask server
you run on your own machine (or later, via Termux on Android), played by
opening a browser to it.

Same pass-and-play design as the CLI version: after each player's turn,
a "pass the device" screen appears before the next player's picks are
shown, and again before the shared reveal — so nobody sees the previous
player's picks by clicking back.

Run with:  python3 app.py
Then open: http://localhost:5000  (or the phone's browser once on Termux)

Game state lives in the Flask session (a signed cookie) — fine for this
single-device, pass-and-play use case. The DB connection is opened once
at startup and reused (DuckDB handles concurrent reads fine).
"""

import duckdb
from flask import Flask, session, redirect, url_for, request
from markupsafe import escape

import question_gen
import name_match

app = Flask(__name__)
app.secret_key = "cricket-stats-game-local-only"  # local single-device app, not internet-facing

DB_PATH = question_gen.DB_PATH
con = duckdb.connect(DB_PATH, read_only=True)


# ---------------------------------------------------------------------------
# Shared page chrome
# ---------------------------------------------------------------------------

BASE_CSS = """
<style>
  :root { --bg: #0f1115; --card: #1a1d24; --accent: #3ddc97; --accent2: #ff6b6b;
          --text: #e8e8e8; --muted: #9a9fa8; }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .wrap { width: 100%; max-width: 460px; padding: 24px; }
  .card { background: var(--card); border-radius: 16px; padding: 28px 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.4); }
  h1 { font-size: 1.4rem; margin: 0 0 6px; }
  h2 { font-size: 1.1rem; color: var(--accent); margin: 0 0 16px; }
  p.muted { color: var(--muted); font-size: 0.9rem; }
  .question { background: #12151c; border-left: 3px solid var(--accent); padding: 14px 16px;
              border-radius: 8px; margin-bottom: 20px; font-size: 0.98rem; line-height: 1.4; }
  input[type=text], input[type=number] { width: 100%; padding: 12px 14px; border-radius: 10px;
         border: 1px solid #2a2e38; background: #12151c; color: var(--text); font-size: 1rem; margin-bottom: 12px; }
  button, .btn { display: inline-block; width: 100%; padding: 13px; border-radius: 10px; border: none;
         background: var(--accent); color: #0f1115; font-weight: 600; font-size: 1rem; cursor: pointer;
         text-align: center; text-decoration: none; margin-top: 4px; }
  /* Also match <a class="btn secondary">, which a bare button.secondary
     selector missed -- those links rendered as primary green. */
  button.secondary, .btn.secondary { background: #2a2e38; color: var(--text); }
  .error { color: var(--accent2); font-size: 0.9rem; margin: -6px 0 12px; }
  .candidate { display: block; padding: 12px 14px; margin-bottom: 8px; border-radius: 10px;
               border: 1px solid #2a2e38; background: #12151c; }
  .candidate label { display: flex; justify-content: space-between; cursor: pointer; }
  .pick-progress { color: var(--muted); font-size: 0.85rem; margin-bottom: 14px; }
  .pick-list { list-style: none; padding: 0; margin: 0 0 16px; }
  .pick-list li { padding: 8px 0; border-bottom: 1px solid #2a2e38; display: flex; justify-content: space-between; }
  .reveal-row { padding: 14px; background: #12151c; border-radius: 10px; margin-bottom: 12px; }
  .reveal-row.winner { border: 1px solid var(--accent); }
  .total { font-weight: 700; color: var(--accent); }
  .center { text-align: center; }
</style>
"""


def page(title, body, subtitle=None):
    sub = f'<h2>{subtitle}</h2>' if subtitle else ""
    return f"""
    <!DOCTYPE html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{title}</title>{BASE_CSS}</head>
    <body><div class="wrap"><div class="card">
        <h1>Cricket Stats Guessing Game</h1>
        {sub}
        {body}
    </div></div></body></html>
    """


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

@app.route("/", methods=["GET"])
def setup():
    return page("Setup", """
        <form method="post" action="/start">
          <p class="muted">Enter each player's name (2 or more), comma-separated.</p>
          <input type="text" name="names" placeholder="Kesav, Sam, ..." required>
          <button type="submit">Start Game</button>
        </form>
    """)


@app.route("/start", methods=["POST"])
def start():
    names = [n.strip() for n in request.form.get("names", "").split(",") if n.strip()]
    if len(names) < 2:
        return page("Setup", """
            <p class="error">Need at least 2 players.</p>
            <form method="post" action="/start">
              <input type="text" name="names" placeholder="Kesav, Sam, ..." required>
              <button type="submit">Start Game</button>
            </form>
        """)

    q = question_gen.generate_target(con)
    if q is None:
        return page("Setup", """
            <p class="error">Couldn't generate a fair question — try again.</p>
            <a class="btn" href="/">Back</a>
        """)

    session["player_names"] = names
    session["question"] = q
    session["current_player_idx"] = 0
    session["picks"] = {name: [] for name in names}  # name -> [(player_name, value), ...]
    session["error"] = None
    return redirect(url_for("handoff"))


# ---------------------------------------------------------------------------
# Pass-and-play handoff checkpoints
# ---------------------------------------------------------------------------

@app.route("/handoff")
def handoff():
    names = session.get("player_names")
    idx = session.get("current_player_idx", 0)
    if not names:
        return redirect(url_for("setup"))

    if idx >= len(names):
        return page("Reveal Time", """
            <p class="muted">Everyone's picks are in. Pass the device around so everyone can see the reveal together.</p>
            <a class="btn" href="/reveal">Show Reveal</a>
        """)

    person = names[idx]
    return page("Pass the Device", f"""
        <p class="muted">Pass the device to</p>
        <h2 style="font-size:1.6rem;">{escape(person)}</h2>
        <a class="btn" href="/pick">It's my turn</a>
    """)


# ---------------------------------------------------------------------------
# Picking
# ---------------------------------------------------------------------------

def _current_player():
    """Whose turn it is, or None once every player has finished picking."""
    names = session["player_names"]
    idx = session["current_player_idx"]
    if idx >= len(names):
        return None
    return names[idx]


@app.route("/pick", methods=["GET"])
def pick():
    q = session.get("question")
    if not q:
        return redirect(url_for("setup"))

    person = _current_player()
    if person is None:
        return redirect(url_for("handoff"))
    my_picks = session["picks"][person]
    pick_num = len(my_picks) + 1
    error = session.pop("error", None)

    picks_html = "".join(
        f'<li><span>{escape(name)}</span><span class="total">{value}</span></li>'
        for name, value in my_picks
    ) or "<li><span class='muted'>No picks yet</span></li>"

    error_html = f'<p class="error">{escape(error)}</p>' if error else ""

    safe_person = escape(person)
    return page(f"{safe_person}'s Turn", f"""
        <div class="question">{q['question_text']}</div>
        <p class="pick-progress">Pick {pick_num}/{q['num_players']}</p>
        <ul class="pick-list">{picks_html}</ul>
        {error_html}
        <form method="post" action="/pick">
          <input type="text" name="typed" placeholder="Enter last name..." autofocus required>
          <button type="submit">Submit</button>
        </form>
    """, subtitle=f"{safe_person}'s Turn")


@app.route("/pick", methods=["POST"])
def pick_submit():
    typed = request.form.get("typed", "").strip()
    return _resolve_and_route(typed)


@app.route("/pick_ambiguous", methods=["POST"])
def pick_ambiguous_submit():
    choice = request.form.get("choice")
    candidates = session.get("candidates", [])
    if choice is None or not choice.isdigit() or not (0 <= int(choice) < len(candidates)):
        session["error"] = "Invalid selection — try again."
        return redirect(url_for("pick"))
    player_name = candidates[int(choice)][1]
    return _score_and_route(player_name)


def _resolve_and_route(typed):
    if not typed:
        session["error"] = "Enter a name."
        return redirect(url_for("pick"))

    result = name_match.resolve_player_fuzzy(con, typed)

    if result["status"] == "not_found":
        session["error"] = f'"{escape(typed)}" wasn\'t found. Try the last name.'
        return redirect(url_for("pick"))

    if result["status"] == "ambiguous":
        session["candidates"] = result["candidates"]
        candidates_html = "".join(
            f'''<div class="candidate">
                  <label><input type="radio" name="choice" value="{i}" required style="margin-right:10px;">
                  <span>{escape(c[1])} — {escape(c[2])}, {escape(c[3])}</span></label>
                </div>'''
            for i, c in enumerate(result["candidates"])
        )
        q = session["question"]
        return page("Which one?", f"""
            <div class="question">{q['question_text']}</div>
            <p class="muted">Multiple matches for "{escape(typed)}" — which one did you mean?</p>
            <form method="post" action="/pick_ambiguous">
              {candidates_html}
              <button type="submit">Confirm</button>
              <a class="btn secondary" href="/pick" style="margin-top:8px;">None of these — retype</a>
            </form>
        """)

    return _score_and_route(result["player"][1])


def _score_and_route(player_name):
    person = _current_player()
    if person is None:
        return redirect(url_for("handoff"))
    q = session["question"]
    already = session["picks"][person]

    if any(name == player_name for name, _ in already):
        session["error"] = f"You've already picked {escape(player_name)}."
        return redirect(url_for("pick"))

    guess = question_gen.evaluate_guess(
        con, player_name, q["stat"], q["format"],
        country=q["country"], role_bucket=q["role_bucket"],
    )
    if not guess["valid"]:
        session["error"] = guess["reason"]
        return redirect(url_for("pick"))

    already.append((guess["player_name"], guess["value"]))
    session["picks"][person] = already
    session.modified = True

    if len(already) >= q["num_players"]:
        session["current_player_idx"] += 1
        return redirect(url_for("handoff"))

    return redirect(url_for("pick"))


# ---------------------------------------------------------------------------
# Reveal
# ---------------------------------------------------------------------------

@app.route("/reveal")
def reveal():
    q = session.get("question")
    picks = session.get("picks")
    if not q or not picks:
        return redirect(url_for("setup"))

    # Pass-and-play: no totals are shown until every player has finished.
    names = session.get("player_names", [])
    if session.get("current_player_idx", 0) < len(names):
        return redirect(url_for("handoff"))

    results = {name: sum(v for _, v in plist) for name, plist in picks.items()}
    diffs = {name: abs(total - q["target"]) for name, total in results.items()}
    best = min(diffs.values())
    winners = {name for name, d in diffs.items() if d == best}

    rows = ""
    for name in session["player_names"]:
        pick_str = ", ".join(f"{escape(n)} ({v})" for n, v in picks[name])
        is_winner = "winner" if name in winners else ""
        rows += f"""
        <div class="reveal-row {is_winner}">
          <strong>{escape(name)}</strong>{' 🏆' if name in winners else ''}<br>
          <span class="muted">{pick_str}</span><br>
          <span class="total">Total: {results[name]}</span>
          <span class="muted"> (off by {diffs[name]})</span>
        </div>"""

    winner_line = (f"Winner: {escape(winners.pop())}!" if len(winners) == 1
                    else f"Joint winners: {escape(', '.join(sorted(winners)))}!")

    return page("Reveal", f"""
        <p class="muted">Target was</p>
        <h2 style="font-size:1.8rem;">{q['target']}</h2>
        {rows}
        <p class="center" style="font-size:1.1rem; margin-top:16px;"><strong>{winner_line}</strong></p>
        <a class="btn" href="/play_again">Play Another Round</a>
        <a class="btn secondary" href="/" style="margin-top:8px;">New Game (change players)</a>
    """, subtitle="Reveal")


@app.route("/play_again")
def play_again():
    names = session.get("player_names")
    if not names:
        return redirect(url_for("setup"))

    q = question_gen.generate_target(con)
    if q is None:
        return page("Oops", """
            <p class="error">Couldn't generate a fair question — try again.</p>
            <a class="btn" href="/play_again">Retry</a>
        """)

    session["question"] = q
    session["current_player_idx"] = 0
    session["picks"] = {name: [] for name in names}
    return redirect(url_for("handoff"))


if __name__ == "__main__":
    # Bind to localhost only. This is a single-device pass-and-play app, so it
    # never needs to be reachable from the network -- and host="0.0.0.0" together
    # with debug=True exposed the Werkzeug debugger, and with it arbitrary code
    # execution, to everyone on the same Wi-Fi.
    app.run(debug=True, host="127.0.0.1", port=5000)

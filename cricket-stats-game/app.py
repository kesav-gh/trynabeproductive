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
from flask import Flask, session, redirect, url_for, request, render_template_string, jsonify

import question_gen
import name_match

app = Flask(__name__)
app.secret_key = "cricket-stats-game-local-only"  # local single-device app, not internet-facing

DB_PATH = question_gen.DB_PATH
con = duckdb.connect(DB_PATH, read_only=True)


def _start_fresh_question(names):
    """
    Generate a new question and reset per-round state (picks, whose turn
    it is) — shared by /play_again and /reset_question, since both do
    the same thing, just triggered from different points in the flow.
    Returns the new question dict, or None if generation failed.
    """
    q = question_gen.generate_target(con)
    if q is None:
        return None
    session["question"] = q
    session["current_player_idx"] = 0
    session["picks"] = {name: [] for name in names}
    return q


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
  button.secondary { background: #2a2e38; color: var(--text); }
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
  #suggestions { margin: -6px 0 12px; }
  .suggestion { padding: 10px 14px; border-radius: 8px; background: #12151c;
                border: 1px solid #2a2e38; margin-bottom: 6px; cursor: pointer;
                display: flex; justify-content: space-between; align-items: center; }
  .suggestion:active { background: #232732; }
  .suggestion span:last-child { font-size: 0.8rem; }
  .question-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.btn.reset-btn {
    width: auto;
    padding: 8px 10px;
    margin: 0;
    background: var(--accent);
    color: #0f1115;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    transition: transform 0.15s ease, filter 0.15s ease;
}

.btn.reset-btn:hover {
    filter: brightness(1.08);
}
</style>
"""


def page(title, body, subtitle=None):
    sub = f'<h2>{subtitle}</h2>' if subtitle else ""
    return render_template_string(f"""
    <!DOCTYPE html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{title}</title>{BASE_CSS}</head>
    <body><div class="wrap"><div class="card">
        <h1>Cricket Stats Guessing Game</h1>
        {sub}
        {body}
    </div></div></body></html>
    """)


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
        <h2 style="font-size:1.6rem;">{person}</h2>
        <a class="btn" href="/pick">It's my turn</a>
    """)


# ---------------------------------------------------------------------------
# Picking
# ---------------------------------------------------------------------------

def _current_player():
    names = session["player_names"]
    idx = session["current_player_idx"]
    return names[idx]


@app.route("/pick", methods=["GET"])
def pick():
    q = session.get("question")
    if not q:
        return redirect(url_for("setup"))

    person = _current_player()
    my_picks = session["picks"][person]
    pick_num = len(my_picks) + 1
    error = session.pop("error", None)

    picks_html = "".join(
        f'<li><span>{name}</span><span class="total">{value}</span></li>'
        for name, value in my_picks
    ) or "<li><span class='muted'>No picks yet</span></li>"

    error_html = f'<p class="error">{error}</p>' if error else ""

    return page(f"{person}'s Turn", f"""
        <div class="question-header">
    <h2>Current Question</h2>

    <a class="btn secondary reset-btn"
       href="/reset_question"
       title="Generate a New Question"
       onclick="return confirm('This discards the current question and everyone\\'s picks so far. Continue?')">
        ↻
    </a>
</div>

<div class="question">
    {q['question_text']}
</div>
        <p class="pick-progress">Pick {pick_num}/{q['num_players']}</p>
        <ul class="pick-list">{picks_html}</ul>
        {error_html}
        <form method="post" action="/pick" id="pick-form" autocomplete="off">
          <input type="text" name="typed" id="typed-input" placeholder="Start typing a last name..." autofocus required>
          <div id="suggestions"></div>
          <button type="submit">Submit</button>
        </form>
        <script>
        (function() {{
          const input = document.getElementById('typed-input');
          const box = document.getElementById('suggestions');
          let timer = null;

          input.addEventListener('input', function() {{
            clearTimeout(timer);
            const q = input.value.trim();
            if (q.length < 2) {{ box.innerHTML = ''; return; }}
            timer = setTimeout(function() {{
              fetch('/api/search_players?q=' + encodeURIComponent(q))
                .then(r => r.json())
                .then(function(players) {{
                  box.innerHTML = players.map(function(p) {{
                    return '<div class="suggestion" data-name="' + p.name.replace(/"/g,'&quot;') + '">'
                         + '<span>' + p.name + '</span>'
                         + '<span class="muted">' + p.country + ', ' + p.role + '</span>'
                         + '</div>';
                  }}).join('');
                  box.querySelectorAll('.suggestion').forEach(function(el) {{
                    el.addEventListener('click', function() {{
                      input.value = el.getAttribute('data-name');
                      box.innerHTML = '';
                      document.getElementById('pick-form').submit();
                    }});
                  }});
                }});
            }}, 200);
          }});
        }})();
        </script>
    """, subtitle=f"{person}'s Turn")


@app.route("/api/search_players")
def api_search_players():
    """
    Powers the live autocomplete dropdown on the pick page. Filters by
    the CURRENT question's constraints — safe here because this only
    populates suggestions; the actual submit still goes through
    resolve_player_fuzzy() -> evaluate_guess() unchanged, so a typed
    exact name that doesn't fit still gets a proper rejection message
    rather than silently vanishing.
    """
    q = session.get("question")
    query = request.args.get("q", "")
    if not q:
        return jsonify([])

    results = name_match.search_players(
        con, query,
        format_=q["format"], country=q["country"], role_bucket=q["role_bucket"],
    )
    return jsonify([
        {"name": r[1], "country": r[2], "role": r[3]} for r in results
    ])


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
        session["error"] = f'"{typed}" wasn\'t found. Try the last name.'
        return redirect(url_for("pick"))

    if result["status"] == "ambiguous":
        session["candidates"] = result["candidates"]
        candidates_html = "".join(
            f'''<div class="candidate">
                  <label><input type="radio" name="choice" value="{i}" required style="margin-right:10px;">
                  <span>{c[1]} — {c[2]}, {c[3]}</span></label>
                </div>'''
            for i, c in enumerate(result["candidates"])
        )
        q = session["question"]
        return page("Which one?", f"""
            <div class="question">{q['question_text']}</div>
            <p class="muted">Multiple matches for "{typed}" — which one did you mean?</p>
            <form method="post" action="/pick_ambiguous">
              {candidates_html}
              <button type="submit">Confirm</button>
              <a class="btn secondary" href="/pick" style="margin-top:8px;">None of these — retype</a>
            </form>
        """)

    return _score_and_route(result["player"][1])


def _score_and_route(player_name):
    person = _current_player()
    q = session["question"]
    already = session["picks"][person]

    if any(name == player_name for name, _ in already):
        session["error"] = f"You've already picked {player_name}."
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

    results = {name: sum(v for _, v in plist) for name, plist in picks.items()}
    diffs = {name: abs(total - q["target"]) for name, total in results.items()}
    best = min(diffs.values())
    winners = {name for name, d in diffs.items() if d == best}

    rows = ""
    for name in session["player_names"]:
        pick_str = ", ".join(f"{n} ({v})" for n, v in picks[name])
        is_winner = "winner" if name in winners else ""
        rows += f"""
        <div class="reveal-row {is_winner}">
          <strong>{name}</strong>{' 🏆' if name in winners else ''}<br>
          <span class="muted">{pick_str}</span><br>
          <span class="total">Total: {results[name]}</span>
          <span class="muted"> (off by {diffs[name]})</span>
        </div>"""

    winner_line = (f"Winner: {winners.pop()}!" if len(winners) == 1
                    else f"Joint winners: {', '.join(sorted(winners))}!")

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

    q = _start_fresh_question(names)
    if q is None:
        return page("Oops", """
            <p class="error">Couldn't generate a fair question — try again.</p>
            <a class="btn" href="/play_again">Retry</a>
        """)
    return redirect(url_for("handoff"))


@app.route("/reset_question")
def reset_question():
    """
    Discard the current question (e.g. it's too hard/unfair) and start a
    fresh one. Per design: this wipes everyone's current-round picks —
    keeping them would mean judging players against a question that no
    longer exists, which breaks the "everyone chases the same target"
    fairness the whole game depends on.
    """
    names = session.get("player_names")
    if not names:
        return redirect(url_for("setup"))

    q = _start_fresh_question(names)
    if q is None:
        return page("Oops", """
            <p class="error">Couldn't generate a fair question — try again.</p>
            <a class="btn" href="/reset_question">Retry</a>
        """)
    return redirect(url_for("handoff"))


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

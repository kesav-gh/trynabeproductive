# Cricket Stats Guessing Game

A pass-and-play game for you and your friends, played from one device.

The game gives you a stats question with some constraints — e.g. *"Name 3
bowlers from Pakistan whose combined ODI wickets are closest to 340"* —
and each player takes a turn naming players to try and hit that number.
Closest total wins.

Runs as a small local web app (Flask) — no internet connection needed
once it's set up, no accounts, nothing leaves your device.

## What's in here

- `app.py` — the web app / GUI. Run this one.
- `question_gen.py` — generates questions and scores guesses against real
  data.
- `name_match.py` — resolves whatever name you type (typos, nicknames,
  ambiguous names) to a real player.
- `game.py` — a terminal-only version of the same game, if you don't want
  the browser GUI.

## Requirements

- Python 3
- `duckdb` and `flask` (`pip install duckdb flask`)
- The player/match database — see below, **not included in this repo**
  (it's too large for git).

## Getting the database

The game runs on real ball-by-ball cricket data from
[Cricsheet](https://cricsheet.org), pulled in via the open-source
[cricket-mcp](https://github.com/mavaali/cricket-mcp) project.

```bash
git clone https://github.com/mavaali/cricket-mcp.git
cd cricket-mcp
npm install
npm run ingest    # downloads Cricsheet's data, builds a local database
npm run enrich -- --csv data/player_meta.csv    # adds player country/role info
```

This produces `data/cricket.duckdb`. Copy that file into this project's
`data/` folder, next to `app.py`.

> Takes a few minutes and needs Node.js installed. This step only needs
> to be done once — after that, just reuse the same `.duckdb` file.

## Running it — on a laptop

```bash
pip install duckdb flask
python3 app.py
```

Then open **http://localhost:5000** in a browser.

## Running it — on Android (via Termux)

1. Install [Termux](https://f-droid.org/en/packages/com.termux/) from
   F-Droid (not the Play Store version — it's outdated).
2. Set it up:
   ```bash
   pkg update
   pkg install python git
   pip install duckdb flask
   ```
3. Get the code:
   ```bash
   git clone https://github.com/kesav-gh/trynabeproductive.git
   cd trynabeproductive/cricket-stats-game
   ```
4. Get `cricket.duckdb` onto the phone (build it as above and transfer it
   over USB, or however works for you) and place it in a `data/` folder
   here.
5. Run it:
   ```bash
   python3 app.py
   ```
6. Open your phone's browser to **http://localhost:5000**

## How a round works

1. The app shows a question with a target number and some constraints
   (format, sometimes country/role).
2. Players take turns, one device passed around — the screen clears
   between turns so nobody sees the previous player's picks.
3. Each player names the required number of players (3 or 5) who fit the
   constraints. Typing just a last name is enough — the game resolves
   typos and asks you to pick if a name's ambiguous.
4. Once everyone's in, the totals are revealed together — closest to the
   target wins.

## Notes / limitations

- Data covers international and IPL cricket from roughly 2002 onward —
  Cricsheet doesn't have ball-by-ball data further back than that.
- This is built for casual local pass-and-play, not multiple people
  playing remotely at once.

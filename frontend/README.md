# Cricket Stats Game -- Frontend

React + TypeScript + Vite + Tailwind CSS v4. This is the new UI foundation.

**It is not connected to the backend.** Every screen runs on mock data from
`src/mocks/data.ts`. The existing Flask app in `../cricket-stats-game/` is
untouched and continues to work exactly as it did.

## Running it

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

> Use `localhost`, not `127.0.0.1` -- Vite binds to the IPv6 loopback (`[::1]`)
> by default, so `127.0.0.1:5173` will refuse the connection.

The Flask app runs separately and independently:

```bash
cd cricket-stats-game
py app.py
```

Flask owns port 5000, Vite owns 5173. They do not interact.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm run typecheck` | Typecheck only |
| `npm run preview` | Serve the built `dist/` locally |

## Structure

```
src/
  components/
    ui/         Button, Card, Badge, TextField, StatTile, ProgressTrack
    layout/     AppShell (page frame, nav, skip link), PageHeader
    game/       QuestionCard, PickList, CandidateList
  pages/        One file per screen
  mocks/        Mock data -- the only thing to replace when wiring up Flask
  types/        Domain types mirroring the Python engine
  lib/          cn() class-name helper
```

## Routes

| Path | Screen |
| --- | --- |
| `/` | Home |
| `/modes` | Game mode selection |
| `/setup` | Player setup |
| `/handoff` | Pass device |
| `/game` | Question and picking |
| `/search` | Player search |
| `/reveal` | Results |
| `/scoreboard` | Scoreboard |

## Design notes

The interface is deliberately dark-only. This is a game played on one phone
passed around a room, and a bright screen is worse in that setting. Tokens
live in the `@theme` block at the top of `src/index.css`; nothing hardcodes a
colour outside it.

Accessibility work already in place: a skip link, visible focus rings on every
interactive element, native radios behind the custom candidate picker,
`aria-pressed` on toggle buttons, `role="alert"` on validation errors, and a
`prefers-reduced-motion` block that disables transitions. All controls clear a
44px minimum touch target.

## Wiring it to Flask later

`src/types/game.ts` already matches the shapes the Python produces
(`generate_target`, `resolve_player_fuzzy`, `evaluate_guess`). Replacing the
imports from `src/mocks/data.ts` with real fetch calls is the whole job --
no component should need to change.

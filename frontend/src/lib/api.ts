/**
 * Client for the real game API (cricket-stats-game/api.py).
 *
 * Requests go to relative /api/... paths. Vite's dev server proxies those
 * to the Flask backend on :5000 (see vite.config.ts) -- so from the
 * browser's point of view every request is same-origin. That sidesteps
 * cross-origin cookie rules entirely: no CORS headers, no SameSite
 * gymnastics, and the Flask session cookie that holds game state just
 * works, the same way it already does for the original HTML pages.
 *
 * Every mutating call attaches the CSRF header the backend now requires
 * for it (Phase 4.4.1 extended csrf.py's existing double-submit-cookie
 * check from just the auth endpoints to every state-changing game
 * route) -- same csrfHeaders() helper authApi.ts and profileApi.ts
 * already use, not a second CSRF mechanism. GET requests (state,
 * reveal, history, search) need no token; the backend doesn't require
 * one for them either.
 */

import { request } from "@/lib/http";
import { csrfHeaders } from "@/lib/csrf";
import {
  ApiError,
  type Difficulty,
  type GameHistory,
  type GameState,
  type ModeConfig,
  type RevealResult,
  type SearchResult,
  type TimerMode,
} from "@/types/api";

const post = <T>(path: string, payload?: unknown) =>
  request<T>(path, {
    method: "POST",
    body: payload !== undefined ? JSON.stringify(payload) : "{}",
    headers: csrfHeaders(),
  });

const get = <T>(path: string) => request<T>(path);

export interface StartGamePayload {
  playerNames: string[];
  mode?: ModeConfig;
  /** All three are optional and default server-side to "normal" /
   *  "casual" / unlimited -- omitting them reproduces Phase 2's behaviour
   *  exactly. Not yet exposed through any UI control; see PlayerSetup.tsx. */
  difficulty?: Difficulty;
  timerMode?: TimerMode;
  roundsTotal?: 1 | 3 | 5 | 10;
}

export const gameApi = {
  start: (payload: StartGamePayload) => post<GameState>("/api/game/start", payload),

  state: () => get<GameState>("/api/game/state"),

  pick: (typed: string) => post<GameState>("/api/game/pick", { typed }),

  ambiguous: (playerId: string) => post<GameState>("/api/game/ambiguous", { playerId }),

  nextTurn: () => post<GameState>("/api/game/next-turn"),

  hint: (type: "country" | "role" | "range") => post<GameState>("/api/game/hint", { type }),

  reveal: () => get<RevealResult>("/api/game/reveal"),

  playAgain: () => post<GameState>("/api/game/play-again"),

  history: () => get<GameHistory>("/api/game/history"),
};

export const playerApi = {
  search: (q: string) => get<SearchResult>("/api/player/search?q=" + encodeURIComponent(q)),
};

export { ApiError };

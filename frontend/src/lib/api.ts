/**
 * Client for the real game API (cricket-stats-game/api.py).
 *
 * Requests go to relative /api/... paths. Vite's dev server proxies those
 * to the Flask backend on :5000 (see vite.config.ts) -- so from the
 * browser's point of view every request is same-origin. That sidesteps
 * cross-origin cookie rules entirely: no CORS headers, no SameSite
 * gymnastics, and the Flask session cookie that holds game state just
 * works, the same way it already does for the original HTML pages.
 */

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Is it running?");
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, "SERVER_ERROR", "The server sent back something unexpected.");
  }

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? "Something went wrong.");
  }

  return (body as { data: T }).data;
}

const post = <T>(path: string, payload?: unknown) =>
  request<T>(path, { method: "POST", body: payload !== undefined ? JSON.stringify(payload) : "{}" });

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

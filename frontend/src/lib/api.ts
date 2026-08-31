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
  type GameState,
  type ModeConfig,
  type RevealResult,
  type SearchResult,
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
}

export const gameApi = {
  start: (payload: StartGamePayload) => post<GameState>("/api/game/start", payload),

  state: () => get<GameState>("/api/game/state"),

  pick: (typed: string) => post<GameState>("/api/game/pick", { typed }),

  ambiguous: (playerId: string) => post<GameState>("/api/game/ambiguous", { playerId }),

  nextTurn: () => post<GameState>("/api/game/next-turn"),

  reveal: () => get<RevealResult>("/api/game/reveal"),

  playAgain: () => post<GameState>("/api/game/play-again"),
};

export const playerApi = {
  search: (q: string) => get<SearchResult>("/api/player/search?q=" + encodeURIComponent(q)),
};

export { ApiError };

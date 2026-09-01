/**
 * Client for Phase 4.4's read-only game history endpoints
 * (cricket-stats-game/games_api.py). Deliberately separate from
 * lib/api.ts's gameApi -- that talks to the LIVE, session-based game
 * (guest or not); this talks only to an authenticated user's permanent
 * Postgres history, and is never called at all while status is "guest"
 * (see pages/GameHistory.tsx, which redirects guests away).
 */

import { request } from "@/lib/http";

export interface GameHistoryEntry {
  gameId: number;
  gameMode: string;
  difficulty: string;
  roundsTotal: number | null;
  status: "in_progress" | "finished" | "abandoned";
  createdAt: string;
  finishedAt: string | null;
  finalScore: number | null;
  placement: number | null;
}

export interface GameHistoryList {
  games: GameHistoryEntry[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface GameDetailPlayer {
  gamePlayerId: number;
  userId: number | null;
  name: string;
  playerOrder: number;
  finalScore: number | null;
  placement: number | null;
}

export interface GameDetailRoundPlayer {
  gamePlayerId: number;
  score: number | null;
  difference: number | null;
  hintsUsed: number;
  placement: number | null;
}

export interface GameDetailRound {
  roundNumber: number;
  status: "in_progress" | "complete";
  question: { questionText?: string } & Record<string, unknown>;
  target: number;
  createdAt: string;
  completedAt: string | null;
  players: GameDetailRoundPlayer[];
}

export interface GameDetail {
  gameId: number;
  gameMode: string;
  difficulty: string;
  roundsTotal: number | null;
  status: "in_progress" | "finished" | "abandoned";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  players: GameDetailPlayer[];
  rounds: GameDetailRound[];
}

export const gamesApi = {
  history: (limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    const qs = params.toString();
    return request<GameHistoryList>("/api/games/history" + (qs ? "?" + qs : ""));
  },

  get: (gameId: number) => request<GameDetail>("/api/games/" + gameId),
};

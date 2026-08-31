/**
 * Wire types for the real backend (cricket-stats-game/api.py).
 *
 * These are deliberately separate from types/game.ts, which the
 * still-mocked screens (Game Mode Selection, Scoreboard) keep using.
 * Merging them would force those screens to model fields the real
 * engine cannot actually provide -- see the note on LivePick below.
 */

import type { Format, PickCount, Question, RoleBucket, Stat } from "@/types/game";

export interface PlayerCandidate {
  playerId: string;
  playerName: string;
  country: string;
  playingRole: string;
}

/**
 * A committed pick, as the real engine returns it. evaluate_guess() in
 * question_gen.py only ever returns a name and a number -- not the
 * player's id, country or role -- so a live pick genuinely carries less
 * information than the mock Pick type in types/game.ts did.
 */
export interface LivePick {
  playerName: string;
  value: number;
}

export interface PendingAmbiguous {
  query: string;
  candidates: PlayerCandidate[];
}

export interface PickError {
  code:
    | "EMPTY_INPUT"
    | "NOT_FOUND"
    | "DUPLICATE"
    | "REJECTED"
    | "INVALID_SELECTION";
  message: string;
}

/**
 * The one state shape returned by start / state / pick / ambiguous /
 * next-turn / play-again. Every mutating endpoint returns the full state
 * so the frontend only ever needs one render path: re-render from
 * whatever came back.
 */
export interface GameState {
  question: Question;
  numPlayers: PickCount;
  currentPlayerIndex: number;
  /** null once every player has finished -- time to head to the reveal. */
  currentPlayerName: string | null;
  totalPlayers: number;
  /** The CURRENT player's own picks only. Nobody else's picks are ever
   *  sent to the browser before the reveal -- see api.py's module docstring. */
  myPicks: LivePick[] | null;
  pendingAmbiguous: PendingAmbiguous | null;
  /** Set only on a /pick or /ambiguous response that was rejected. */
  pickError: PickError | null;
  /** True only on a /pick or /ambiguous response that just completed a turn. */
  turnComplete: boolean;
}

export interface RevealStanding {
  participantName: string;
  picks: LivePick[];
  total: number;
  difference: number;
  won: boolean;
}

export interface RevealResult {
  question: Question;
  target: number;
  standings: RevealStanding[];
}

export interface SearchResult {
  results: PlayerCandidate[];
}

export interface ModeConfig {
  numPlayers?: PickCount;
  stat?: Stat;
  format?: Format;
  country?: string;
  roleBucket?: RoleBucket;
}

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NO_FAIR_QUESTION"
  | "NO_ACTIVE_GAME"
  | "GAME_COMPLETE"
  | "GAME_IN_PROGRESS"
  | "NO_PENDING_AMBIGUOUS"
  | "NOT_FOUND"
  | "SERVER_ERROR";

/** Thrown by the api client for every non-2xx response. */
export class ApiError extends Error {
  code: ApiErrorCode | string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

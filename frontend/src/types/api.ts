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
    | "INVALID_SELECTION"
    | "TURN_EXPIRED";
  message: string;
}

export type Difficulty = "easy" | "normal" | "hard" | "insane";
export type TimerMode = "casual" | "normal" | "blitz";

export interface HintResult {
  type: "country" | "role" | "range";
  text: string;
}

export interface HintsUsed {
  country: number;
  role: number;
  range: number;
}

/**
 * The one state shape returned by start / state / pick / ambiguous /
 * next-turn / play-again / hint. Every mutating endpoint returns the full
 * state so the frontend only ever needs one render path: re-render from
 * whatever came back.
 */
export interface GameState {
  gameId: string;
  status: "in_progress" | "finished";
  currentRound: number;
  /** null means unlimited -- Play Again works forever, same as Phase 2. */
  roundsTotal: number | null;
  difficulty: Difficulty;
  timerMode: TimerMode;
  /** null in Casual mode -- there is no clock. */
  timerSeconds: number | null;
  /** Authoritative, server-computed seconds left on the CURRENT player's
   *  turn. Poll GET /api/game/state to refresh it -- this is a snapshot
   *  at response time, not a client-side ticking clock. */
  turnSecondsRemaining: number | null;
  question: Question;
  numPlayers: PickCount;
  currentPlayerIndex: number;
  /** null once every player has finished -- time to head to the reveal. */
  currentPlayerName: string | null;
  totalPlayers: number;
  /** The CURRENT player's own picks only. Nobody else's picks are ever
   *  sent to the browser before the reveal -- see api.py's module docstring. */
  myPicks: LivePick[] | null;
  myHintsUsed: HintsUsed | null;
  /** Points deducted per hint used, echoed from the backend so this
   *  number is never hardcoded on the frontend. */
  hintPenalty: number;
  pendingAmbiguous: PendingAmbiguous | null;
  cumulativeScores: Record<string, number>;
  /** Set on a /pick, /ambiguous, /hint or /state response that was
   *  rejected, or that reports a timed-out turn. */
  pickError: PickError | null;
  /** True only on a response that just completed (or expired) a turn. */
  turnComplete: boolean;
  /** Only present on a /hint response. */
  hint: HintResult | null;
  /** null for a guest game (nothing is ever persisted for one) --
   *  true/false only for a signed-in user's game (Phase 4.4); false
   *  means this round/game's result didn't make it into permanent
   *  history because of a transient database issue. */
  historySyncOk: boolean | null;
  /** Phase 4.5 -- non-null only on the one play-again response that
   *  just finished an authenticated game. */
  xp: XpAward | null;
}

export interface XpAward {
  /** The net XP this game actually credited -- 0 on a duplicate/retried
   *  completion request, never a client-suppliable value. */
  xpAwarded: number;
  newXp: number;
  oldLevel: number;
  newLevel: number;
  leveledUp: boolean;
}

export interface ScoreBreakdown {
  closeness: number;
  exactBonus: number;
  speedBonus: number;
  hintPenalty: number;
  total: number;
}

export interface RevealStanding {
  participantName: string;
  picks: LivePick[];
  total: number;
  difference: number;
  won: boolean;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  hintsUsed: number;
}

export interface OverallStanding {
  participantName: string;
  score: number;
}

export interface RevealResult {
  question: Question;
  target: number;
  currentRound: number;
  roundsTotal: number | null;
  isFinalRound: boolean;
  standings: RevealStanding[];
  /** Preview of cumulative scores including this round -- nothing is
   *  persisted until Play Again is called. */
  overallStandings: OverallStanding[];
}

export interface GameHistory {
  gameId: string;
  status: "in_progress" | "finished";
  currentRound: number;
  roundsTotal: number | null;
  cumulativeScores: Record<string, number>;
  overallStandings: OverallStanding[];
  rounds: {
    roundNumber: number;
    question: Question;
    standings: RevealStanding[];
    completedAt: number;
  }[];
}

export interface SearchResult {
  results: (PlayerCandidate & { confidence: number })[];
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
  | "SESSION_EXPIRED"
  | "INVALID_GAME_STATE"
  | "GAME_COMPLETE"
  | "GAME_FINISHED"
  | "GAME_IN_PROGRESS"
  | "NO_PENDING_AMBIGUOUS"
  | "HINT_ALREADY_USED"
  | "NOT_FOUND"
  | "DATABASE_ERROR"
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

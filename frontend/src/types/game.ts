/**
 * Domain types.
 *
 * These deliberately mirror the shapes the existing Python engine already
 * produces, so that swapping mock data for real Flask responses later is a
 * change of source, not a change of model.
 *
 *   Stat / Format / RoleBucket  -> question_gen.STAT_FUNCS, FORMATS, ROLE_BUCKETS
 *   Question                    -> question_gen.generate_target()
 *   ResolveResult               -> name_match.resolve_player_fuzzy()
 *   GuessResult                 -> question_gen.evaluate_guess()
 */

/** The four things a question can ask you to total up. */
export type Stat = "runs" | "wickets" | "centuries" | "five_fers";

/** "IPL" is not a real Cricsheet match_type -- the engine treats it as T20
 *  filtered by event_name. Kept here because the UI presents it as a format. */
export type Format = "IT20" | "ODI" | "Test" | "IPL";

/** The five buckets the engine collapses Cricsheet's finer roles into. */
export type RoleBucket =
  | "Opening Batter"
  | "Batter"
  | "Bowler"
  | "Allrounder"
  | "Wicketkeeper Batter";

/** How many players each person must name. The engine accepts 3 or 5 only. */
export type PickCount = 3 | 5;

export interface Question {
  questionText: string;
  stat: Stat;
  format: Format;
  /** null means "any country" -- the engine biases toward this. */
  country: string | null;
  roleBucket: RoleBucket;
  numPlayers: PickCount;
  target: number;
}

export interface Cricketer {
  playerId: string;
  playerName: string;
  country: string;
  /** Cricsheet's raw playing_role. "NA" where the dataset has no value. */
  playingRole: string;
}

/** One accepted pick: the resolved player plus the stat value they contributed. */
export interface Pick {
  player: Cricketer;
  value: number;
}

export interface Participant {
  id: string;
  name: string;
  picks: Pick[];
}

/** What name resolution returns for a typed string. */
export type ResolveResult =
  | { status: "exact"; player: Cricketer }
  | { status: "ambiguous"; candidates: Cricketer[] }
  | { status: "not_found" };

/** What constraint-checking returns for a resolved player. */
export type GuessResult =
  | { valid: true; player: Cricketer; value: number }
  | { valid: false; reason: string; player?: Cricketer };

/**
 * A selectable game mode. Every field maps onto an argument the existing
 * generate_target() already accepts, so no mode here promises behaviour the
 * engine cannot currently deliver.
 */
export interface GameMode {
  id: string;
  name: string;
  tagline: string;
  description: string;
  numPlayers: PickCount;
  /** null = let the engine choose at random. */
  stat: Stat | null;
  format: Format | null;
  estimatedMinutes: number;
  difficulty: "Casual" | "Standard" | "Hard";
  available: boolean;
}

/** A finished round, as shown on the scoreboard. */
export interface RoundResult {
  roundNumber: number;
  question: Question;
  standings: {
    participantId: string;
    participantName: string;
    total: number;
    difference: number;
    won: boolean;
  }[];
}

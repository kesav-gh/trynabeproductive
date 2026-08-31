import type {
  Cricketer,
  GameMode,
  Participant,
  Question,
  RoundResult,
} from "@/types/game";

/**
 * Mock data for previewing the UI without a backend.
 *
 * Player names, ids, countries and roles below were taken from the real
 * DuckDB dataset, so the shapes and edge cases (players with a role of "NA",
 * five different Jadejas) are the ones the UI will actually meet in
 * production. Stat values are plausible rather than exact.
 */

/** Headline figures from the built database. These are real. */
export const datasetSummary = {
  matches: 22_734,
  deliveries: 11_506_545,
  players: 15_091,
  countries: 106,
  earliestYear: 2002,
};

export const mockQuestion: Question = {
  questionText:
    "Name 5 players (ODI, players from India, role: Bowler, stat: wickets) whose combined wickets is closest to 412.",
  stat: "wickets",
  format: "ODI",
  country: "India",
  roleBucket: "Bowler",
  numPlayers: 5,
  target: 412,
};

/** The pool the Player Search screen filters over. */
export const mockCricketers: Cricketer[] = [
  { playerId: "ba607b88", playerName: "V Kohli", country: "India", playingRole: "Top order Batter" },
  { playerId: "d2c2b2d5", playerName: "SR Tendulkar", country: "India", playingRole: "Top order Batter" },
  { playerId: "e087956b", playerName: "BA Stokes", country: "England", playingRole: "Allrounder" },
  { playerId: "a1f30c72", playerName: "RA Jadeja", country: "India", playingRole: "Allrounder" },
  { playerId: "5c1e9d04", playerName: "JJ Bumrah", country: "India", playingRole: "Bowler" },
  { playerId: "7b2a4e19", playerName: "R Ashwin", country: "India", playingRole: "Bowler" },
  { playerId: "c93b17ad", playerName: "B Kumar", country: "India", playingRole: "Bowler" },
  { playerId: "2d84f5b1", playerName: "Mohammed Shami", country: "India", playingRole: "Bowler" },
  { playerId: "9e57c3a8", playerName: "YS Chahal", country: "India", playingRole: "Bowler" },
  { playerId: "4a6d02fe", playerName: "KL Rahul", country: "India", playingRole: "Wicketkeeper Batter" },
  { playerId: "8f21b6c5", playerName: "RG Sharma", country: "India", playingRole: "Opening Batter" },
  { playerId: "1c7e9a30", playerName: "SPD Smith", country: "Australia", playingRole: "Top order Batter" },
  { playerId: "6b3f8d24", playerName: "PJ Cummins", country: "Australia", playingRole: "Bowler" },
  { playerId: "0e5a71cb", playerName: "MA Starc", country: "Australia", playingRole: "Bowler" },
  { playerId: "3d90fe62", playerName: "JM Anderson", country: "England", playingRole: "Bowler" },
  { playerId: "b47c1e08", playerName: "Rashid Khan", country: "Afghanistan", playingRole: "Bowler" },
  { playerId: "f10d6b93", playerName: "Shakib Al Hasan", country: "Bangladesh", playingRole: "Allrounder" },
  { playerId: "72ae4c15", playerName: "K Rabada", country: "South Africa", playingRole: "Bowler" },
  { playerId: "aa93b0d7", playerName: "TA Boult", country: "New Zealand", playingRole: "Bowler" },
  { playerId: "5f8c2e41", playerName: "Shaheen Shah Afridi", country: "Pakistan", playingRole: "Bowler" },
];

/**
 * The five Jadejas, straight out of the real database. This is the case the
 * disambiguation screen exists for. Note the three with no role recorded.
 */
export const mockAmbiguousCandidates: Cricketer[] = [
  { playerId: "a1f30c72", playerName: "RA Jadeja", country: "India", playingRole: "Allrounder" },
  { playerId: "6c04b8e2", playerName: "Dharmendrasinh Jadeja", country: "India", playingRole: "Bowler" },
  { playerId: "b7e13d95", playerName: "Vishvaraj Jadeja", country: "India", playingRole: "NA" },
  { playerId: "22fa5c60", playerName: "Aditya Jadeja", country: "India", playingRole: "NA" },
  { playerId: "e9018b34", playerName: "RR Jadeja", country: "India", playingRole: "NA" },
];

const find = (name: string): Cricketer =>
  mockCricketers.find((c) => c.playerName === name)!;

export const mockParticipants: Participant[] = [
  {
    id: "p1",
    name: "Vishal",
    picks: [
      { player: find("JJ Bumrah"), value: 149 },
      { player: find("R Ashwin"), value: 156 },
      { player: find("B Kumar"), value: 141 },
    ],
  },
  {
    id: "p2",
    name: "Kesav",
    picks: [
      { player: find("Mohammed Shami"), value: 195 },
      { player: find("YS Chahal"), value: 121 },
    ],
  },
  { id: "p3", name: "Aditya", picks: [] },
];

export const mockGameModes: GameMode[] = [
  {
    id: "classic",
    name: "Classic",
    tagline: "The original",
    description:
      "Five picks each, and the game chooses the format, role and stat. The broadest mix of questions.",
    numPlayers: 5,
    stat: null,
    format: null,
    estimatedMinutes: 12,
    difficulty: "Standard",
    available: true,
  },
  {
    id: "quickfire",
    name: "Quickfire",
    tagline: "Three picks, one round",
    description:
      "Three picks instead of five. Same question engine, roughly half the time at the table.",
    numPlayers: 3,
    stat: null,
    format: null,
    estimatedMinutes: 6,
    difficulty: "Casual",
    available: true,
  },
  {
    id: "wickets",
    name: "Wicket Hunt",
    tagline: "Bowlers only",
    description:
      "Every question is about wickets. Rewards knowing the attack, not just the top order.",
    numPlayers: 5,
    stat: "wickets",
    format: null,
    estimatedMinutes: 12,
    difficulty: "Hard",
    available: true,
  },
  {
    id: "ipl",
    name: "IPL Special",
    tagline: "League cricket only",
    description:
      "Restricted to Indian Premier League matches. Pakistan is excluded, as players have been barred from the league since 2008.",
    numPlayers: 5,
    stat: null,
    format: "IPL",
    estimatedMinutes: 12,
    difficulty: "Standard",
    available: true,
  },
  {
    id: "milestones",
    name: "Milestones",
    tagline: "Hundreds and five-fers",
    description:
      "Only centuries and five-wicket hauls. Small numbers, so a single wrong pick costs you the round.",
    numPlayers: 3,
    stat: "centuries",
    format: null,
    estimatedMinutes: 8,
    difficulty: "Hard",
    available: true,
  },
  {
    id: "survival",
    name: "Survival",
    tagline: "Coming soon",
    description:
      "Elimination across successive rounds. Needs multi-round state the engine does not track yet.",
    numPlayers: 3,
    stat: null,
    format: null,
    estimatedMinutes: 20,
    difficulty: "Hard",
    available: false,
  },
];

export const mockRounds: RoundResult[] = [
  {
    roundNumber: 3,
    question: mockQuestion,
    standings: [
      { participantId: "p1", participantName: "Vishal", total: 407, difference: 5, won: true },
      { participantId: "p2", participantName: "Kesav", total: 433, difference: 21, won: false },
      { participantId: "p3", participantName: "Aditya", total: 366, difference: 46, won: false },
    ],
  },
  {
    roundNumber: 2,
    question: {
      questionText:
        "Name 3 players (Test, role: Allrounder, stat: five fers) whose combined five fers is closest to 25.",
      stat: "five_fers",
      format: "Test",
      country: null,
      roleBucket: "Allrounder",
      numPlayers: 3,
      target: 25,
    },
    standings: [
      { participantId: "p2", participantName: "Kesav", total: 26, difference: 1, won: true },
      { participantId: "p3", participantName: "Aditya", total: 22, difference: 3, won: false },
      { participantId: "p1", participantName: "Vishal", total: 31, difference: 6, won: false },
    ],
  },
  {
    roundNumber: 1,
    question: {
      questionText:
        "Name 5 players (IPL, players from India, role: Batter, stat: runs) whose combined runs is closest to 18400.",
      stat: "runs",
      format: "IPL",
      country: "India",
      roleBucket: "Batter",
      numPlayers: 5,
      target: 18_400,
    },
    standings: [
      { participantId: "p1", participantName: "Vishal", total: 18_512, difference: 112, won: true },
      { participantId: "p3", participantName: "Aditya", total: 17_980, difference: 420, won: false },
      { participantId: "p2", participantName: "Kesav", total: 19_045, difference: 645, won: false },
    ],
  },
];

/** Stand-in for name_match.resolve_player_fuzzy(). Substring match only. */
export function mockSearch(query: string): Cricketer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return mockCricketers.filter(
    (c) =>
      c.playerName.toLowerCase().includes(q) ||
      c.country.toLowerCase().includes(q),
  );
}

export type Id = string;
export type Role = 'admin' | 'scorekeeper';
export type BestOf = 1 | 3 | 5;
export type GameScore = readonly [number, number];
export type Stage = 'setup' | 'groups' | 'playoffs' | 'finished' | 'cancelled';
export type Division = 'championship' | 'consolation';
export type ResultKind = 'played' | 'walkover' | 'bye' | 'void';
export type Experience = 'unknown' | 'beginner' | 'casual' | 'club' | 'varsity';
export type RegistrationStatus = 'registered' | 'waitlisted' | 'withdrawn';
export type PaymentMethod = 'cash' | 'card' | null;

export interface SeedEntry {
  entryId: Id;
  playerId: Id;
  name: string;
  seedValue: number;
}

export interface GroupPlan {
  groupIndex: number;
  entryIds: Id[];
}

export interface GroupOption {
  sizes: number[];
  matchCount: number;
  minimumGroupMatches: number;
}

export interface GroupResult {
  entryA: Id;
  entryB: Id;
  kind: 'played' | 'walkover' | 'void';
  games: GameScore[];
  winnerId: Id | null;
}

export interface Standing {
  entryId: Id;
  rank: number | null;
  played: number;
  walkovers: number;
  wins: number;
  losses: number;
  gameDifference: number;
  pointDifference: number;
}

export type Slot =
  | { kind: 'entry'; entryId: Id }
  | { kind: 'winner'; matchKey: string }
  | { kind: 'empty' };

export interface PlannedMatch {
  key: string;
  round: number;
  sequence: number;
  a: Slot;
  b: Slot;
  bestOf: BestOf;
}

export type ScoreValidation =
  | { ok: true; winner: 'a' | 'b'; winsA: number; winsB: number }
  | { ok: false; message: string };

export type MutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'forbidden' | 'conflict' | 'invalid' | 'blocked' | 'network'; message: string };

export interface ScoreInput {
  matchId: Id;
  expectedVersion: number;
  games: GameScore[];
}

export interface UnplayedResultInput {
  matchId: Id;
  expectedVersion: number;
  kind: 'walkover' | 'void';
  winnerEntryId: Id | null;
  reason: string;
}

export interface ScoreboardMatch {
  id: Id;
  version: number;
  eventId: Id;
  label: string;
  nameA: string | null;
  nameB: string | null;
  tableNumber: number | null;
  bestOf: BestOf;
  state: 'pending' | 'active' | 'completed' | 'bye' | 'void';
  kind: ResultKind | null;
  games: GameScore[];
  winner: 'a' | 'b' | null;
  ready: boolean;
  stage?: Exclude<Stage, 'setup' | 'finished' | 'cancelled'>;
  division?: Division | null;
  groupIndex?: number | null;
  sequence?: number;
}

export interface Scoreboard {
  eventId: Id;
  eventName: string;
  stage: Stage;
  revision: number;
  matches: ScoreboardMatch[];
}

export interface Profile {
  id: Id;
  displayName: string;
  role: Role;
  createdAt: string;
}

export interface Player {
  id: Id;
  name: string;
  label: string | null;
  experience: Experience;
  rating: number;
  ratedMatchCount: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tournament {
  id: Id;
  name: string;
  startsAt: string;
  bookingMinutes: number;
  entryFeeCents: number;
  registrationCap: number;
  tableCount: number;
  groupBestOf: BestOf;
  playoffBestOf: BestOf;
  finalBestOf: BestOf;
  qualifiersPerGroup: number;
  consolationEnabled: boolean;
  state: Stage;
  drawSeed: number | null;
  drawMode: 'random' | 'balanced' | null;
  lotOrders: Record<string, Id[]>;
  revision: number;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: Id;
  tournamentId: Id;
  playerId: Id;
  registrationStatus: RegistrationStatus;
  checkedIn: boolean;
  paid: boolean;
  paymentMethod: PaymentMethod;
  amountPaidCents: number;
  discountCents: number;
  paymentNote: string | null;
  baseFeeCents: number;
  groupIndex: number | null;
  seedValue: number | null;
  seedPosition: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  createdAt: string;
  updatedAt: string;
  player?: Player;
}

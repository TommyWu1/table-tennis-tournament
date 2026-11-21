import { createGroupDraw, seedEntries, type DrawMode, type DrawPlayer } from '../domain/groups';
import { calculateStandings } from '../domain/standings';
import type { BestOf, Division, Entry, GameScore, GroupPlan, GroupResult, Id, MutationResult, Player, Slot, Standing, Tournament } from '../types';

export interface TournamentMatch {
  id: Id;
  eventId: Id;
  matchKey: string;
  stage: 'groups' | 'playoffs';
  division: Division | null;
  groupIndex: number | null;
  round: number;
  sequence: number;
  a: Slot;
  b: Slot;
  entryAId: Id | null;
  entryBId: Id | null;
  bestOf: BestOf;
  tableNumber: number | null;
  state: 'pending' | 'active' | 'completed' | 'bye' | 'void';
  kind: 'played' | 'walkover' | 'bye' | 'void' | null;
  games: GameScore[];
  winnerEntryId: Id | null;
  reason: string | null;
  version: number;
  updatedAt: string | null;
}

export interface TournamentState {
  players: Player[];
  tournaments: Tournament[];
  entries: Entry[];
  matches: TournamentMatch[];
}

export interface ResolvedSlot {
  resolved: boolean;
  entryId: Id | null;
}

export function getTournament(state: TournamentState, eventId: Id): Tournament | undefined {
  return state.tournaments.find((tournament) => tournament.id === eventId);
}

export function getEntries(state: TournamentState, eventId: Id): Entry[] {
  return state.entries
    .filter((entry) => entry.tournamentId === eventId)
    .map((entry) => ({ ...entry, player: state.players.find((player) => player.id === entry.playerId) }));
}

export function getPlayer(state: TournamentState, playerId: Id): Player | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function getEntry(state: TournamentState, entryId: Id): Entry | undefined {
  return state.entries.find((entry) => entry.id === entryId);
}

export function eligibleEntries(state: TournamentState, eventId: Id): Entry[] {
  return getEntries(state, eventId).filter((entry) =>
    entry.registrationStatus === 'registered' && entry.checkedIn);
}

export function getDrawPlayers(state: TournamentState, eventId: Id): DrawPlayer[] {
  return eligibleEntries(state, eventId).flatMap((entry) => {
    const player = getPlayer(state, entry.playerId);
    return player ? [{
      entryId: entry.id,
      playerId: player.id,
      name: player.name,
      rating: player.rating,
      ratedMatchCount: player.ratedMatchCount,
      experience: player.experience,
    }] : [];
  });
}

export function previewGroups(
  state: TournamentState,
  eventId: Id,
  sizes: number[],
  mode: DrawMode,
  seed: number,
): GroupPlan[] {
  const drawPlayers = getDrawPlayers(state, eventId);
  const seeded = seedEntries(drawPlayers, seed);
  return createGroupDraw(seeded, sizes, mode, seed);
}

export function groupEntryIds(state: TournamentState, eventId: Id, groupIndex: number): Id[] {
  return state.entries
    .filter((entry) => entry.tournamentId === eventId && entry.groupIndex === groupIndex)
    .map((entry) => entry.id);
}

export function groupResults(state: TournamentState, eventId: Id, groupIndex: number): GroupResult[] {
  return state.matches
    .filter((match) => match.eventId === eventId && match.stage === 'groups' && match.groupIndex === groupIndex
      && (match.kind === 'played' || match.kind === 'walkover' || match.kind === 'void'))
    .map((match) => ({
      entryA: match.entryAId ?? '',
      entryB: match.entryBId ?? '',
      kind: match.kind as 'played' | 'walkover' | 'void',
      games: match.games,
      winnerId: match.winnerEntryId,
    }));
}

export function groupStandings(
  state: TournamentState,
  eventId: Id,
  groupIndex: number,
): Standing[] {
  const tournament = getTournament(state, eventId);
  const ids = groupEntryIds(state, eventId, groupIndex);
  const lots = tournament?.lotOrders[String(groupIndex)];
  return calculateStandings(ids, groupResults(state, eventId, groupIndex), lots);
}

export function groupsReadyForPlayoffs(state: TournamentState, eventId: Id): MutationResult<{ standings: Record<number, Standing[]> }> {
  const tournament = getTournament(state, eventId);
  if (!tournament || tournament.state !== 'groups') {
    return { ok: false, code: 'blocked', message: 'The event is not in group play.' };
  }
  const unfinished = state.matches.filter((match) =>
    match.eventId === eventId && match.stage === 'groups'
    && match.state !== 'completed' && match.state !== 'void');
  if (unfinished.length) {
    return { ok: false, code: 'blocked', message: `${unfinished.length} group match${unfinished.length === 1 ? '' : 'es'} still need a result.` };
  }
  const groupNumbers = [...new Set(state.entries
    .filter((entry) => entry.tournamentId === eventId && entry.groupIndex !== null)
    .map((entry) => entry.groupIndex as number))].sort((a, b) => a - b);
  const standings: Record<number, Standing[]> = {};
  for (const groupIndex of groupNumbers) {
    const group = groupStandings(state, eventId, groupIndex);
    if (group.some((standing) => standing.rank === null)) {
      return { ok: false, code: 'blocked', message: `Group ${groupIndex} has a tie that needs a recorded draw of lots.` };
    }
    standings[groupIndex] = group;
  }
  return { ok: true, value: { standings } };
}

export function resolveSlot(slot: Slot, matches: readonly TournamentMatch[]): ResolvedSlot {
  if (slot.kind === 'entry') return { resolved: true, entryId: slot.entryId };
  if (slot.kind === 'empty') return { resolved: true, entryId: null };
  const feeder = matches.find((match) => match.matchKey === slot.matchKey);
  if (!feeder || (feeder.state !== 'completed' && feeder.state !== 'bye' && feeder.state !== 'void')) {
    return { resolved: false, entryId: null };
  }
  return { resolved: true, entryId: feeder.winnerEntryId };
}

export function resolveMatchEntries(
  match: TournamentMatch,
  matches: readonly TournamentMatch[],
): { resolved: boolean; entryAId: Id | null; entryBId: Id | null } {
  const a = resolveSlot(match.a, matches);
  const b = resolveSlot(match.b, matches);
  return { resolved: a.resolved && b.resolved, entryAId: a.entryId, entryBId: b.entryId };
}

export function tournamentChampion(state: TournamentState, eventId: Id, division: Division): Entry | undefined {
  const divisionMatches = state.matches
    .filter((match) => match.eventId === eventId && match.stage === 'playoffs' && match.division === division);
  const final = divisionMatches.sort((a, b) => b.round - a.round || a.sequence - b.sequence)[0];
  if (final?.winnerEntryId) return getEntry(state, final.winnerEntryId);
  if (divisionMatches.length === 0) {
    const eventEntries = state.entries.filter((entry) =>
      entry.tournamentId === eventId && entry.groupIndex !== null && entry.registrationStatus !== 'withdrawn');
    if (eventEntries.length === 1) return eventEntries[0];
  }
  return undefined;
}

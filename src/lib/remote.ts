import * as api from './api';
import { getSupabase } from './supabase';
import type { EntryRow, MatchRow, PlayerRow, ProfileRow, TournamentRow } from './database.types';
import { groupsReadyForPlayoffs, type DemoMatch, type DemoState } from './demo';
import { buildBracket, orderQualifiers, type QualifiedEntry } from '../domain/bracket';
import type { Entry, Experience, GameScore, GroupPlan, MutationResult, Player, Profile, Scoreboard, ScoreboardMatch, Tournament, Slot } from '../types';

export interface RemoteWorkspace extends DemoState {
  profile: Profile;
  scoreboard?: Scoreboard;
}

export function remoteError(error: unknown): MutationResult<never> {
  const message = error instanceof Error ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message : 'Could not connect. Check your connection and try again.';
  const prefix = message.match(/^(forbidden|conflict|invalid|blocked):\s*/i);
  const code = prefix ? prefix[1].toLowerCase() as 'forbidden' | 'conflict' | 'invalid' | 'blocked'
    : /permission denied|not provisioned/i.test(message) ? 'forbidden' : 'network';
  return { ok: false, code, message: message.replace(/^(forbidden|conflict|invalid|blocked|network):\s*/i, '') };
}

export function mapPlayer(row: PlayerRow): Player {
  return { id: row.id, name: row.name, label: row.label, experience: row.experience,
    rating: Number(row.rating), ratedMatchCount: row.rated_match_count, archived: row.archived,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

export function mapTournament(row: TournamentRow): Tournament {
  return { id: row.id, name: row.name, startsAt: row.starts_at, bookingMinutes: row.booking_minutes,
    entryFeeCents: row.entry_fee_cents, registrationCap: row.registration_cap, tableCount: row.table_count,
    groupBestOf: row.group_best_of, playoffBestOf: row.playoff_best_of, finalBestOf: row.final_best_of,
    qualifiersPerGroup: row.qualifiers_per_group, consolationEnabled: row.consolation_enabled,
    state: row.state, drawSeed: row.draw_seed, drawMode: row.draw_mode,
    lotOrders: row.lot_orders as Record<string, string[]>, revision: row.revision,
    finalizedAt: row.finalized_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function mapEntry(row: EntryRow): Entry {
  return { id: row.id, tournamentId: row.tournament_id, playerId: row.player_id,
    registrationStatus: row.registration_status, checkedIn: row.checked_in, paid: row.paid,
    paymentMethod: row.payment_method, amountPaidCents: row.amount_paid_cents,
    discountCents: row.discount_cents, paymentNote: row.payment_note, baseFeeCents: row.base_fee_cents,
    groupIndex: row.group_index, seedValue: row.seed_value === null ? null : Number(row.seed_value),
    seedPosition: row.seed_position, ratingBefore: row.rating_before === null ? null : Number(row.rating_before),
    ratingAfter: row.rating_after === null ? null : Number(row.rating_after),
    createdAt: row.created_at, updatedAt: row.updated_at };
}

export function mapMatches(rows: MatchRow[]): DemoMatch[] {
  const keys = new Map(rows.map(row => [row.id, row.match_key]));
  const slot = (entryId: string | null, feederId: string | null): Slot => {
    // Preserve feeder provenance even after its winner has advanced into this slot.
    if (feederId) return { kind: 'winner', matchKey: keys.get(feederId) ?? feederId };
    return entryId ? { kind: 'entry', entryId } : { kind: 'empty' };
  };
  return rows.map(row => ({ id: row.id, eventId: row.tournament_id, matchKey: row.match_key,
    stage: row.stage, division: row.division, groupIndex: row.group_index, round: row.round,
    sequence: row.sequence, a: slot(row.entry_a_id, row.feeder_a_match_id),
    b: slot(row.entry_b_id, row.feeder_b_match_id), entryAId: row.entry_a_id, entryBId: row.entry_b_id,
    bestOf: row.best_of, tableNumber: row.table_number, state: row.status, kind: row.result_kind,
    games: row.games ?? [], winnerEntryId: row.winner_entry_id, reason: row.result_note ?? null,
    version: row.version, updatedAt: row.updated_at }));
}

export async function getRemoteProfile(): Promise<Profile | null> {
  const client = getSupabase();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) return null;
  const { data, error } = await client.from('profiles').select('*').eq('id', session.user.id).single();
  if (error || !data) throw new Error('forbidden: Your account needs an organizer or scorekeeper profile. Ask the club administrator to set it up.');
  const row: ProfileRow = data;
  return { id: row.id, displayName: row.display_name, role: row.role, createdAt: row.created_at };
}

export async function signIn(email: string, password: string): Promise<MutationResult<Profile>> {
  try {
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    const profile = await getRemoteProfile();
    if (!profile) throw new Error('forbidden: Please sign in again.');
    return { ok: true, value: profile };
  } catch (error) { return remoteError(error); }
}

export async function signOut(): Promise<MutationResult<void>> {
  try {
    const { error } = await getSupabase().auth.signOut();
    if (error) throw error;
    return { ok: true, value: undefined };
  } catch (error) { return remoteError(error); }
}

export async function loadRemoteWorkspace(eventId?: string): Promise<RemoteWorkspace | null> {
  const profile = await getRemoteProfile();
  if (!profile) return null;
  if (profile.role === 'scorekeeper') {
    // This role never reads the roster, fees, directory, or admin fixture graph.
    const scoreboard = await api.getScoreboard(eventId);
    return { profile, players: [], tournaments: [], entries: [], matches: [], scoreboard };
  }
  const [playerRows, tournamentRows] = await Promise.all([api.listPlayers(), api.listTournaments()]);
  const selected = eventId ?? tournamentRows.find(row => row.state === 'groups' || row.state === 'playoffs')?.id
    ?? tournamentRows[0]?.id;
  const [entryRows, matchRows] = selected
    ? await Promise.all([api.listEntries(selected), api.listMatches(selected)]) : [[], []];
  return { profile, players: playerRows.map(mapPlayer), tournaments: tournamentRows.map(mapTournament),
    entries: entryRows.map(mapEntry), matches: mapMatches(matchRows) };
}

export type TournamentUpdate = Partial<Pick<Tournament,
  'name' | 'startsAt' | 'bookingMinutes' | 'entryFeeCents' | 'registrationCap' | 'tableCount'
  | 'groupBestOf' | 'playoffBestOf' | 'finalBestOf' | 'qualifiersPerGroup' | 'consolationEnabled' | 'lotOrders'>>;
export type EntryUpdate = Partial<Pick<Entry,
  'checkedIn' | 'paid' | 'paymentMethod' | 'amountPaidCents' | 'discountCents' | 'paymentNote' | 'registrationStatus'>>;
export type PlayerInput = { name: string; label?: string | null; experience?: Experience };

export interface OrganizerActions {
  createPlayer(input: PlayerInput): Promise<MutationResult<Player>>;
  updatePlayer(playerId: string, patch: Partial<PlayerInput>): Promise<MutationResult<Player>>;
  createTournament(input: { name: string; startsAt: string }): Promise<MutationResult<Tournament>>;
  updateTournament(eventId: string, patch: TournamentUpdate): Promise<MutationResult<Tournament>>;
  registerEntry(eventId: string, playerId: string): Promise<MutationResult<Entry>>;
  updateEntry(entryId: string, patch: EntryUpdate): Promise<MutationResult<Entry>>;
  archivePlayer(playerId: string): Promise<MutationResult<Player>>;
  promoteWaitlist(eventId: string): Promise<MutationResult<Entry | null>>;
  startGroups(eventId: string, revision: number, plans: GroupPlan[], seed: number, mode: 'random' | 'balanced'): Promise<MutationResult<unknown>>;
  createPlayoffs(eventId: string, revision: number, seed: number): Promise<MutationResult<unknown>>;
  startMatch(matchId: string, table: number, version: number): Promise<MutationResult<unknown>>;
  saveScore(matchId: string, version: number, games: GameScore[]): Promise<MutationResult<unknown>>;
  resolveMatch(matchId: string, version: number, kind: 'walkover' | 'void', winner: string | null, reason: string): Promise<MutationResult<unknown>>;
  clearResult(matchId: string, version: number): Promise<MutationResult<unknown>>;
  withdrawEntry(entryId: string): Promise<MutationResult<Entry>>;
  resetPlayoffs(eventId: string, revision: number): Promise<MutationResult<unknown>>;
  finishTournament(eventId: string, revision: number): Promise<MutationResult<unknown>>;
  cancelTournament(eventId: string, revision: number): Promise<MutationResult<unknown>>;
}

async function attempt<T>(work: () => Promise<T>): Promise<MutationResult<T>> {
  try { return { ok: true, value: await work() }; }
  catch (error) { return remoteError(error); }
}

function unwrap<T>(result: MutationResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.value;
}

function tournamentPatch(patch: TournamentUpdate): api.TournamentPatch {
  const result: api.TournamentPatch = {};
  if (patch.name !== undefined) result.name = patch.name.trim();
  if (patch.startsAt !== undefined) result.starts_at = new Date(patch.startsAt).toISOString();
  if (patch.bookingMinutes !== undefined) result.booking_minutes = patch.bookingMinutes;
  if (patch.entryFeeCents !== undefined) result.entry_fee_cents = patch.entryFeeCents;
  if (patch.registrationCap !== undefined) result.registration_cap = patch.registrationCap;
  if (patch.tableCount !== undefined) result.table_count = patch.tableCount;
  if (patch.groupBestOf !== undefined) result.group_best_of = patch.groupBestOf;
  if (patch.playoffBestOf !== undefined) result.playoff_best_of = patch.playoffBestOf;
  if (patch.finalBestOf !== undefined) result.final_best_of = patch.finalBestOf;
  if (patch.qualifiersPerGroup !== undefined) result.qualifiers_per_group = patch.qualifiersPerGroup;
  if (patch.consolationEnabled !== undefined) result.consolation_enabled = patch.consolationEnabled;
  if (patch.lotOrders !== undefined) result.lot_orders = patch.lotOrders;
  return result;
}

function entryPatch(patch: EntryUpdate): api.EntryPatch {
  const result: api.EntryPatch = {};
  if (patch.checkedIn !== undefined) result.checked_in = patch.checkedIn;
  if (patch.paid !== undefined) result.paid = patch.paid;
  if (patch.paymentMethod !== undefined) result.payment_method = patch.paymentMethod;
  if (patch.amountPaidCents !== undefined) result.amount_paid_cents = patch.amountPaidCents;
  if (patch.discountCents !== undefined) result.discount_cents = patch.discountCents;
  if (patch.paymentNote !== undefined) result.payment_note = patch.paymentNote;
  if (patch.registrationStatus !== undefined) result.registration_status = patch.registrationStatus;
  if (patch.paid === false) { result.amount_paid_cents = 0; result.payment_method = null; }
  return result;
}

export const remoteActions: OrganizerActions = {
  createPlayer: input => attempt(async () => mapPlayer(unwrap(await api.createPlayer({ ...input, name: input.name.trim() })))),
  updatePlayer: (playerId, patch) => attempt(async () => mapPlayer(unwrap(await api.updatePlayer(playerId, patch)))),
  createTournament: input => attempt(async () => mapTournament(unwrap(await api.createTournament({
    name: input.name.trim(), starts_at: new Date(input.startsAt).toISOString(),
  })))),
  updateTournament: (eventId, patch) => attempt(async () => mapTournament(unwrap(await api.updateTournament(eventId, tournamentPatch(patch))))),
  registerEntry: (eventId, playerId) => attempt(async () => {
    const [events, entries] = await Promise.all([api.listTournaments(), api.listEntries(eventId)]);
    const event = events.find(row => row.id === eventId);
    if (!event) throw new Error('invalid: Event not found.');
    const full = entries.filter(row => row.registration_status === 'registered').length >= event.registration_cap;
    return mapEntry(unwrap(await api.addEntry({ tournament_id: eventId, player_id: playerId,
      registration_status: full ? 'waitlisted' : 'registered' })));
  }),
  updateEntry: (entryId, patch) => attempt(async () => mapEntry(unwrap(await api.updateEntry(entryId, entryPatch(patch))))),
  archivePlayer: playerId => attempt(async () => mapPlayer(unwrap(await api.archivePlayer(playerId)))),
  promoteWaitlist: eventId => attempt(async () => {
    const [events, entries] = await Promise.all([api.listTournaments(), api.listEntries(eventId)]);
    const event = events.find(row => row.id === eventId);
    if (!event || event.state !== 'setup') throw new Error('blocked: Waitlist promotion is only available before groups start.');
    if (entries.filter(row => row.registration_status === 'registered').length >= event.registration_cap)
      throw new Error('blocked: Increase the registration cap before promoting another entrant.');
    const waiting = entries.find(row => row.registration_status === 'waitlisted');
    return waiting ? mapEntry(unwrap(await api.updateEntry(waiting.id, { registration_status: 'registered' }))) : null;
  }),
  startGroups: (eventId, revision, plans, seed, mode) => api.saveGroups(eventId, revision, plans, seed, mode),
  createPlayoffs: async (eventId, revision, seed) => {
    try {
      const state = await loadRemoteWorkspace(eventId);
      if (!state || state.profile.role !== 'admin') return { ok: false, code: 'forbidden', message: 'Organizer access is required.' };
      const event = state.tournaments.find(row => row.id === eventId);
      if (!event) return { ok: false, code: 'invalid', message: 'Event not found.' };
      if (event.revision !== revision) return { ok: false, code: 'conflict', message: 'The event changed. Refresh before creating playoffs.' };
      const ready = groupsReadyForPlayoffs(state, eventId);
      if (!ready.ok) return ready;
      const available = new Set(state.entries.filter(row => row.registrationStatus !== 'withdrawn').map(row => row.id));
      const championship: QualifiedEntry[] = [];
      const consolation: QualifiedEntry[] = [];
      for (const [groupIndex, standings] of Object.entries(ready.value.standings)) {
        const eligible = standings.filter(row => available.has(row.entryId));
        eligible.forEach((row, index) => {
          if (row.rank === null) return;
          const entry = { entryId: row.entryId, groupIndex: Number(groupIndex), place: row.rank };
          (index < event.qualifiersPerGroup ? championship : consolation).push(entry);
        });
      }
      return api.savePlayoffs(eventId, revision, {
        championship: buildBracket(orderQualifiers(championship, seed).map(row => row.entryId), event.playoffBestOf, event.finalBestOf),
        consolation: event.consolationEnabled
          ? buildBracket(orderQualifiers(consolation, seed + 1).map(row => row.entryId), event.playoffBestOf) : [],
      });
    } catch (error) { return remoteError(error); }
  },
  startMatch: (matchId, table, version) => api.startMatch(matchId, table, version),
  saveScore: (matchId, version, games) => api.submitScore({ matchId, expectedVersion: version, games }),
  resolveMatch: (matchId, version, kind, winner, reason) => api.resolveUnplayedMatch({
    matchId, expectedVersion: version, kind, winnerEntryId: winner, reason,
  }),
  clearResult: (matchId, version) => api.clearResult(matchId, version),
  withdrawEntry: entryId => attempt(async () => mapEntry(unwrap(await api.updateEntry(entryId, { registration_status: 'withdrawn' })))),
  resetPlayoffs: (eventId, revision) => api.resetPlayoffs(eventId, revision),
  finishTournament: (eventId, revision) => api.finishTournament(eventId, revision),
  cancelTournament: (eventId, revision) => api.cancelTournament(eventId, revision),
};

// These are the only operations the phone scorekeeper view needs.
export const scorekeeperActions = {
  getScoreboard: (eventId?: string): Promise<Scoreboard> => api.getScoreboard(eventId),
  saveScore: (matchId: string, version: number, games: GameScore[]): Promise<MutationResult<ScoreboardMatch>> =>
    api.submitScore({ matchId, expectedVersion: version, games }),
};

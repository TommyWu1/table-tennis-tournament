import type {
  EntryRow,
  Experience,
  Json,
  MatchRow,
  PlayerRow,
  TournamentRow,
} from './database.types';
import { getSupabase } from './supabase';
import type {
  BestOf,
  GroupPlan,
  MutationResult,
  PlannedMatch,
  Scoreboard,
  ScoreboardMatch,
  ScoreInput,
  UnplayedResultInput,
} from '../types';

export type PlayerInput = { name: string; label?: string | null; experience?: Experience };
export type PlayerPatch = Partial<PlayerInput> & { archived?: boolean };
export type TournamentInput = Pick<TournamentRow, 'name' | 'starts_at'> & Partial<Pick<
  TournamentRow,
  | 'booking_minutes'
  | 'entry_fee_cents'
  | 'registration_cap'
  | 'table_count'
  | 'group_best_of'
  | 'playoff_best_of'
  | 'final_best_of'
  | 'qualifiers_per_group'
  | 'consolation_enabled'
>>;
export type TournamentPatch = Partial<Omit<TournamentInput, 'name'>> & {
  name?: string;
  lot_orders?: Json;
};
export type EntryInput = Pick<EntryRow, 'tournament_id' | 'player_id'> & Partial<Pick<
  EntryRow,
  | 'registration_status'
  | 'checked_in'
  | 'paid'
  | 'payment_method'
  | 'amount_paid_cents'
  | 'discount_cents'
  | 'payment_note'
>>;
export type EntryPatch = Partial<Omit<EntryInput, 'tournament_id'>>;
export type PlayoffPlans = { championship: PlannedMatch[]; consolation: PlannedMatch[] };

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function normalizeError(error: unknown): MutationResult<never> {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : 'The save could not be completed.';
  const lower = message.toLowerCase();
  const code = lower.startsWith('forbidden:') || lower.includes('permission denied') || lower.includes('not provisioned')
    || lower.includes('row-level security')
    ? 'forbidden'
    : lower.startsWith('conflict:') || lower.includes('duplicate key') || lower.includes('serialization failure')
      ? 'conflict'
      : lower.startsWith('blocked:') || lower.includes('dependent matches') || lower.includes('already in use')
        ? 'blocked'
        : lower.startsWith('invalid:') || lower.includes('violates check constraint')
          ? 'invalid'
          : 'network';
  return { ok: false, code, message: message.replace(/^(forbidden|conflict|blocked|invalid):\s*/i, '') };
}

async function mutation<T>(work: () => Promise<T>): Promise<MutationResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return normalizeError(error);
  }
}

function scoreboardMatch(value: Json): ScoreboardMatch {
  return value as unknown as ScoreboardMatch;
}

async function rpcMatch(name: 'start_match' | 'save_score' | 'clear_result', args: Record<string, Json>) {
  const { data, error } = await getSupabase().rpc(name, args as never);
  if (error) throw error;
  return scoreboardMatch(data as Json);
}

async function rpcRevision(
  name: 'save_groups' | 'save_playoffs' | 'reset_playoffs' | 'finish_tournament' | 'cancel_tournament',
  args: Record<string, Json>,
) {
  const { data, error } = await getSupabase().rpc(name, args as never);
  if (error) throw error;
  return data as { revision: number };
}

export async function getScoreboard(eventId?: string | null): Promise<Scoreboard> {
  const { data, error } = await getSupabase().rpc('get_scoreboard', { p_tournament_id: eventId ?? null });
  throwIfError(error);
  return data as unknown as Scoreboard;
}

/** Full fixture graph for the admin bracket and standings; scorekeepers must use getScoreboard. */
export async function listMatches(eventId: string): Promise<MatchRow[]> {
  const { data, error } = await getSupabase().from('matches').select('*').eq('tournament_id', eventId)
    .order('stage').order('division').order('group_index').order('round').order('sequence');
  throwIfError(error);
  return data ?? [];
}

export async function listPlayers(): Promise<PlayerRow[]> {
  const { data, error } = await getSupabase().from('players').select('*').order('archived').order('name');
  throwIfError(error);
  return data ?? [];
}

export function createPlayer(input: PlayerInput): Promise<MutationResult<PlayerRow>> {
  return mutation(async () => {
    const { data, error } = await getSupabase().from('players').insert(input).select('*').single();
    if (error) throw error;
    if (!data) throw new Error('Player insert returned no row.');
    return data;
  });
}

export function updatePlayer(id: string, patch: PlayerPatch): Promise<MutationResult<PlayerRow>> {
  return mutation(async () => {
    const { data, error } = await getSupabase().from('players').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    if (!data) throw new Error('Player update returned no row.');
    return data;
  });
}

export function archivePlayer(id: string): Promise<MutationResult<PlayerRow>> {
  return updatePlayer(id, { archived: true });
}

export async function listTournaments(): Promise<TournamentRow[]> {
  const { data, error } = await getSupabase().from('tournaments').select('*').order('starts_at', { ascending: false });
  throwIfError(error);
  return data ?? [];
}

export function createTournament(input: TournamentInput): Promise<MutationResult<TournamentRow>> {
  return mutation(async () => {
    const { data, error } = await getSupabase().from('tournaments').insert(input).select('*').single();
    if (error) throw error;
    if (!data) throw new Error('Tournament insert returned no row.');
    return data;
  });
}

export function updateTournament(id: string, patch: TournamentPatch): Promise<MutationResult<TournamentRow>> {
  return mutation(async () => {
    const { data, error } = await getSupabase().from('tournaments').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    if (!data) throw new Error('Tournament update returned no row.');
    return data;
  });
}

export async function listEntries(eventId: string): Promise<EntryRow[]> {
  const { data, error } = await getSupabase().from('entries').select('*').eq('tournament_id', eventId).order('created_at');
  throwIfError(error);
  return data ?? [];
}

export function addEntry(input: EntryInput): Promise<MutationResult<EntryRow>> {
  return mutation(async () => {
    const { data, error } = await getSupabase().from('entries').insert(input).select('*').single();
    if (error) throw error;
    if (!data) throw new Error('Entry insert returned no row.');
    return data;
  });
}

export function updateEntry(id: string, patch: EntryPatch): Promise<MutationResult<EntryRow>> {
  return mutation(async () => {
    const { data, error } = await getSupabase().from('entries').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    if (!data) throw new Error('Entry update returned no row.');
    return data;
  });
}

export function removeEntry(id: string): Promise<MutationResult<void>> {
  return mutation(async () => {
    const { error } = await getSupabase().from('entries').delete().eq('id', id);
    if (error) throw error;
  });
}

export function submitScore(input: ScoreInput): Promise<MutationResult<ScoreboardMatch>> {
  return mutation(() => rpcMatch('save_score', {
    p_match_id: input.matchId,
    p_expected_version: input.expectedVersion,
    p_games: input.games as unknown as Json,
    p_kind: 'played',
  }));
}

export function resolveUnplayedMatch(input: UnplayedResultInput): Promise<MutationResult<ScoreboardMatch>> {
  return mutation(() => rpcMatch('save_score', {
    p_match_id: input.matchId,
    p_expected_version: input.expectedVersion,
    p_games: null,
    p_kind: input.kind,
    p_winner_entry_id: input.winnerEntryId,
    p_reason: input.reason,
  }));
}

export function startMatch(
  matchId: string,
  tableNumber: number,
  expectedVersion: number,
): Promise<MutationResult<ScoreboardMatch>> {
  return mutation(() => rpcMatch('start_match', {
    p_match_id: matchId,
    p_table_number: tableNumber,
    p_expected_version: expectedVersion,
  }));
}

export function clearResult(matchId: string, expectedVersion: number): Promise<MutationResult<ScoreboardMatch>> {
  return mutation(() => rpcMatch('clear_result', {
    p_match_id: matchId,
    p_expected_version: expectedVersion,
  }));
}

export function saveGroups(
  eventId: string,
  expectedRevision: number,
  plans: GroupPlan[],
  drawSeed?: number,
  drawMode?: 'random' | 'balanced',
): Promise<MutationResult<{ revision: number }>> {
  return mutation(() => rpcRevision('save_groups', {
    p_tournament_id: eventId,
    p_expected_revision: expectedRevision,
    p_plans: plans as unknown as Json,
    p_draw_seed: drawSeed ?? null,
    p_draw_mode: drawMode ?? null,
  }));
}

export function savePlayoffs(
  eventId: string,
  expectedRevision: number,
  plans: PlayoffPlans,
): Promise<MutationResult<{ revision: number }>> {
  return mutation(() => rpcRevision('save_playoffs', {
    p_tournament_id: eventId,
    p_expected_revision: expectedRevision,
    p_plans: plans as unknown as Json,
  }));
}

export function resetPlayoffs(eventId: string, expectedRevision: number): Promise<MutationResult<{ revision: number }>> {
  return mutation(() => rpcRevision('reset_playoffs', {
    p_tournament_id: eventId,
    p_expected_revision: expectedRevision,
  }));
}

export function finishTournament(eventId: string, expectedRevision: number): Promise<MutationResult<{ revision: number }>> {
  return mutation(() => rpcRevision('finish_tournament', {
    p_tournament_id: eventId,
    p_expected_revision: expectedRevision,
  }));
}

export function cancelTournament(eventId: string, expectedRevision: number): Promise<MutationResult<{ revision: number }>> {
  return mutation(() => rpcRevision('cancel_tournament', {
    p_tournament_id: eventId,
    p_expected_revision: expectedRevision,
  }));
}

export const DEFAULT_MATCH_SETTINGS: Pick<TournamentRow, 'group_best_of' | 'playoff_best_of' | 'final_best_of'> = {
  group_best_of: 1 as BestOf,
  playoff_best_of: 1 as BestOf,
  final_best_of: 3 as BestOf,
};

import { applyEloResult } from '../domain/elo';
import { buildBracket, orderQualifiers, type QualifiedEntry } from '../domain/bracket';
import { createGroupDraw, seedEntries, type DrawMode, type DrawPlayer } from '../domain/groups';
import { roundRobin } from '../domain/roundRobin';
import { validateSeries } from '../domain/scores';
import { calculateStandings } from '../domain/standings';
import type {
  BestOf,
  Division,
  Entry,
  Experience,
  GameScore,
  GroupPlan,
  GroupResult,
  Id,
  MutationResult,
  PaymentMethod,
  PlannedMatch,
  Player,
  Slot,
  Standing,
  Tournament,
} from '../types';

// Keep the previous demo snapshot untouched while starting the new rehearsal fresh.
export const DEMO_STORAGE_KEY = 'table-tennis-manager:local-demo:v2';
const STORAGE_KEY = DEMO_STORAGE_KEY;

export interface DemoMatch {
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

export interface DemoState {
  players: Player[];
  tournaments: Tournament[];
  entries: Entry[];
  matches: DemoMatch[];
}

export interface PaymentUpdate {
  paid: boolean;
  method: PaymentMethod;
  amountPaidCents: number;
  discountCents: number;
  paymentNote: string | null;
}

export interface ResolvedSlot {
  resolved: boolean;
  entryId: Id | null;
}

function id(prefix: string): Id {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function seedDemoState(): DemoState {
  const now = nowIso();
  const names = [
    'Avery Chen', 'Maya Patel', 'Jordan Brooks', 'Lina Okafor', 'Theo Martin',
    'Nia Rivera', 'Owen Reid', 'Samira Ali', 'Miles Carter', 'Jules Kim',
    'Alex Nguyen', 'Priya Shah', 'Noah Wilson', 'Emma Park', 'Eli Thompson',
    'Zara Ahmed', 'Leo Garcia', 'Sofia Rossi', 'Kai Williams',
  ];
  const players: Player[] = names.map((name, index) => ({
    id: `demo-player-${index + 1}`,
    name,
    label: null,
    experience: 'unknown',
    // Equal Elo baselines are only used once results exist; these players are unrated.
    rating: 1000,
    ratedMatchCount: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  }));
  const tournamentId = 'demo-event-autumn-open';
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const tournament: Tournament = {
    id: tournamentId,
    name: '19-player practice tournament',
    startsAt,
    bookingMinutes: 240,
    entryFeeCents: 1000,
    registrationCap: 20,
    tableCount: 3,
    groupBestOf: 1,
    playoffBestOf: 1,
    finalBestOf: 3,
    qualifiersPerGroup: 2,
    consolationEnabled: true,
    state: 'setup',
    drawSeed: null,
    drawMode: null,
    lotOrders: {},
    revision: 1,
    finalizedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const entries: Entry[] = players.map((player, index) => ({
    id: `demo-entry-${index + 1}`,
    tournamentId,
    playerId: player.id,
    registrationStatus: 'registered',
    checkedIn: false,
    paid: false,
    paymentMethod: null,
    amountPaidCents: 0,
    discountCents: 0,
    paymentNote: null,
    baseFeeCents: 1000,
    groupIndex: null,
    seedValue: null,
    seedPosition: null,
    ratingBefore: null,
    ratingAfter: null,
    createdAt: now,
    updatedAt: now,
    player,
  }));
  return { players, tournaments: [tournament], entries, matches: [] };
}

function isDemoState(value: unknown): value is DemoState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DemoState>;
  return Array.isArray(candidate.players)
    && Array.isArray(candidate.tournaments)
    && Array.isArray(candidate.entries)
    && Array.isArray(candidate.matches);
}

export function loadDemoState(): DemoState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (isDemoState(parsed)) {
        let recovered = recoverGroupAssignments(parsed);
        for (const tournament of parsed.tournaments) {
          if (tournament.state === 'playoffs') {
            recovered = autoAdvanceDemoByes(parsed, tournament.id) || recovered;
          }
        }
        if (recovered) saveDemoState(parsed);
        return parsed;
      }
    }
  } catch {
    // A damaged local demo snapshot starts clean on the next save.
  }
  const initial = seedDemoState();
  saveDemoState(initial);
  return initial;
}

function recoverGroupAssignments(state: DemoState): boolean {
  let recovered = false;
  for (const match of state.matches) {
    if (match.stage !== 'groups' || match.groupIndex === null) continue;
    const fixtureEntryIds = [
      match.entryAId,
      match.entryBId,
      match.a.kind === 'entry' ? match.a.entryId : null,
      match.b.kind === 'entry' ? match.b.entryId : null,
    ];
    for (const entryId of fixtureEntryIds) {
      if (!entryId) continue;
      const entry = state.entries.find((candidate) => candidate.id === entryId);
      if (entry?.groupIndex === null) {
        entry.groupIndex = match.groupIndex;
        recovered = true;
      }
    }
  }
  return recovered;
}

export function saveDemoState(state: DemoState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetDemoState(): DemoState {
  localStorage.removeItem(STORAGE_KEY);
  return loadDemoState();
}

export function getTournament(state: DemoState, eventId: Id): Tournament | undefined {
  return state.tournaments.find((tournament) => tournament.id === eventId);
}

export function getEntries(state: DemoState, eventId: Id): Entry[] {
  return state.entries
    .filter((entry) => entry.tournamentId === eventId)
    .map((entry) => ({ ...entry, player: state.players.find((player) => player.id === entry.playerId) }));
}

export function getPlayer(state: DemoState, playerId: Id): Player | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function getEntry(state: DemoState, entryId: Id): Entry | undefined {
  return state.entries.find((entry) => entry.id === entryId);
}

function bumpTournament(state: DemoState, eventId: Id): void {
  const tournament = getTournament(state, eventId);
  if (!tournament) return;
  tournament.revision += 1;
  tournament.updatedAt = nowIso();
}

export function createDemoPlayer(
  state: DemoState,
  input: { name: string; label?: string | null; experience?: Experience },
): MutationResult<Player> {
  const name = input.name.trim();
  if (!name) return { ok: false, code: 'invalid', message: 'Enter a player name.' };
  const now = nowIso();
  const player: Player = {
    id: id('demo-player'),
    name,
    label: input.label?.trim() || null,
    experience: input.experience ?? 'unknown',
    rating: 1000,
    ratedMatchCount: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  state.players.unshift(player);
  return { ok: true, value: player };
}

export function createDemoTournament(state: DemoState, input: { name: string; startsAt: string }): MutationResult<Tournament> {
  const name = input.name.trim();
  if (!name || !input.startsAt) return { ok: false, code: 'invalid', message: 'Add an event name and start time.' };
  if (state.tournaments.some(({ state: currentState }) => currentState === 'groups' || currentState === 'playoffs')) {
    return { ok: false, code: 'blocked', message: 'Finish or cancel the current event before starting another.' };
  }
  const now = nowIso();
  const tournament: Tournament = {
    id: id('demo-event'),
    name,
    startsAt: new Date(input.startsAt).toISOString(),
    bookingMinutes: 240,
    entryFeeCents: 1000,
    registrationCap: 20,
    tableCount: 3,
    groupBestOf: 1,
    playoffBestOf: 1,
    finalBestOf: 3,
    qualifiersPerGroup: 2,
    consolationEnabled: true,
    state: 'setup',
    drawSeed: null,
    drawMode: null,
    lotOrders: {},
    revision: 1,
    finalizedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  state.tournaments.unshift(tournament);
  return { ok: true, value: tournament };
}

export function updateDemoTournament(
  state: DemoState,
  eventId: Id,
  patch: Partial<Pick<Tournament,
    | 'name'
    | 'startsAt'
    | 'bookingMinutes'
    | 'entryFeeCents'
    | 'registrationCap'
    | 'tableCount'
    | 'groupBestOf'
    | 'playoffBestOf'
    | 'finalBestOf'
    | 'qualifiersPerGroup'
    | 'consolationEnabled'
    | 'drawSeed'
    | 'drawMode'
    | 'lotOrders'
  >>,
): MutationResult<Tournament> {
  const tournament = getTournament(state, eventId);
  if (!tournament) return { ok: false, code: 'invalid', message: 'Event not found.' };
  if (tournament.state === 'finished' || tournament.state === 'cancelled') {
    return { ok: false, code: 'blocked', message: 'This event is read-only.' };
  }
  if (tournament.state === 'groups') {
    const groupStageFields = new Set(['playoffBestOf', 'finalBestOf', 'lotOrders']);
    if (Object.keys(patch).some((field) => !groupStageFields.has(field))) {
      return { ok: false, code: 'blocked', message: 'Only playoff settings and group lots can change after groups begin.' };
    }
  } else if (tournament.state !== 'setup') {
    return { ok: false, code: 'blocked', message: 'Event settings are locked once playoffs begin.' };
  }
  Object.assign(tournament, patch);
  bumpTournament(state, eventId);
  return { ok: true, value: tournament };
}

export function registerDemoEntry(
  state: DemoState,
  eventId: Id,
  playerId: Id,
): MutationResult<Entry> {
  const tournament = getTournament(state, eventId);
  const player = getPlayer(state, playerId);
  if (!tournament || !player || player.archived) return { ok: false, code: 'invalid', message: 'Choose an active player.' };
  if (tournament.state !== 'setup') return { ok: false, code: 'blocked', message: 'The draw has started. New entries are closed.' };
  if (state.entries.some((entry) => entry.tournamentId === eventId && entry.playerId === playerId)) {
    return { ok: false, code: 'invalid', message: 'That player is already registered for this event.' };
  }
  const registeredCount = state.entries.filter((entry) =>
    entry.tournamentId === eventId && entry.registrationStatus === 'registered').length;
  const now = nowIso();
  const entry: Entry = {
    id: id('demo-entry'),
    tournamentId: eventId,
    playerId,
    registrationStatus: registeredCount >= tournament.registrationCap ? 'waitlisted' : 'registered',
    checkedIn: false,
    paid: false,
    paymentMethod: null,
    amountPaidCents: 0,
    discountCents: 0,
    paymentNote: null,
    baseFeeCents: tournament.entryFeeCents,
    groupIndex: null,
    seedValue: null,
    seedPosition: null,
    ratingBefore: null,
    ratingAfter: null,
    createdAt: now,
    updatedAt: now,
    player,
  };
  state.entries.push(entry);
  bumpTournament(state, eventId);
  return { ok: true, value: entry };
}

export function updateDemoEntry(
  state: DemoState,
  entryId: Id,
  patch: Partial<Pick<Entry,
    | 'checkedIn'
    | 'paid'
    | 'paymentMethod'
    | 'amountPaidCents'
    | 'discountCents'
    | 'paymentNote'
    | 'registrationStatus'
  >>,
): MutationResult<Entry> {
  const entry = getEntry(state, entryId);
  if (!entry) return { ok: false, code: 'invalid', message: 'Entrant not found.' };
  const tournament = getTournament(state, entry.tournamentId);
  if (!tournament || tournament.state === 'finished' || tournament.state === 'cancelled') {
    return { ok: false, code: 'blocked', message: 'This event is read-only.' };
  }
  if (tournament.state !== 'setup') {
    const statusChangeIsWithdrawal = !('registrationStatus' in patch) || patch.registrationStatus === 'withdrawn';
    const checkInChangeIsWithdrawal = !('checkedIn' in patch)
      || (patch.checkedIn === false && patch.registrationStatus === 'withdrawn');
    if (!statusChangeIsWithdrawal || !checkInChangeIsWithdrawal) {
      return { ok: false, code: 'blocked', message: 'Attendance changes are locked after groups start. Only withdrawals are allowed.' };
    }
    if (patch.registrationStatus === 'withdrawn' && !('checkedIn' in patch)) {
      patch = { ...patch, checkedIn: false };
    }
  }
  if (patch.registrationStatus === 'waitlisted' && entry.registrationStatus !== 'waitlisted') {
    patch = { ...patch, checkedIn: false };
  }
  const paid = patch.paid ?? entry.paid;
  const amountPaidCents = patch.amountPaidCents ?? entry.amountPaidCents;
  const discountCents = patch.discountCents ?? entry.discountCents;
  const paymentMethod = patch.paid === false
    ? null
    : ('paymentMethod' in patch ? patch.paymentMethod : entry.paymentMethod);
  if (!Number.isInteger(amountPaidCents) || amountPaidCents < 0) {
    return { ok: false, code: 'invalid', message: 'Payment amount must be a non-negative whole number of cents.' };
  }
  if (!Number.isInteger(discountCents) || discountCents < 0 || discountCents > entry.baseFeeCents) {
    return { ok: false, code: 'invalid', message: 'Discount must be between $0 and the entry fee.' };
  }
  if (patch.paid === false) {
    patch = { ...patch, paymentMethod: null, amountPaidCents: 0 };
  }
  if (paid && paymentMethod === null && amountPaidCents > 0) {
    return { ok: false, code: 'invalid', message: 'Choose cash or card for a payment above $0.' };
  }
  Object.assign(entry, patch, { updatedAt: nowIso() });
  bumpTournament(state, entry.tournamentId);
  return { ok: true, value: entry };
}

export function archiveDemoPlayer(state: DemoState, playerId: Id): MutationResult<Player> {
  const player = getPlayer(state, playerId);
  if (!player) return { ok: false, code: 'invalid', message: 'Player not found.' };
  player.archived = true;
  player.updatedAt = nowIso();
  return { ok: true, value: player };
}

export function promoteDemoWaitlist(state: DemoState, eventId: Id): MutationResult<Entry | null> {
  const tournament = getTournament(state, eventId);
  if (!tournament || tournament.state !== 'setup') {
    return { ok: false, code: 'blocked', message: 'Waitlist promotion is only available before groups start.' };
  }
  const registeredCount = state.entries.filter((entry) =>
    entry.tournamentId === eventId && entry.registrationStatus === 'registered').length;
  if (registeredCount >= tournament.registrationCap) {
    return { ok: false, code: 'blocked', message: 'Increase the registration cap before promoting another entrant.' };
  }
  const waiting = state.entries.find((entry) => entry.tournamentId === eventId && entry.registrationStatus === 'waitlisted');
  if (!waiting) return { ok: true, value: null };
  waiting.registrationStatus = 'registered';
  waiting.updatedAt = nowIso();
  bumpTournament(state, eventId);
  return { ok: true, value: waiting };
}

export function eligibleEntries(state: DemoState, eventId: Id): Entry[] {
  return getEntries(state, eventId).filter((entry) =>
    entry.registrationStatus === 'registered' && entry.checkedIn);
}

export function getDrawPlayers(state: DemoState, eventId: Id): DrawPlayer[] {
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
  state: DemoState,
  eventId: Id,
  sizes: number[],
  mode: DrawMode,
  seed: number,
): GroupPlan[] {
  const drawPlayers = getDrawPlayers(state, eventId);
  const seeded = seedEntries(drawPlayers, seed);
  return createGroupDraw(seeded, sizes, mode, seed);
}

export function startDemoGroups(
  state: DemoState,
  eventId: Id,
  expectedRevision: number,
  plans: GroupPlan[],
  seed: number,
  mode: DrawMode,
): MutationResult<{ revision: number }> {
  const tournament = getTournament(state, eventId);
  if (!tournament || tournament.state !== 'setup') {
    return { ok: false, code: 'blocked', message: 'Groups can only start from event setup.' };
  }
  if (tournament.revision !== expectedRevision) {
    return { ok: false, code: 'conflict', message: 'The roster changed since this draw preview. Refresh the preview before starting.' };
  }
  const entrants = eligibleEntries(state, eventId);
  if (entrants.length < 4) return { ok: false, code: 'invalid', message: 'Check in at least four entrants before starting groups.' };
  const plannedIds = plans.flatMap((plan) => plan.entryIds);
  if (new Set(plannedIds).size !== plannedIds.length || entrants.some((entry) => !plannedIds.includes(entry.id))
    || plannedIds.length !== entrants.length) {
    return { ok: false, code: 'invalid', message: 'The draw must include every checked-in entrant exactly once.' };
  }
  if (plans.some((plan) => plan.entryIds.length < 3 || plan.entryIds.length > 5)) {
    return { ok: false, code: 'invalid', message: 'Group sizes must be between three and five.' };
  }

  state.matches = state.matches.filter((match) => match.eventId !== eventId);
  for (const entry of entrants) {
    const group = plans.find((plan) => plan.entryIds.includes(entry.id));
    const canonicalEntry = state.entries.find((candidate) => candidate.id === entry.id);
    if (canonicalEntry) {
      canonicalEntry.groupIndex = group?.groupIndex ?? null;
      canonicalEntry.updatedAt = nowIso();
    }
  }
  for (const group of plans) {
    const fixtures = roundRobin(group.entryIds);
    for (const fixture of fixtures) {
      state.matches.push({
        id: id('demo-match'),
        eventId,
        matchKey: `group-${group.groupIndex}-r${fixture.round}-m${fixture.sequence}`,
        stage: 'groups',
        division: null,
        groupIndex: group.groupIndex,
        round: fixture.round,
        sequence: fixture.sequence,
        a: { kind: 'entry', entryId: fixture.a },
        b: { kind: 'entry', entryId: fixture.b },
        entryAId: fixture.a,
        entryBId: fixture.b,
        bestOf: tournament.groupBestOf,
        tableNumber: null,
        state: 'pending',
        kind: null,
        games: [],
        winnerEntryId: null,
        reason: null,
        version: 1,
        updatedAt: null,
      });
    }
  }
  tournament.drawSeed = seed;
  tournament.drawMode = mode;
  tournament.state = 'groups';
  bumpTournament(state, eventId);
  return { ok: true, value: { revision: tournament.revision } };
}

export function groupEntryIds(state: DemoState, eventId: Id, groupIndex: number): Id[] {
  return state.entries
    .filter((entry) => entry.tournamentId === eventId && entry.groupIndex === groupIndex)
    .map((entry) => entry.id);
}

export function groupResults(state: DemoState, eventId: Id, groupIndex: number): GroupResult[] {
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
  state: DemoState,
  eventId: Id,
  groupIndex: number,
): Standing[] {
  const tournament = getTournament(state, eventId);
  const ids = groupEntryIds(state, eventId, groupIndex);
  const lots = tournament?.lotOrders[String(groupIndex)];
  return calculateStandings(ids, groupResults(state, eventId, groupIndex), lots);
}

export function groupsReadyForPlayoffs(state: DemoState, eventId: Id): MutationResult<{ standings: Record<number, Standing[]> }> {
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

function prefixedSlot(slot: Slot, prefix: string): Slot {
  return slot.kind === 'winner' ? { kind: 'winner', matchKey: `${prefix}:${slot.matchKey}` } : slot;
}

function appendBracket(
  state: DemoState,
  eventId: Id,
  division: Division,
  ordered: QualifiedEntry[],
  tournament: Tournament,
): void {
  if (ordered.length < 2) return;
  const bestOf = tournament.playoffBestOf;
  const finalBestOf = division === 'championship' ? tournament.finalBestOf : bestOf;
  const plan: PlannedMatch[] = buildBracket(ordered.map((entry) => entry.entryId), bestOf, finalBestOf);
  const prefix = division;
  for (const match of plan) {
    state.matches.push({
      id: id('demo-match'),
      eventId,
      matchKey: `${prefix}:${match.key}`,
      stage: 'playoffs',
      division,
      groupIndex: null,
      round: match.round,
      sequence: match.sequence,
      a: prefixedSlot(match.a, prefix),
      b: prefixedSlot(match.b, prefix),
      entryAId: null,
      entryBId: null,
      bestOf: match.bestOf,
      tableNumber: null,
      state: 'pending',
      kind: null,
      games: [],
      winnerEntryId: null,
      reason: null,
      version: 1,
      updatedAt: null,
    });
  }
}

export function createDemoPlayoffs(
  state: DemoState,
  eventId: Id,
  expectedRevision: number,
  seed: number,
): MutationResult<{ revision: number }> {
  const tournament = getTournament(state, eventId);
  if (!tournament) return { ok: false, code: 'invalid', message: 'Event not found.' };
  if (tournament.revision !== expectedRevision) {
    return { ok: false, code: 'conflict', message: 'The event changed. Refresh before creating playoffs.' };
  }
  if (tournament.state !== 'groups') return { ok: false, code: 'blocked', message: 'Resolve group play before creating playoffs.' };
  const ready = groupsReadyForPlayoffs(state, eventId);
  if (!ready.ok) return ready;

  const entrants = getEntries(state, eventId).filter((entry) => entry.groupIndex !== null && entry.registrationStatus !== 'withdrawn');
  const championship: QualifiedEntry[] = [];
  const consolation: QualifiedEntry[] = [];
  for (const [groupIndexText, standings] of Object.entries(ready.value.standings)) {
    const groupIndex = Number(groupIndexText);
    const eligibleStandings = standings.filter((standing) =>
      standing.rank !== null && entrants.some((entry) => entry.id === standing.entryId));
    eligibleStandings.forEach((standing, index) => {
      const entry = entrants.find(({ id: entryId }) => entryId === standing.entryId);
      if (!entry || standing.rank === null) return;
      const qualified = { entryId: entry.id, groupIndex, place: standing.rank };
      if (index < tournament.qualifiersPerGroup) championship.push(qualified);
      else consolation.push(qualified);
    });
  }
  state.matches = state.matches.filter((match) => !(match.eventId === eventId && match.stage === 'playoffs'));
  const orderedChampionship = orderQualifiers(championship, seed);
  appendBracket(state, eventId, 'championship', orderedChampionship, tournament);
  if (tournament.consolationEnabled) {
    appendBracket(state, eventId, 'consolation', orderQualifiers(consolation, seed + 1), tournament);
  }
  tournament.state = 'playoffs';
  bumpTournament(state, eventId);
  autoAdvanceDemoByes(state, eventId);
  return { ok: true, value: { revision: tournament.revision } };
}

export function resolveDemoSlot(slot: Slot, matches: readonly DemoMatch[]): ResolvedSlot {
  if (slot.kind === 'entry') return { resolved: true, entryId: slot.entryId };
  if (slot.kind === 'empty') return { resolved: true, entryId: null };
  const feeder = matches.find((match) => match.matchKey === slot.matchKey);
  if (!feeder || (feeder.state !== 'completed' && feeder.state !== 'bye' && feeder.state !== 'void')) {
    return { resolved: false, entryId: null };
  }
  return { resolved: true, entryId: feeder.winnerEntryId };
}

export function resolvedDemoMatch(
  match: DemoMatch,
  matches: readonly DemoMatch[],
): { resolved: boolean; entryAId: Id | null; entryBId: Id | null } {
  const a = resolveDemoSlot(match.a, matches);
  const b = resolveDemoSlot(match.b, matches);
  return { resolved: a.resolved && b.resolved, entryAId: a.entryId, entryBId: b.entryId };
}

function matchWriteLock(state: DemoState, match: DemoMatch): string | null {
  const tournament = getTournament(state, match.eventId);
  if (!tournament || tournament.state === 'finished' || tournament.state === 'cancelled') {
    return 'This event is read-only.';
  }
  if ((tournament.state === 'groups' && match.stage === 'groups')
    || (tournament.state === 'playoffs' && match.stage === 'playoffs')) return null;
  return 'Matches can only be changed during their event stage.';
}

function getDependentMatches(matches: readonly DemoMatch[], matchKey: string): DemoMatch[] {
  const descendants: DemoMatch[] = [];
  const visitedKeys = new Set<string>();
  const visit = (key: string) => {
    if (visitedKeys.has(key)) return;
    visitedKeys.add(key);
    for (const match of matches) {
      if (match.stage !== 'playoffs'
        || !((match.a.kind === 'winner' && match.a.matchKey === key)
          || (match.b.kind === 'winner' && match.b.matchKey === key))) continue;
      descendants.push(match);
      visit(match.matchKey);
    }
  };
  visit(matchKey);
  return descendants;
}

function resetDependentMatches(matches: readonly DemoMatch[], matchKey: string): void {
  for (const dependent of getDependentMatches(matches, matchKey)) {
    dependent.state = 'pending';
    dependent.kind = null;
    dependent.games = [];
    dependent.winnerEntryId = null;
    dependent.reason = null;
    dependent.tableNumber = null;
    dependent.entryAId = dependent.a.kind === 'entry' ? dependent.a.entryId : null;
    dependent.entryBId = dependent.b.kind === 'entry' ? dependent.b.entryId : null;
    dependent.version += 1;
    dependent.updatedAt = nowIso();
  }
}

export function autoAdvanceDemoByes(state: DemoState, eventId: Id): boolean {
  const matches = state.matches.filter((match) => match.eventId === eventId && match.stage === 'playoffs');
  let updated = false;
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of matches) {
      if (match.state !== 'pending') continue;
      const resolved = resolvedDemoMatch(match, matches);
      if (!resolved.resolved) continue;
      const participantsChanged = match.entryAId !== resolved.entryAId || match.entryBId !== resolved.entryBId;
      if (participantsChanged) {
        match.entryAId = resolved.entryAId;
        match.entryBId = resolved.entryBId;
        match.version += 1;
        match.updatedAt = nowIso();
        changed = true;
        updated = true;
      }
      const hasVoidFeeder = [match.a, match.b].some((slot) => {
        if (slot.kind !== 'winner') return false;
        const feeder = matches.find((candidate) => candidate.matchKey === slot.matchKey);
        return feeder?.state === 'void';
      });
      if (hasVoidFeeder) continue;
      const hasTrueBye = (match.a.kind === 'empty' && resolved.entryBId !== null)
        || (match.b.kind === 'empty' && resolved.entryAId !== null);
      if (!hasTrueBye) continue;
      match.state = 'bye';
      match.kind = 'bye';
      match.winnerEntryId = resolved.entryAId ?? resolved.entryBId;
      if (!participantsChanged) {
        match.updatedAt = nowIso();
        match.version += 1;
      }
      changed = true;
      updated = true;
    }
  }
  return updated;
}

export function startDemoMatch(
  state: DemoState,
  matchId: Id,
  tableNumber: number,
  expectedVersion: number,
): MutationResult<DemoMatch> {
  const match = state.matches.find((candidate) => candidate.id === matchId);
  if (!match) return { ok: false, code: 'invalid', message: 'Match not found.' };
  if (match.version !== expectedVersion) return { ok: false, code: 'conflict', message: 'This match changed. Refresh and try again.' };
  if (match.state !== 'pending') return { ok: false, code: 'blocked', message: 'This match is not ready to start.' };
  const tournament = getTournament(state, match.eventId);
  if (!tournament || tableNumber < 1 || tableNumber > tournament.tableCount) {
    return { ok: false, code: 'invalid', message: 'Choose a configured table.' };
  }
  const lock = matchWriteLock(state, match);
  if (lock) return { ok: false, code: 'blocked', message: lock };
  const eventMatches = state.matches.filter((candidate) => candidate.eventId === match.eventId);
  const resolved = resolvedDemoMatch(match, eventMatches);
  if (!resolved.resolved || !resolved.entryAId || !resolved.entryBId) {
    return { ok: false, code: 'blocked', message: 'Both players must be resolved before a table can be assigned.' };
  }
  if ([resolved.entryAId, resolved.entryBId].some((entryId) =>
    getEntry(state, entryId)?.registrationStatus === 'withdrawn')) {
    return { ok: false, code: 'blocked', message: 'A withdrawn entrant cannot start a match.' };
  }
  const active = state.matches.filter((candidate) =>
    candidate.eventId === match.eventId && candidate.state === 'active');
  if (active.some((candidate) => candidate.tableNumber === tableNumber)) {
    return { ok: false, code: 'conflict', message: `Table ${tableNumber} is already occupied.` };
  }
  const activeEntryIds = active.flatMap((candidate) => [candidate.entryAId, candidate.entryBId]);
  if ([resolved.entryAId, resolved.entryBId].some((entryId) => activeEntryIds.includes(entryId))) {
    return { ok: false, code: 'conflict', message: 'A player is already playing another match.' };
  }
  match.entryAId = resolved.entryAId;
  match.entryBId = resolved.entryBId;
  match.tableNumber = tableNumber;
  match.state = 'active';
  match.version += 1;
  match.updatedAt = nowIso();
  bumpTournament(state, match.eventId);
  return { ok: true, value: match };
}

function hasStartedDescendant(matches: readonly DemoMatch[], matchKey: string): boolean {
  return getDependentMatches(matches, matchKey).some((match) =>
    match.state === 'active' || match.state === 'completed'
    || (match.state === 'void' && match.reason !== null));
}

export function saveDemoScore(
  state: DemoState,
  matchId: Id,
  expectedVersion: number,
  games: GameScore[],
  correcting = false,
): MutationResult<DemoMatch> {
  const match = state.matches.find((candidate) => candidate.id === matchId);
  if (!match) return { ok: false, code: 'invalid', message: 'Match not found.' };
  if (match.version !== expectedVersion) return { ok: false, code: 'conflict', message: 'A newer result is saved. Reopen the match before editing.' };
  const lock = matchWriteLock(state, match);
  if (lock) return { ok: false, code: 'blocked', message: lock };
  if (match.state === 'completed' && !correcting) return { ok: false, code: 'blocked', message: 'This match already has a saved result.' };
  if (match.state !== 'pending' && match.state !== 'active' && match.state !== 'completed') {
    return { ok: false, code: 'blocked', message: 'This match cannot accept a played score.' };
  }
  const validation = validateSeries(match.bestOf, games);
  if (!validation.ok) return { ok: false, code: 'invalid', message: validation.message };
  const eventMatches = state.matches.filter((candidate) => candidate.eventId === match.eventId);
  const resolved = resolvedDemoMatch(match, eventMatches);
  if (!resolved.resolved || !resolved.entryAId || !resolved.entryBId) {
    return { ok: false, code: 'blocked', message: 'Both match participants must be resolved.' };
  }
  if ([resolved.entryAId, resolved.entryBId].some((entryId) =>
    getEntry(state, entryId)?.registrationStatus === 'withdrawn')) {
    return { ok: false, code: 'blocked', message: 'A withdrawn entrant cannot receive a played score.' };
  }
  const nextWinner = validation.winner === 'a' ? resolved.entryAId : resolved.entryBId;
  if (correcting && match.winnerEntryId !== nextWinner) {
    if (hasStartedDescendant(eventMatches, match.matchKey)) {
      return { ok: false, code: 'blocked', message: 'A dependent playoff match has started or has a result. Clear downstream matches in reverse order first.' };
    }
    resetDependentMatches(eventMatches, match.matchKey);
  }
  match.entryAId = resolved.entryAId;
  match.entryBId = resolved.entryBId;
  match.games = games.map(([a, b]) => [a, b] as const);
  match.kind = 'played';
  match.winnerEntryId = nextWinner;
  match.state = 'completed';
  match.tableNumber = null;
  match.reason = null;
  match.version += 1;
  match.updatedAt = nowIso();
  bumpTournament(state, match.eventId);
  autoAdvanceDemoByes(state, match.eventId);
  return { ok: true, value: match };
}

export function saveDemoUnplayedResult(
  state: DemoState,
  matchId: Id,
  expectedVersion: number,
  kind: 'walkover' | 'void',
  winnerEntryId: Id | null,
  reason: string,
): MutationResult<DemoMatch> {
  const match = state.matches.find((candidate) => candidate.id === matchId);
  if (!match) return { ok: false, code: 'invalid', message: 'Match not found.' };
  if (match.version !== expectedVersion) return { ok: false, code: 'conflict', message: 'This match changed. Refresh and reopen it.' };
  const lock = matchWriteLock(state, match);
  if (lock) return { ok: false, code: 'blocked', message: lock };
  if (match.stage !== 'groups' && match.stage !== 'playoffs') return { ok: false, code: 'invalid', message: 'Match stage is invalid.' };
  if (match.state !== 'pending' && match.state !== 'active') return { ok: false, code: 'blocked', message: 'Only a ready or active match can be resolved this way.' };
  const eventMatches = state.matches.filter((candidate) => candidate.eventId === match.eventId);
  const resolved = resolvedDemoMatch(match, eventMatches);
  if (!resolved.resolved) return { ok: false, code: 'blocked', message: 'Resolve the feeder matches before resolving this match.' };
  const trimmedReason = reason.trim();
  if (!trimmedReason || trimmedReason.length > 240) {
    return { ok: false, code: 'invalid', message: 'Add a short reason of no more than 240 characters.' };
  }
  const availableEntries = [resolved.entryAId, resolved.entryBId]
    .filter((entryId): entryId is Id => entryId !== null)
    .filter((entryId) => getEntry(state, entryId)?.registrationStatus !== 'withdrawn');
  if (kind === 'walkover' && (!winnerEntryId || !availableEntries.includes(winnerEntryId))) {
    return { ok: false, code: 'invalid', message: 'Select a resolved, non-withdrawn walkover winner.' };
  }
  if (kind === 'void' && availableEntries.length > 0) {
    return { ok: false, code: 'invalid', message: 'Use a walkover when an available entrant can advance.' };
  }
  match.entryAId = resolved.entryAId;
  match.entryBId = resolved.entryBId;
  match.kind = kind;
  match.winnerEntryId = kind === 'walkover' ? winnerEntryId : null;
  match.games = [];
  match.reason = trimmedReason;
  match.state = kind === 'walkover' ? 'completed' : 'void';
  match.tableNumber = null;
  match.version += 1;
  match.updatedAt = nowIso();
  bumpTournament(state, match.eventId);
  autoAdvanceDemoByes(state, match.eventId);
  return { ok: true, value: match };
}

export function clearDemoResult(
  state: DemoState,
  matchId: Id,
  expectedVersion: number,
): MutationResult<DemoMatch> {
  const match = state.matches.find((candidate) => candidate.id === matchId);
  if (!match) return { ok: false, code: 'invalid', message: 'Match not found.' };
  if (match.version !== expectedVersion) return { ok: false, code: 'conflict', message: 'This match changed. Refresh and try again.' };
  const lock = matchWriteLock(state, match);
  if (lock) return { ok: false, code: 'blocked', message: lock };
  if (match.state !== 'completed' && match.state !== 'void') return { ok: false, code: 'blocked', message: 'Only a saved result can be cleared.' };
  const eventMatches = state.matches.filter((candidate) => candidate.eventId === match.eventId);
  if (match.stage === 'playoffs' && hasStartedDescendant(eventMatches, match.matchKey)) {
    return { ok: false, code: 'blocked', message: 'A dependent playoff match has started or has a result. Clear it first.' };
  }
  if (match.stage === 'playoffs') resetDependentMatches(eventMatches, match.matchKey);
  match.state = 'pending';
  match.kind = null;
  match.games = [];
  match.winnerEntryId = null;
  match.reason = null;
  match.tableNumber = null;
  match.entryAId = match.stage === 'groups' && match.a.kind === 'entry' ? match.a.entryId : null;
  match.entryBId = match.stage === 'groups' && match.b.kind === 'entry' ? match.b.entryId : null;
  match.version += 1;
  match.updatedAt = nowIso();
  bumpTournament(state, match.eventId);
  autoAdvanceDemoByes(state, match.eventId);
  return { ok: true, value: match };
}

export function withdrawDemoEntry(state: DemoState, entryId: Id): MutationResult<Entry> {
  const entry = getEntry(state, entryId);
  if (!entry) return { ok: false, code: 'invalid', message: 'Entrant not found.' };
  return updateDemoEntry(state, entryId, { registrationStatus: 'withdrawn', checkedIn: false });
}

export function finishDemoTournament(
  state: DemoState,
  eventId: Id,
  expectedRevision: number,
): MutationResult<Tournament> {
  const tournament = getTournament(state, eventId);
  if (!tournament) return { ok: false, code: 'invalid', message: 'Event not found.' };
  if (tournament.state === 'finished') return { ok: true, value: tournament };
  if (tournament.state !== 'playoffs') return { ok: false, code: 'blocked', message: 'Create playoffs before finishing the event.' };
  if (tournament.revision !== expectedRevision) return { ok: false, code: 'conflict', message: 'The event changed. Refresh before finishing.' };
  const unfinished = state.matches.filter((match) =>
    match.eventId === eventId && match.state !== 'completed' && match.state !== 'bye' && match.state !== 'void');
  if (unfinished.length) return { ok: false, code: 'blocked', message: `${unfinished.length} match${unfinished.length === 1 ? '' : 'es'} still need a result.` };

  const entries = state.entries.filter((entry) => entry.tournamentId === eventId);
  const ratings = new Map<Id, number>();
  const ratedCounts = new Map<Id, number>();
  for (const entry of entries) {
    const player = getPlayer(state, entry.playerId);
    if (!player) continue;
    entry.ratingBefore = player.rating;
    ratings.set(player.id, player.rating);
    ratedCounts.set(player.id, player.ratedMatchCount);
  }
  const results = state.matches
    .filter((match) => match.eventId === eventId && match.kind === 'played' && match.entryAId && match.entryBId && match.winnerEntryId)
    .sort((a, b) => (a.stage === b.stage ? a.round - b.round || a.sequence - b.sequence : a.stage === 'groups' ? -1 : 1));
  for (const match of results) {
    const entryA = getEntry(state, match.entryAId!);
    const entryB = getEntry(state, match.entryBId!);
    if (!entryA || !entryB) continue;
    const playerA = getPlayer(state, entryA.playerId);
    const playerB = getPlayer(state, entryB.playerId);
    if (!playerA || !playerB) continue;
    const updated = applyEloResult(
      ratings.get(playerA.id) ?? playerA.rating,
      ratings.get(playerB.id) ?? playerB.rating,
      { entryA: entryA.id, entryB: entryB.id, kind: 'played', winnerId: match.winnerEntryId },
    );
    ratings.set(playerA.id, updated.ratingA);
    ratings.set(playerB.id, updated.ratingB);
    ratedCounts.set(playerA.id, (ratedCounts.get(playerA.id) ?? playerA.ratedMatchCount) + 1);
    ratedCounts.set(playerB.id, (ratedCounts.get(playerB.id) ?? playerB.ratedMatchCount) + 1);
  }
  for (const entry of entries) {
    const player = getPlayer(state, entry.playerId);
    if (!player) continue;
    player.rating = ratings.get(player.id) ?? player.rating;
    player.ratedMatchCount = ratedCounts.get(player.id) ?? player.ratedMatchCount;
    player.updatedAt = nowIso();
    entry.ratingAfter = player.rating;
    entry.updatedAt = nowIso();
  }
  tournament.state = 'finished';
  tournament.finalizedAt = nowIso();
  bumpTournament(state, eventId);
  return { ok: true, value: tournament };
}

export function cancelDemoTournament(state: DemoState, eventId: Id, expectedRevision: number): MutationResult<Tournament> {
  const tournament = getTournament(state, eventId);
  if (!tournament) return { ok: false, code: 'invalid', message: 'Event not found.' };
  if (tournament.state === 'finished' || tournament.state === 'cancelled') {
    return { ok: false, code: 'blocked', message: 'This event is already closed.' };
  }
  if (tournament.revision !== expectedRevision) return { ok: false, code: 'conflict', message: 'The event changed. Refresh and try again.' };
  for (const match of state.matches.filter((candidate) => candidate.eventId === eventId && candidate.state === 'active')) {
    match.tableNumber = null;
    match.state = 'pending';
    match.version += 1;
  }
  tournament.state = 'cancelled';
  bumpTournament(state, eventId);
  return { ok: true, value: tournament };
}

export function tournamentChampion(state: DemoState, eventId: Id, division: Division): Entry | undefined {
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

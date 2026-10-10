import type { DemoState } from './demo';

function safeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const protectedText = /^[\s\u0000-\u001f\u007f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(safeCell).join(',')).join('\r\n') + '\r\n';
}

export function safeFilename(filename: string): string {
  const cleaned = filename.normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .replace(/[.\s-]+$/g, '');
  const result = cleaned || 'table-tennis-tournament-export';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result) ? `_${result}` : result;
}

function safeEventSlug(name: string): string {
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'event';
}

export function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFilename(filename);
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function downloadCsv(filename: string, rows: readonly (readonly unknown[])[]): void {
  downloadText(filename, '\ufeff' + toCsv(rows), 'text/csv;charset=utf-8');
}

export function downloadJson(filename: string, value: unknown): void {
  downloadText(filename, JSON.stringify(value, null, 2), 'application/json;charset=utf-8');
}

export function downloadRosterCsv(state: DemoState, eventId: string): void {
  const event = state.tournaments.find((tournament) => tournament.id === eventId);
  if (!event) throw new Error('Event not found.');
  const entries = state.entries.filter((entry) => entry.tournamentId === eventId)
    .sort((left, right) => {
      const nameLeft = state.players.find((player) => player.id === left.playerId)?.name ?? left.player?.name ?? '';
      const nameRight = state.players.find((player) => player.id === right.playerId)?.name ?? right.player?.name ?? '';
      return nameLeft.localeCompare(nameRight);
    });
  const rows: unknown[][] = [[
    'Event', 'Player', 'Label', 'Registration status', 'Checked in', 'Paid', 'Payment method',
    'Base fee (CAD)', 'Discount (CAD)', 'Amount paid (CAD)', 'Balance due (CAD)', 'Payment note',
    'Rating', 'Rated matches', 'Group', 'Seed position', 'Rating before', 'Rating after',
  ]];
  for (const entry of entries) {
    const player = state.players.find((candidate) => candidate.id === entry.playerId) ?? entry.player;
    const baseFee = entry.baseFeeCents;
    const discount = entry.discountCents;
    const amountPaid = entry.amountPaidCents;
    rows.push([
      event.name, player?.name ?? '', player?.label ?? '', entry.registrationStatus,
      entry.checkedIn ? 'Yes' : 'No', entry.paid ? 'Yes' : 'No', entry.paymentMethod ?? '',
      (baseFee / 100).toFixed(2), (discount / 100).toFixed(2), (amountPaid / 100).toFixed(2),
      ((baseFee - discount - amountPaid) / 100).toFixed(2), entry.paymentNote ?? '',
      player?.rating ?? '', player?.ratedMatchCount ?? '', entry.groupIndex ?? '', entry.seedPosition ?? '',
      entry.ratingBefore ?? '', entry.ratingAfter ?? '',
    ]);
  }
  downloadCsv(`${safeEventSlug(event.name)}-roster.csv`, rows);
}

export function downloadResultsCsv(state: DemoState, eventId: string): void {
  const event = state.tournaments.find((tournament) => tournament.id === eventId);
  if (!event) throw new Error('Event not found.');
  const entries = new Map(state.entries.filter((entry) => entry.tournamentId === eventId).map((entry) => [entry.id, entry]));
  const playerName = (entryId: string | null): string => {
    const entry = entryId ? entries.get(entryId) : undefined;
    return entry
      ? state.players.find((player) => player.id === entry.playerId)?.name ?? entry.player?.name ?? ''
      : '';
  };
  const matches = state.matches.filter((match) => match.eventId === eventId).sort((left, right) =>
    (left.stage === right.stage ? 0 : left.stage === 'groups' ? -1 : 1)
    || (left.division ?? '').localeCompare(right.division ?? '')
    || (left.groupIndex ?? 0) - (right.groupIndex ?? 0)
    || left.round - right.round || left.sequence - right.sequence);
  const rows: unknown[][] = [[
    'Event', 'Stage', 'Division', 'Group', 'Round', 'Match', 'Player A', 'Player B', 'State',
    'Result', 'Winner', 'Games', 'Reason', 'Table', 'Updated at',
  ]];
  for (const match of matches) {
    rows.push([
      event.name, match.stage, match.division ?? '', match.groupIndex ?? '', match.round, match.matchKey,
      playerName(match.entryAId), playerName(match.entryBId), match.state, match.kind ?? '',
      playerName(match.winnerEntryId), match.games.map(([a, b]) => `${a}-${b}`).join(' '),
      match.reason ?? '', match.tableNumber ?? '', match.updatedAt ?? '',
    ]);
  }
  downloadCsv(`${safeEventSlug(event.name)}-results.csv`, rows);
}

export type WorkspaceSnapshotScope = 'local-demo' | 'current-workspace';

/** Export the records currently available to this workspace, with their coverage made explicit. */
export function downloadWorkspaceSnapshot(state: DemoState, scope: WorkspaceSnapshotScope): void {
  const snapshot = {
    format: 'table-tennis-tournament-workspace-snapshot',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: {
      kind: scope,
      description: scope === 'local-demo'
        ? 'All records in the local demo workspace.'
        : 'Records loaded for the current workspace; entries and matches may cover only the selected event.',
      tournamentIds: state.tournaments.map((tournament) => tournament.id),
      entryTournamentIds: [...new Set(state.entries.map((entry) => entry.tournamentId))],
      matchEventIds: [...new Set(state.matches.map((match) => match.eventId))],
      counts: {
        players: state.players.length,
        tournaments: state.tournaments.length,
        entries: state.entries.length,
        matches: state.matches.length,
      },
    },
    players: state.players,
    tournaments: state.tournaments,
    entries: state.entries,
    matches: state.matches,
  };
  const day = new Date().toISOString().slice(0, 10);
  downloadJson(`table-tennis-tournament-${scope}-snapshot-${day}.json`, snapshot);
}

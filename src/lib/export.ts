import type { TournamentState } from './tournament';

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

export function downloadRosterCsv(state: TournamentState, eventId: string): void {
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
      player?.ratedMatchCount === 0 ? 'Unrated' : player?.rating ?? '', player?.ratedMatchCount ?? '', entry.groupIndex ?? '', entry.seedPosition ?? '',
      entry.ratingBefore ?? '', entry.ratingAfter ?? '',
    ]);
  }
  downloadCsv(`${safeEventSlug(event.name)}-roster.csv`, rows);
}

export function downloadResultsCsv(state: TournamentState, eventId: string): void {
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

export function downloadWorkspaceSnapshot(state: TournamentState, eventId: string): void {
  const event = state.tournaments.find((tournament) => tournament.id === eventId);
  if (!event) throw new Error('Event not found.');
  const entries = state.entries.filter((entry) => entry.tournamentId === eventId);
  const matches = state.matches.filter((match) => match.eventId === eventId);
  const playerIds = new Set(entries.map((entry) => entry.playerId));
  const players = state.players.filter((player) => playerIds.has(player.id));
  const exportedAt = new Date().toISOString();
  const snapshot = {
    format: 'table-tennis-tournament-workspace-snapshot',
    version: 1,
    exportedAt,
    scope: {
      kind: 'selected-event',
      description: 'Roster, payments and matches for the selected event.',
      tournamentIds: [eventId],
      entryTournamentIds: entries.length ? [eventId] : [],
      matchEventIds: matches.length ? [eventId] : [],
      counts: {
        players: players.length,
        tournaments: 1,
        entries: entries.length,
        matches: matches.length,
      },
    },
    players,
    tournaments: [event],
    entries,
    matches,
  };
  const stamp = exportedAt.slice(0, 19).replaceAll(':', '-');
  downloadJson(`${safeEventSlug(event.name)}-snapshot-${stamp}.json`, snapshot);
}

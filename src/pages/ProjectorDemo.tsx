import { useState } from 'react';
import { buildBracket } from '../domain/bracket';
import type { TournamentMatch, TournamentState } from '../lib/tournament';
import type { Entry, Player, Tournament } from '../types';
import { Display } from './Display';

const names = ['Alex Morgan', 'Avery Lee', 'Ben Patel', 'Caleb Chen', 'Casey Brown', 'Charlie Kim', 'Daniel Wong', 'Eli Martin', 'Emma Singh', 'Ethan Park', 'Grace Liu', 'Harper Davis', 'Isaac Chen', 'Jamie Taylor', 'Jordan Hall', 'Kai Wilson', 'Liam Nguyen', 'Maya Shah', 'Mia Thompson', 'Noah Williams', 'Olivia Tran', 'Sam Jones', 'Sophie Clark'];
const now = new Date().toISOString();
const players: Player[] = names.map((name, index) => ({ id: `p${index}`, name, label: null, experience: 'unknown', rating: 1000, ratedMatchCount: 0, archived: false, createdAt: now, updatedAt: now }));
const entries: Entry[] = players.map((player, index) => ({ id: `e${index}`, tournamentId: 'demo', playerId: player.id, registrationStatus: 'registered', checkedIn: true, paid: false, paymentMethod: null, amountPaidCents: 0, discountCents: 0, paymentNote: null, baseFeeCents: 1000, groupIndex: Math.floor(index / 4) + 1, seedValue: null, seedPosition: null, ratingBefore: null, ratingAfter: null, createdAt: now, updatedAt: now }));
const tournament: Tournament = { id: 'demo', name: 'Sample tournament · 23 players', startsAt: now, bookingMinutes: 180, entryFeeCents: 1000, registrationCap: 23, tableCount: 3, groupBestOf: 3, playoffBestOf: 3, finalBestOf: 5, qualifiersPerGroup: 4, consolationEnabled: false, state: 'groups', drawSeed: null, drawMode: null, lotOrders: {}, revision: 0, finalizedAt: null, createdAt: now, updatedAt: now };
const bracketMatches: TournamentMatch[] = buildBracket(entries.map((entry) => entry.id), 3, 5).map((match) => ({ id: match.key, matchKey: match.key, eventId: 'demo', stage: 'playoffs', division: 'championship', groupIndex: null, round: match.round, sequence: match.sequence, a: match.a, b: match.b, entryAId: match.a.kind === 'entry' ? match.a.entryId : null, entryBId: match.b.kind === 'entry' ? match.b.entryId : null, bestOf: match.bestOf, tableNumber: null, state: match.a.kind === 'empty' || match.b.kind === 'empty' ? 'bye' : 'pending', kind: null, games: [], winnerEntryId: match.a.kind === 'empty' && match.b.kind === 'entry' ? match.b.entryId : match.b.kind === 'empty' && match.a.kind === 'entry' ? match.a.entryId : null, reason: null, version: 0, updatedAt: null }));

const groupMatches: TournamentMatch[] = entries.flatMap((entry, index) => entries.slice(index + 1).filter((other) => other.groupIndex === entry.groupIndex).map((other, sequence) => ({ id: `g${index}-${sequence}`, matchKey: `g${index}-${sequence}`, eventId: 'demo', stage: 'groups' as const, division: null, groupIndex: entry.groupIndex, round: 1, sequence: sequence + 1, a: { kind: 'entry' as const, entryId: entry.id }, b: { kind: 'entry' as const, entryId: other.id }, entryAId: entry.id, entryBId: other.id, bestOf: 3 as const, tableNumber: null, state: 'pending' as const, kind: null, games: [], winnerEntryId: null, reason: null, version: 0, updatedAt: null })));

export function ProjectorDemo() {
  const [stage, setStage] = useState<'groups' | 'playoffs'>('groups');
  const event = { ...tournament, state: stage };
  const state: TournamentState = { players, entries, tournaments: [event], matches: [...groupMatches, ...bracketMatches] };
  return <><div style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 100, display: 'flex', gap: 8, background: 'white', padding: 8, borderRadius: 8 }}><strong>Sample view</strong><button type="button" onClick={() => setStage('groups')}>Groups</button><button type="button" onClick={() => setStage('playoffs')}>Knockout bracket</button></div><Display state={state} event={event} error={null} lastRefreshed={null} /></>;
}

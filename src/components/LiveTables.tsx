import { useEffect, useState } from 'react';
import { getEntries, resolvedDemoMatch, type DemoMatch, type DemoState } from '../lib/demo';
import type { Tournament } from '../types';

export function entryNames(state: DemoState, eventId: string): Map<string, string> {
  return new Map(getEntries(state, eventId).map((entry) => [entry.id, entry.player?.name ?? 'Unknown player']));
}

export function matchLabel(match: DemoMatch): string {
  return match.stage === 'groups' ? `Group ${match.groupIndex} · round ${match.round}`
    : `${match.division === 'consolation' ? 'Consolation' : 'Championship'} · round ${match.round}`;
}

export function LiveTables({ state, event, now }: { state: DemoState; event: Tournament; now?: Date }) {
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const matches = state.matches.filter((match) => match.eventId === event.id);
  const names = entryNames(state, event.id);
  const active = matches.filter((match) => match.state === 'active');
  return <div className="live-tables" aria-label="Live table assignments">
    {Array.from({ length: event.tableCount }, (_, index) => {
      const table = index + 1;
      const match = active.find((candidate) => candidate.tableNumber === table);
      const resolved = match ? resolvedDemoMatch(match, matches) : null;
      // While active, updatedAt is the timestamp written by the start-match operation.
      const started = match?.updatedAt ? new Date(match.updatedAt) : null;
      const validTime = started && Number.isFinite(started.getTime());
      return <article className={'live-table' + (match ? ' is-playing' : '')} key={table}>
        <header><h3>Table {table}</h3><span>{match ? 'Playing now' : 'Available'}</span></header>
        {match ? <>
          <div className="live-opponents"><strong>{names.get(match.entryAId ?? resolved?.entryAId ?? '') ?? 'Awaiting player'}</strong><span>vs</span><strong>{names.get(match.entryBId ?? resolved?.entryBId ?? '') ?? 'Awaiting player'}</strong></div>
          <p>{matchLabel(match)}</p>
          {validTime && <small>Started <time dateTime={started.toISOString()}>{started.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time> · {Math.max(0, Math.floor(((now ?? clock).getTime() - started.getTime()) / 60000))} min elapsed</small>}
        </> : <p>{event.state === 'setup' ? 'Waiting for the draw' : event.state === 'finished' || event.state === 'cancelled' ? 'Event ended' : 'Waiting for the next assignment'}</p>}
      </article>;
    })}
    {active.some((match) => !match.tableNumber || match.tableNumber > event.tableCount) && <p className="field-error">An active match has no configured table. Check Matches.</p>}
  </div>;
}

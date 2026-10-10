import { useMemo } from 'react';
import { tournamentChampion, type DemoState } from '../lib/demo';
import { downloadResultsCsv, downloadWorkspaceSnapshot } from '../lib/export';
import type { Tournament } from '../types';

interface ResultsProps {
  state: DemoState;
  tournaments: Tournament[];
  selectedEventId: string;
  remoteWorkspace: boolean;
  onSelectEvent: (eventId: string) => void;
  readOnly?: boolean;
}

const date = (value: string) => new Date(value).toLocaleDateString('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });

export function Results({ state, tournaments, selectedEventId, remoteWorkspace, onSelectEvent, readOnly = false }: ResultsProps) {
  const completed = useMemo(() => tournaments.filter((tournament) => tournament.state === 'finished' || tournament.state === 'cancelled'), [tournaments]);
  const isLoaded = (eventId: string) => !remoteWorkspace || eventId === selectedEventId;
  const entryPlayerName = (entryId: string | null | undefined) => {
    if (!entryId) return '';
    const entry = state.entries.find((item) => item.id === entryId);
    return state.players.find((player) => player.id === entry?.playerId)?.name ?? entry?.player?.name ?? '';
  };

  return <section className="page-section" aria-labelledby="results-heading">
    <div className="section-heading"><div><h2 id="results-heading">Results &amp; history</h2><p>Finished events, winners and saved match results.</p></div><span className="section-count">{completed.filter((event) => event.state === 'finished').length} finished</span></div>
    {completed.length === 0 && <div className="empty-panel"><strong>No completed events yet</strong><p>Finish an event to record winners and ratings in player history.</p></div>}
    <div className="history-list">{completed.map((tournament) => {
      const loaded = isLoaded(tournament.id);
      if (!loaded) return <article className="history-event history-event-summary" key={tournament.id}>
        <header><div><span className={'status-pill status-' + tournament.state}>{tournament.state}</span><h3>{tournament.name}</h3><p>{date(tournament.startsAt)}</p></div><button className="button button-secondary button-small" type="button" onClick={() => onSelectEvent(tournament.id)}>Open event</button></header>
        <p className="table-note">Roster and results are not loaded for this event yet. Open it to view its saved results.</p>
      </article>;

      const eventEntries = state.entries.filter((entry) => entry.tournamentId === tournament.id);
      const eventMatches = state.matches.filter((match) => match.eventId === tournament.id);
      const champion = tournamentChampion(state, tournament.id, 'championship');
      const consolation = tournamentChampion(state, tournament.id, 'consolation');
      const finalRows = eventMatches.filter((match) => match.stage === 'playoffs' && match.round === Math.max(0, ...eventMatches.filter((candidate) => candidate.stage === 'playoffs' && candidate.division === match.division).map((candidate) => candidate.round)));
      const championName = entryPlayerName(champion?.id);
      const consolationName = entryPlayerName(consolation?.id);
      return <article className="history-event" key={tournament.id}>
        <header><div><span className={'status-pill status-' + tournament.state}>{tournament.state}</span><h3>{tournament.name}</h3><p>{date(tournament.startsAt)} · {eventEntries.length} entries · {eventMatches.filter((match) => match.kind === 'played').length} played results</p></div>
          {!readOnly && <div className="history-actions"><button className="button button-secondary button-small" type="button" onClick={() => downloadResultsCsv(state, tournament.id)}>Export results CSV</button><button className="button button-secondary button-small" type="button" onClick={() => downloadWorkspaceSnapshot(state, remoteWorkspace ? 'current-workspace' : 'local-demo')}>Export workspace snapshot</button></div>}
        </header>
        {tournament.state === 'finished' ? <div className="winner-grid"><div><span>Championship winner</span><strong>{championName || 'No champion'}</strong>{champion?.ratingBefore !== null && champion?.ratingBefore !== undefined && <small>Rating after event: {champion.ratingAfter?.toFixed(0) ?? '—'}</small>}</div><div><span>Consolation winner</span><strong>{consolationName || 'No champion'}</strong></div></div> : <p className="table-note">Cancelled event · recorded scores are preserved; ratings were not applied.</p>}
        {finalRows.length > 0 && <details className="history-matches"><summary>Show final-round results ({finalRows.length})</summary><div>{finalRows.map((match) => <p key={match.id}><strong>{entryPlayerName(match.entryAId)} vs {entryPlayerName(match.entryBId)}</strong><span>{match.games.map((game) => game[0] + '–' + game[1]).join(', ') || (match.kind ?? '')}</span></p>)}</div></details>}
      </article>;
    })}</div>
    {!readOnly && <p className="table-note">CSV exports contain fixtures and results only. Workspace snapshots include the records currently available; shared workspace snapshots may cover only the selected event.</p>}
  </section>;
}

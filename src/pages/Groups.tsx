import { useState } from 'react';
import { suggestGroups } from '../domain/groups';
import { getEntries, groupStandings, groupsReadyForPlayoffs, previewGroups, resolvedDemoMatch, type DemoState } from '../lib/demo';
import type { GroupPlan, Tournament } from '../types';

interface GroupsProps {
  state: DemoState;
  event: Tournament;
  onStart: (plans: GroupPlan[], seed: number, mode: 'random' | 'balanced') => Promise<string | null>;
  onPlayoffs: (seed: number) => Promise<string | null>;
  onRecordLots: (groupIndex: number, entryIds: string[]) => Promise<string | null>;
  onResetPlayoffs: () => Promise<string | null>;
  readOnly?: boolean;
}

export function Groups({ state, event, onStart, onPlayoffs, onRecordLots, onResetPlayoffs, readOnly = false }: GroupsProps) {
  const entries = getEntries(state, event.id);
  const checkedIn = entries.filter((entry) => entry.registrationStatus === 'registered' && entry.checkedIn);
  const options = suggestGroups(checkedIn.length);
  const [optionIndex, setOptionIndex] = useState(0);
  const [mode, setMode] = useState<'balanced' | 'random'>('balanced');
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000));
  const [averageMatchMinutes, setAverageMatchMinutes] = useState(10);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<GroupPlan[] | null>(null);
  const selectedOption = options[Math.min(optionIndex, Math.max(0, options.length - 1))];
  const currentMatches = state.matches.filter((match) => match.eventId === event.id);
  const groupNumbers = [...new Set(entries.map((entry) => entry.groupIndex).filter((value): value is number => value !== null))].sort((a, b) => a - b);
  const playoffsAllowed = groupsReadyForPlayoffs(state, event.id);
  const playoffMatches = currentMatches.filter((match) => match.stage === 'playoffs');
  let currentPreview: GroupPlan[] | null = null;
  if (selectedOption && event.state === 'setup') {
    try { currentPreview = previewGroups(state, event.id, selectedOption.sizes, mode, seed); } catch { currentPreview = null; }
  }
  const visiblePreview = preview ?? currentPreview;
  const projectedChampionshipEntrants = selectedOption?.sizes.reduce((sum, size) => sum + Math.min(event.qualifiersPerGroup, size), 0) ?? 0;
  const projectedConsolationEntrants = Math.max(0, checkedIn.length - projectedChampionshipEntrants);
  const projectedPlayoffMatches = (projectedChampionshipEntrants > 1 ? projectedChampionshipEntrants - 1 : 0)
    + (event.consolationEnabled && projectedConsolationEntrants > 1 ? projectedConsolationEntrants - 1 : 0);
  const groupMatchCount = selectedOption?.matchCount ?? 0;
  const estimatedFixtures = groupMatchCount + projectedPlayoffMatches;
  const tableMinutes = Math.ceil(estimatedFixtures * averageMatchMinutes / Math.max(1, event.tableCount));
  const bookingOverrun = tableMinutes > event.bookingMinutes;
  const entryName = (entryId: string) => {
    const entry = entries.find((candidate) => candidate.id === entryId);
    return entry?.player?.name ?? state.players.find((player) => player.id === entry?.playerId)?.name ?? 'Unknown player';
  };

  async function run(action: () => Promise<string | null>, success: string) {
    setBusy(true);
    setMessage(null);
    try { setMessage((await action()) ?? success); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  if (event.state === 'setup') {
    return (
      <section className="page-section" aria-labelledby="groups-heading">
        <div className="section-heading"><div><h2 id="groups-heading">Groups &amp; bracket</h2><p>Review a saved-seed draw before groups begin.</p></div><span className="section-count">{checkedIn.length} checked in</span></div>
        {checkedIn.length < 4 ? <div className="notice-card"><strong>Check in at least four players</strong><p>A competitive draw needs four or more checked-in entrants.</p></div> : <>
          <div className="draw-controls">
            <label><span>Group sizes</span><select value={optionIndex} onChange={(event) => { setOptionIndex(Number(event.currentTarget.value)); setPreview(null); }}>
              {options.map((option, index) => <option value={index} key={option.sizes.join('-')}>{option.sizes.join(' · ')} — {option.matchCount} matches</option>)}
            </select></label>
            <label><span>Seeding</span><select value={mode} onChange={(event) => { setMode(event.currentTarget.value as 'random' | 'balanced'); setPreview(null); }}><option value="balanced">Balanced by rating / experience</option><option value="random">Random</option></select></label>
            <label><span>Draw seed</span><input type="number" value={seed} onChange={(event) => { setSeed(Number(event.currentTarget.value)); setPreview(null); }} /></label>
            <button className="button button-secondary" type="button" onClick={() => { setSeed(Math.floor(Math.random() * 1_000_000_000)); setPreview(null); }}>New draw</button>
            <label className="average-minutes-input"><span>Minutes per match</span><input type="number" min="5" max="45" step="1" value={averageMatchMinutes} onChange={(event) => setAverageMatchMinutes(Number(event.currentTarget.value))} /></label>
          </div>
          <div className={'time-estimate' + (bookingOverrun ? ' overrun' : '')}><div><span>Estimated fixtures</span><strong>{estimatedFixtures}</strong></div><div><span>Lower-bound table time</span><strong>{tableMinutes} min <small>of {event.bookingMinutes} min booked</small></strong></div><span className="time-estimate-status">{bookingOverrun ? 'Above booking time' : 'Within booking window'}</span></div>
          <p className="table-note">Unpaid entrants are still eligible. Preview includes checked-in, registered players only. Time estimate uses your minutes-per-match value and configured tables; it excludes changeovers and knockout dependencies and does not guarantee the event will fit.</p>
          {visiblePreview?.map((group) => <article className="group-card" key={group.groupIndex}>
            <header><h3>Group {group.groupIndex}</h3><span>{group.entryIds.length} players · {group.entryIds.length * (group.entryIds.length - 1) / 2} fixtures</span></header>
            <ol>{group.entryIds.map((entryId) => <li key={entryId}>{entryName(entryId)}{entries.find((entry) => entry.id === entryId)?.paid ? '' : <span className="badge badge-warn">fee unpaid</span>}</li>)}</ol>
          </article>)}
          {!readOnly && <div className="action-row"><button className="button button-primary" type="button" disabled={busy || !visiblePreview} onClick={() => void run(() => onStart(visiblePreview ?? [], seed, mode), 'Groups started and fixtures saved.')}>{busy ? 'Saving…' : 'Start groups'}</button><span className="muted-copy">{groupMatchCount} group matches · minimum {selectedOption?.minimumGroupMatches ?? 0} per player</span></div>}
        </>}
        {message && <p className={message.includes('saved') || message.includes('started') ? 'inline-success' : 'inline-status'} role="status">{message}</p>}
      </section>
    );
  }

  return (
    <section className="page-section" aria-labelledby="groups-heading">
      <div className="section-heading"><div><h2 id="groups-heading">Groups &amp; bracket</h2><p>Standings use match wins, head-to-head, game differential, then point differential.</p></div><span className={'status-pill status-' + event.state}>{event.state}</span></div>
      {event.state === 'groups' && groupNumbers.map((groupIndex) => {
        const standings = groupStandings(state, event.id, groupIndex);
        const tieIds = standings.filter((standing) => standing.rank === null).map((standing) => standing.entryId);
        const fixtures = currentMatches.filter((match) => match.stage === 'groups' && match.groupIndex === groupIndex);
        return <article className="group-card standings-card" key={groupIndex}>
          <header><h3>Group {groupIndex}</h3><span>{fixtures.filter((match) => match.state === 'completed' || match.state === 'void').length} / {fixtures.length} resolved</span></header>
          <div className="table-scroll"><table><thead><tr><th>Place</th><th>Player</th><th>W–L</th><th>Games</th><th>Points</th></tr></thead><tbody>
            {standings.map((standing) => <tr key={standing.entryId}><td>{standing.rank ?? 'Tie'}</td><th scope="row">{entryName(standing.entryId)}</th><td>{standing.wins}–{standing.losses}{standing.walkovers ? ' · ' + standing.walkovers + ' WO' : ''}</td><td>{standing.gameDifference > 0 ? '+' : ''}{standing.gameDifference}</td><td>{standing.pointDifference > 0 ? '+' : ''}{standing.pointDifference}</td></tr>)}
          </tbody></table></div>
          {tieIds.length > 0 && !readOnly && <button className="button button-secondary button-small" type="button" onClick={() => void run(() => onRecordLots(groupIndex, tieIds), 'Draw of lots recorded for Group ' + groupIndex + '.')}>Record draw of lots for tied places</button>}
        </article>;
      })}
      {event.state === 'groups' && <div className="action-row">
        <button className="button button-primary" type="button" disabled={readOnly || busy || !playoffsAllowed.ok} onClick={() => void run(() => onPlayoffs(seed), 'Playoff brackets created.')}>{busy ? 'Saving…' : 'Create playoffs'}</button>
        {!playoffsAllowed.ok && <span className="muted-copy">{playoffsAllowed.message}</span>}
      </div>}
      {playoffMatches.length > 0 && <>
        <div className="division-tabs"><span>Championship &amp; consolation</span></div>
        <div className="bracket-list">{['championship', 'consolation'].map((division) => {
          const matches = playoffMatches.filter((match) => match.division === division).sort((a, b) => a.round - b.round || a.sequence - b.sequence);
          if (matches.length === 0) return null;
          return <section key={division}><h3>{division === 'championship' ? 'Championship' : 'Consolation'}</h3>{matches.map((match) => {
            const resolved = resolvedDemoMatch(match, currentMatches);
            const entryAId = match.entryAId ?? resolved.entryAId;
            const entryBId = match.entryBId ?? resolved.entryBId;
            const roundName = matches.some((candidate) => candidate.round > match.round) ? 'Round ' + match.round : 'Final';
            return <div className="bracket-match" key={match.id}><span className="muted-copy">{roundName}</span><div><strong>{entryAId ? entryName(entryAId) : match.a.kind === 'winner' ? 'Winner of ' + match.a.matchKey : 'Bye'}</strong><small>{match.games.map((game) => game[0] + '–' + game[1]).join(', ') || (match.state === 'bye' ? 'Bye advanced' : 'Awaiting result')}</small></div><div><strong>{entryBId ? entryName(entryBId) : match.b.kind === 'winner' ? 'Winner of ' + match.b.matchKey : '—'}</strong><small>{match.winnerEntryId === entryBId && match.kind ? 'Winner' : ''}</small></div></div>;
          })}</section>;
        })}</div>
        {event.state === 'playoffs' && !readOnly && <div className="action-row"><button className="button button-secondary" type="button" disabled={busy} onClick={() => { if (window.confirm('Reset playoffs? This removes every saved playoff match result.')) void run(onResetPlayoffs, 'Playoffs reset.'); }}>Reset playoffs</button><span className="muted-copy">All playoff results will be cleared.</span></div>}
      </>}
      {event.state === 'finished' && <div className="notice-card"><strong>Event finished</strong><p>Ratings were applied once. This event is read-only.</p></div>}
      {message && <p className="inline-status" role="status">{message}</p>}
    </section>
  );
}

import { useState } from 'react';
import { resolvedDemoMatch, type DemoMatch, type DemoState } from '../lib/demo';
import { ScoreForm } from '../components/ScoreForm';
import type { GameScore, Tournament } from '../types';

interface MatchesProps {
  state: DemoState;
  event: Tournament;
  onStart: (matchId: string, tableNumber: number, version: number) => Promise<string | null>;
  onScore: (match: DemoMatch, games: GameScore[], correcting: boolean, expectedVersion: number) => Promise<string | null>;
  onResolve: (match: DemoMatch, kind: 'walkover' | 'void', winnerId: string | null, reason: string) => Promise<string | null>;
  onClear: (matchId: string, version: number) => Promise<string | null>;
  readOnly?: boolean;
}

const stateLabel: Record<DemoMatch['state'], string> = {
  pending: 'Ready', active: 'Playing', completed: 'Saved', bye: 'Bye', void: 'Void',
};

export function Matches({ state, event, onStart, onScore, onResolve, onClear, readOnly = false }: MatchesProps) {
  const matches = state.matches.filter((match) => match.eventId === event.id);
  const entries = state.entries.filter((entry) => entry.tournamentId === event.id);
  const [tableSelections, setTableSelections] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [openedVersions, setOpenedVersions] = useState<Record<string, number>>({});
  const [resolveDraft, setResolveDraft] = useState<Record<string, { kind: 'walkover' | 'void'; winnerId: string; reason: string }>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const name = (entryId: string | null) => entryId ? entries.find((entry) => entry.id === entryId)?.player?.name ?? 'Unknown player' : 'Awaiting player';
  const matchInfo = matches.map((match) => {
    const resolved = resolvedDemoMatch(match, matches);
    const aId = match.entryAId ?? resolved.entryAId;
    const bId = match.entryBId ?? resolved.entryBId;
    const availableEntries = [aId, bId].filter((id): id is string => Boolean(id)
      && entries.find((entry) => entry.id === id)?.registrationStatus !== 'withdrawn');
    return { match, aId, bId, playerA: name(aId), playerB: name(bId), resolved: resolved.resolved,
      availableEntries, playable: resolved.resolved && Boolean(aId && bId) && availableEntries.length === 2 };
  }).sort((left, right) => {
    const rank = (match: DemoMatch) => match.state === 'active' ? 0 : match.state === 'pending' ? 1 : 2;
    return rank(left.match) - rank(right.match) || left.match.stage.localeCompare(right.match.stage) || left.match.round - right.match.round || left.match.sequence - right.match.sequence;
  });
  const tableCount = event.tableCount;
  const activeTables = new Set(matches.filter((match) => match.state === 'active' && match.tableNumber !== null).map((match) => match.tableNumber));
  const visible = readOnly ? matchInfo.filter(({ match, playable }) => playable && (match.state === 'pending' || match.state === 'active')) : matchInfo;

  async function run(matchId: string, action: () => Promise<string | null>, success: string) {
    setSavingId(matchId);
    setMessage(null);
    try {
      const error = await action();
      setMessage(error ?? success);
      if (!error) setOpenId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The change could not be saved.');
    } finally { setSavingId(null); }
  }

  if (!visible.length) return <section className="page-section"><div className="empty-panel"><strong>{event.state === 'setup' ? 'Start groups to create matches' : 'No matches to show'}</strong><p>Ready fixtures and saved results will appear here.</p></div></section>;

  return (
    <section className={'page-section matches-page' + (readOnly ? ' phone-matches' : '')} aria-label="Tournament matches">
      <div className="section-heading"><div><h2>{readOnly ? 'Score matches' : 'Match desk'}</h2><p>{readOnly ? 'Select a ready match and enter the game scores.' : 'Assign ready matches to free tables. Scores release tables automatically.'}</p></div><div className="match-heading-actions">{!readOnly && <button className="button button-secondary button-small print-button" type="button" onClick={() => window.print()}>Print match sheet</button>}<span className="section-count">{matches.filter((match) => match.state === 'active').length} playing</span></div></div>
      {!readOnly && <div className="table-slots" aria-label="Table status">{Array.from({ length: tableCount }, (_, index) => {
        const number = index + 1;
        const current = matches.find((match) => match.state === 'active' && match.tableNumber === number);
        return <div className={'table-slot' + (current ? ' occupied' : '')} key={number}><span>Table {number}</span><strong>{current ? name(current.entryAId) + ' vs ' + name(current.entryBId) : 'Free'}</strong></div>;
      })}</div>}
      <div className="match-list">{visible.map(({ match, aId, bId, playerA, playerB, playable, resolved, availableEntries }) => {
        const opened = openId === match.id;
        const openedVersion = openedVersions[match.id] ?? match.version;
        const changedAfterOpen = opened && match.version !== openedVersion;
        const stageWritable = (event.state === 'groups' && match.stage === 'groups') || (event.state === 'playoffs' && match.stage === 'playoffs');
        const writeAllowed = !readOnly && stageWritable;
        const canScore = playable && (match.state === 'pending' || match.state === 'active' || (!readOnly && match.state === 'completed'))
          && stageWritable;
        const correction = match.state === 'completed';
      const resolverKind = availableEntries.length > 0 ? 'walkover' as const : 'void' as const;
      const draft = resolveDraft[match.id] ?? { kind: resolverKind, winnerId: availableEntries[0] ?? '', reason: '' };
        const showResolver = writeAllowed && !playable && (match.state === 'pending' || match.state === 'active') && resolved;
        return <article className={'match-card match-' + match.state} key={match.id}>
          <header className="match-card-top"><div><span className={'status-pill status-' + match.state}>{stateLabel[match.state]}</span><span className="match-round">{match.stage === 'groups' ? 'Group ' + (match.groupIndex ?? '') + ' · Round ' + match.round : (match.division === 'consolation' ? 'Consolation' : 'Championship') + ' · Round ' + match.round}</span></div><strong>{match.tableNumber ? 'Table ' + match.tableNumber : match.matchKey}</strong></header>
          <div className="match-scoreline"><div className={match.winnerEntryId === aId ? 'match-player is-winner' : 'match-player'}><strong>{playerA}</strong><span>{match.games.map((game) => game[0]).join('   ')}</span></div><span className="versus">VS</span><div className={match.winnerEntryId === bId ? 'match-player is-winner' : 'match-player'}><strong>{playerB}</strong><span>{match.games.map((game) => game[1]).join('   ')}</span></div></div>
          {match.kind === 'walkover' && <p className="match-note">Walkover{match.reason ? ': ' + match.reason : ''}</p>}
          {match.kind === 'void' && <p className="match-note">Void{match.reason ? ': ' + match.reason : ''}</p>}
          <div className="match-card-actions">
            {match.state === 'pending' && playable && writeAllowed && <>
              <label className="table-picker"><span>Assign table</span><select aria-label={'Table for ' + playerA + ' vs ' + playerB} value={tableSelections[match.id] ?? ''} onChange={(event) => { const value = Number(event.currentTarget.value); setTableSelections((current) => ({ ...current, [match.id]: value })); }}>
                <option value="">Choose free table</option>{Array.from({ length: tableCount }, (_, index) => index + 1).map((number) => <option key={number} value={number} disabled={activeTables.has(number)}>Table {number}{activeTables.has(number) ? ' · occupied' : ''}</option>)}
              </select></label>
              <button className="button button-secondary button-small" type="button" disabled={!tableSelections[match.id] || savingId === match.id} onClick={() => void run(match.id, () => onStart(match.id, tableSelections[match.id], match.version), 'Match started on Table ' + tableSelections[match.id] + '.')}>Start match</button>
            </>}
            {canScore && <button className="button button-primary button-small" type="button" onClick={() => { if (opened) setOpenId(null); else { setMessage(null); setOpenedVersions((current) => ({ ...current, [match.id]: match.version })); setOpenId(match.id); } }}>{opened ? 'Close score' : correction ? 'Correct result' : 'Enter score'}</button>}
            {showResolver && <button className="text-button" type="button" onClick={() => { if (opened) setOpenId(null); else { setMessage(null); setOpenedVersions((current) => ({ ...current, [match.id]: match.version })); setOpenId(match.id); } }}>{opened ? 'Close' : resolverKind === 'walkover' ? 'Record walkover' : 'Record void'}</button>}
            {writeAllowed && (match.state === 'completed' || match.state === 'void') && <button className="text-button danger-text" type="button" disabled={savingId === match.id} onClick={() => { if (window.confirm('Clear this saved result? Dependent matches may need to be cleared first.')) void run(match.id, () => onClear(match.id, match.version), 'Result cleared.'); }}>Clear result</button>}
          </div>
          {opened && canScore && <div className="match-editor"><ScoreForm key={match.id + ':' + openedVersion} matchId={match.id} version={openedVersion} playerA={playerA} playerB={playerB} bestOf={match.bestOf} initialGames={correction ? match.games : undefined} submitLabel={correction ? 'Save correction' : 'Save score'} saving={savingId === match.id} error={message && savingId === null ? message : null} disabledMessage={changedAfterOpen ? 'This match changed after you opened it. Your draft is preserved. Close and reopen the match to review the latest result before editing.' : null} onSave={(games) => void run(match.id, () => onScore(match, games, correction, openedVersion), correction ? 'Correction saved.' : 'Score saved.')} /></div>}
          {opened && !canScore && showResolver && <div className="match-editor unplayed-editor">
            <fieldset><legend>{resolverKind === 'walkover' ? 'Record a walkover' : 'Void this match'}</legend>
              {resolverKind === 'walkover' && <label><span>Walkover winner</span><select value={availableEntries.includes(draft.winnerId) ? draft.winnerId : availableEntries[0]} onChange={(event) => { const winnerId = event.currentTarget.value; setResolveDraft((current) => ({ ...current, [match.id]: { ...draft, kind: resolverKind, winnerId } })); }}>{availableEntries.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select></label>}
              <label><span>Reason</span><input maxLength={160} value={draft.reason} onChange={(event) => { const reason = event.currentTarget.value; setResolveDraft((current) => ({ ...current, [match.id]: { ...draft, reason } })); }} placeholder="For example, player withdrew" /></label>
              <button className="button button-secondary button-small" type="button" disabled={!draft.reason.trim() || savingId === match.id} onClick={() => void run(match.id, () => onResolve(match, resolverKind, resolverKind === 'walkover' ? (availableEntries.includes(draft.winnerId) ? draft.winnerId : availableEntries[0]) : null, draft.reason), resolverKind === 'walkover' ? 'Walkover saved.' : 'Match marked void.')}>Save resolution</button>
            </fieldset>
          </div>}
          {!playable && match.state === 'pending' && <p className="match-note">Waiting for earlier round results.</p>}
        </article>;
      })}</div>
      {message && <p className={message.endsWith('saved.') || message.endsWith('cleared.') || message.endsWith('started.') ? 'inline-success' : 'inline-status'} role="status">{message}</p>}
      {readOnly && <p className="table-note">Scorekeeper view · you can submit played scores only. Results cannot be edited here.</p>}
    </section>
  );
}

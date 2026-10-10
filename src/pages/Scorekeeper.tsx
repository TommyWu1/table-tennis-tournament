import { useState } from 'react';
import { ScoreForm } from '../components/ScoreForm';
import type { GameScore, Scoreboard, ScoreboardMatch } from '../types';

interface ScorekeeperProps {
  scoreboard: Scoreboard;
  onSave: (match: ScoreboardMatch, games: GameScore[], expectedVersion: number) => Promise<string | null>;
  lastRefreshed?: Date | null;
}

export function Scorekeeper({ scoreboard, onSave, lastRefreshed }: ScorekeeperProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openedVersions, setOpenedVersions] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const matches = scoreboard.matches.filter((match) => (match.ready && (match.state === 'pending' || match.state === 'active')) || expanded === match.id)
    .sort((a, b) => Number(b.state === 'active') - Number(a.state === 'active') || (a.sequence ?? 0) - (b.sequence ?? 0));
  return <main className="app-shell app-scorekeeper">
    <header className="app-header"><a className="product-lockup" href="/" aria-label="Table Tennis Tournament Manager"><span className="brand-mark" aria-hidden="true">TT</span><span><strong>Table Tennis Tournament Manager</strong><small>Scorekeeper</small></span></a><span className="demo-badge shared-badge"><i aria-hidden="true" />SHARED EVENT</span></header>
    <div className="local-demo-note"><strong>{scoreboard.stage.toUpperCase()}</strong><span>Results are shared with the organizer. You can enter played scores only.</span></div>
    <section className="page-section" aria-labelledby="scorekeeper-heading">
      <div className="section-heading"><div><h1 id="scorekeeper-heading">{scoreboard.eventName}</h1><p>{matches.length} ready to score · refreshes every five seconds</p></div><span className={'status-pill status-' + scoreboard.stage}>{scoreboard.stage}</span></div>
      {matches.length === 0 && <div className="empty-panel"><strong>No ready matches</strong><p>Ask the organizer to start a match or finish the draw.</p></div>}
      <div className="scorekeeper-list">{matches.map((match) => {
        const playerA = match.nameA ?? 'Player A';
        const playerB = match.nameB ?? 'Player B';
        const open = expanded === match.id;
        const openedVersion = openedVersions[match.id] ?? match.version;
        const changedAfterOpen = open && match.version !== openedVersion;
        return <article className={'match-card match-' + match.state} key={match.id}>
          <header className="match-card-top"><div><span className={'status-pill status-' + match.state}>{match.state === 'active' ? 'Playing' : 'Ready'}</span><span className="match-round">{match.label}</span></div><strong>{match.tableNumber ? 'Table ' + match.tableNumber : 'Ready'}</strong></header>
          <div className="scorekeeper-player-row"><strong>{playerA}</strong><span>vs</span><strong>{playerB}</strong></div>
          <button className="button button-primary scorekeeper-open" type="button" onClick={() => { if (open) setExpanded(null); else { setOpenedVersions((current) => ({ ...current, [match.id]: match.version })); setExpanded(match.id); } }}>{open ? 'Close score' : 'Enter score'}</button>
          {open && <div className="match-editor"><ScoreForm key={match.id + ':' + openedVersion} matchId={match.id} version={openedVersion} playerA={playerA} playerB={playerB} bestOf={match.bestOf} saving={false} error={errors[match.id] ?? null} disabledMessage={changedAfterOpen ? 'A different result was saved after you opened this match. Your draft is preserved; close and reopen to review the current result.' : null} onSave={(games) => {
            setErrors((current) => ({ ...current, [match.id]: '' }));
            void onSave(match, games, openedVersion).then((error) => {
              if (error) setErrors((current) => ({ ...current, [match.id]: error }));
              else setExpanded(null);
            });
          }} /></div>}
        </article>;
      })}</div>
      {lastRefreshed && <p className="table-note">Last refreshed {lastRefreshed.toLocaleTimeString('en-CA')}.</p>}
      <p className="table-note">If a save fails, your score stays in this phone session. Reopen the match to recheck its current version before retrying.</p>
    </section>
  </main>;
}

import { useEffect, useState, type CSSProperties } from 'react';
import { entryNames, LiveTables } from '../components/LiveTables';
import { groupStandings, resolveMatchEntries, type TournamentMatch, type TournamentState } from '../lib/tournament';
import type { Division, Slot, Tournament } from '../types';

const stageNames = { setup: 'Check-in open', groups: 'Group stage', playoffs: 'Knockouts', finished: 'Final results', cancelled: 'Event cancelled' };
const divisions = ['championship', 'consolation'] as const;

export function Display({ state, event, error, lastRefreshed }: {
  state: TournamentState; event: Tournament; error: string | null; lastRefreshed: Date | null;
}) {
  const [now, setNow] = useState(() => new Date());
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const matches = state.matches.filter((match) => match.eventId === event.id);
  const names = entryNames(state, event.id);
  const activeGroups = event.state === 'groups'
    ? [...new Set(state.entries.filter((entry) => entry.tournamentId === event.id)
      .flatMap((entry) => entry.groupIndex === null ? [] : [entry.groupIndex]))].sort((a, b) => a - b)
    : [];
  const activeDivisions = event.state === 'playoffs' || event.state === 'finished'
    ? divisions.filter((division) => matches.some((match) => match.stage === 'playoffs' && match.division === division))
    : [];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError(null);
    } catch { setFullscreenError('Fullscreen is unavailable here. Maximize this browser window instead.'); }
  }

  return <main className="display-shell">
    <header className="display-header"><div><p>{stageNames[event.state]}</p><h1>{event.name}</h1></div><time>{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></header>
    {error && <p className="display-warning" role="status">Connection interrupted. Showing the last saved view{lastRefreshed ? ' from ' + lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}. Reconnecting automatically.</p>}
    <LiveTables state={state} event={event} now={now} />
    {activeGroups.length > 0 && <section className="display-stage" aria-label="Group standings">
      <div className="display-section-heading"><h2>Groups</h2><p>W = wins · L = losses · MP = matches played</p></div>
      <div className="display-groups">{activeGroups.map((groupIndex) => {
        const fixtures = matches.filter((match) => match.stage === 'groups' && match.groupIndex === groupIndex);
        const standings = groupStandings(state, event.id, groupIndex);
        return <article className="display-group" key={groupIndex}><header><h3>Group {groupIndex}</h3><span>{fixtures.filter((match) => match.state === 'completed' || match.state === 'void').length}/{fixtures.length} matches complete</span></header>
          <table><thead><tr><th>Place</th><th>Player</th><th>W</th><th>L</th><th>MP</th></tr></thead><tbody>{standings.map((standing) => <tr key={standing.entryId}><td>{standing.rank ?? 'Tie'}</td><th scope="row">{names.get(standing.entryId)}</th><td>{standing.wins}</td><td>{standing.losses}</td><td>{standing.played}</td></tr>)}</tbody></table>
        </article>;
      })}</div><p className="display-hint">Check the table assignments above. Head to your table when your names appear.</p>
    </section>}
    {activeDivisions.length > 0 && <div className={`display-brackets${activeDivisions.length === 2 ? ' display-brackets-paired' : ''}`}>
      {activeDivisions.map((division) => <ProjectorBracket key={division} matches={matches} names={names} division={division} />)}
    </div>}
    {activeGroups.length === 0 && activeDivisions.length === 0 && <section className="display-empty"><h2>{event.state === 'setup' ? 'Ready for the first serve?' : stageNames[event.state]}</h2><p>{event.state === 'setup' ? 'Please check in with the organizers. Your groups will appear here when the draw starts.' : 'There are no matches to display.'}</p></section>}
    <footer className="display-footer"><span>Updates automatically every five seconds</span><div className="display-controls">
      <button type="button" onClick={() => void fullscreen()}>Toggle fullscreen</button>
    </div></footer>
    {fullscreenError && <p role="status">{fullscreenError}</p>}
  </main>;
}

export function ProjectorBracket({ matches, names, division }: { matches: TournamentMatch[]; names: Map<string, string>; division: Division }) {
  const bracket = matches.filter((match) => match.stage === 'playoffs' && match.division === division).sort((a, b) => a.round - b.round || a.sequence - b.sequence);
  if (bracket.length === 0) return null;
  const finalRound = Math.max(...bracket.map((match) => match.round));
  const rowCount = 2 ** (finalRound - 1);
  const final = bracket.find((match) => match.round === finalRound);
  function slotName(entryId: string | null, slot: Slot): string {
    if (entryId) return names.get(entryId) ?? 'Unknown player';
    if (slot.kind === 'empty') return 'Bye';
    if (slot.kind === 'winner') {
      const feeder = bracket.find((match) => match.matchKey === slot.matchKey);
      return feeder ? `Winner R${feeder.round} M${feeder.sequence}` : 'Awaiting winner';
    }
    return 'Awaiting player';
  }
  const roundName = (round: number) => round === finalRound ? 'Final' : round === finalRound - 1 ? 'Semifinals' : round === finalRound - 2 ? 'Quarterfinals' : `Round of ${2 ** (finalRound - round + 1)}`;
  return <section className="display-stage" aria-label={`${division} bracket`}>
    <div className="display-section-heading"><h2>{division === 'championship' ? 'Championship' : 'Consolation'} bracket</h2><p>{final?.winnerEntryId ? `Winner: ${names.get(final.winnerEntryId)}` : 'Winners advance →'}</p></div>
    <div className="projector-bracket" style={{ '--bracket-rounds': finalRound, '--bracket-rows': rowCount } as CSSProperties}>
      {Array.from({ length: finalRound }, (_, offset) => {
        const round = offset + 1;
        const span = 2 ** offset;
        const roundMatches = bracket.filter((match) => match.round === round);
        return <div className="projector-round" key={round}><h3>{roundName(round)}</h3><div className="projector-round-matches">{roundMatches.map((match) => {
          const resolved = resolveMatchEntries(match, matches);
          const a = match.entryAId ?? resolved.entryAId;
          const b = match.entryBId ?? resolved.entryBId;
          const winsA = match.games.filter(([left, right]) => left > right).length;
          const winsB = match.games.filter(([left, right]) => right > left).length;
          const rowStart = (match.sequence - 1) * span + 1;
          const rowEnd = match.sequence * span + 1;
          return <div className={'projector-match-position' + (offset > 0 && span <= rowCount ? ' has-feeders' : '')} key={match.id} style={{ gridRow: `${rowStart} / ${rowEnd}` }}><article className={'projector-match' + (match.state === 'active' ? ' is-playing' : '')}>
            <header><span>R{round} · M{match.sequence}</span><span>{match.state === 'active' ? `Table ${match.tableNumber}` : match.state === 'bye' ? 'Bye' : match.kind === 'walkover' ? 'Walkover' : match.state === 'completed' ? 'Final' : match.state === 'void' ? 'Void' : 'Pending'}</span></header>
            <div className={a && match.winnerEntryId === a ? 'bracket-player is-winner' : 'bracket-player'}><strong>{slotName(a, match.a)}</strong><span>{match.kind === 'played' ? winsA : a && match.winnerEntryId === a ? '✓' : '–'}</span></div>
            <div className={b && match.winnerEntryId === b ? 'bracket-player is-winner' : 'bracket-player'}><strong>{slotName(b, match.b)}</strong><span>{match.kind === 'played' ? winsB : b && match.winnerEntryId === b ? '✓' : '–'}</span></div>
          </article></div>;
        })}</div></div>;
      })}
    </div>
  </section>;
}

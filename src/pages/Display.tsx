import { useEffect, useState, type CSSProperties } from 'react';
import { entryNames, LiveTables } from '../components/LiveTables';
import { groupStandings, resolvedDemoMatch, type DemoMatch, type DemoState } from '../lib/demo';
import type { Division, Slot, Tournament } from '../types';

type DisplayPage = { kind: 'groups'; groups: number[] } | { kind: 'bracket'; division: Division; branch: number };
const stageNames = { setup: 'Check-in open', groups: 'Group stage', playoffs: 'Knockouts', finished: 'Final results', cancelled: 'Event cancelled' };

function groupsPerPage() { return window.innerWidth >= 1400 ? 4 : window.innerWidth >= 700 ? 2 : 1; }

export function Display({ state, event, shared, error, lastRefreshed }: {
  state: DemoState; event: Tournament; shared: boolean; error: string | null; lastRefreshed: Date | null;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [rotating, setRotating] = useState(true);
  const [groupLimit, setGroupLimit] = useState(groupsPerPage);
  const [now, setNow] = useState(() => new Date());
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const matches = state.matches.filter((match) => match.eventId === event.id);
  const names = entryNames(state, event.id);
  const pages: DisplayPage[] = [];
  if (event.state === 'groups') {
    const groups = [...new Set(state.entries.filter((entry) => entry.tournamentId === event.id && entry.groupIndex !== null).map((entry) => entry.groupIndex!))].sort((a, b) => a - b);
    for (let index = 0; index < groups.length; index += groupLimit) pages.push({ kind: 'groups', groups: groups.slice(index, index + groupLimit) });
  } else if (event.state === 'playoffs' || event.state === 'finished') {
    for (const division of ['championship', 'consolation'] as const) {
      const firstRound = matches.filter((match) => match.stage === 'playoffs' && match.division === division && match.round === 1);
      // Four opening matches per screen keeps names legible, even with a large bracket.
      for (let branch = 0; branch < Math.ceil(firstRound.length / 4); branch += 1) pages.push({ kind: 'bracket', division, branch });
    }
  }
  const pageCount = pages.length;
  const currentIndex = pageCount ? pageIndex % pageCount : 0;
  const page = pages[currentIndex];
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    const resize = () => setGroupLimit(groupsPerPage());
    window.addEventListener('resize', resize);
    return () => { window.clearInterval(timer); window.removeEventListener('resize', resize); };
  }, []);
  useEffect(() => {
    if (!rotating || pageCount < 2) return;
    const timer = window.setInterval(() => setPageIndex((index) => (index + 1) % pageCount), 20000);
    return () => window.clearInterval(timer);
  }, [rotating, pageCount, event.state]);

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError(null);
    } catch { setFullscreenError('Fullscreen is unavailable here. Maximize this browser window instead.'); }
  }

  return <main className="display-shell">
    <header className="display-header"><div><p>{stageNames[event.state]}{!shared && ' · practice demo'}</p><h1>{event.name}</h1></div><time>{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></header>
    {error && <p className="display-warning" role="status">Connection interrupted. Showing the last saved view{lastRefreshed ? ' from ' + lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}. Reconnecting automatically.</p>}
    <LiveTables state={state} event={event} now={now} />
    {page?.kind === 'groups' && <section className="display-stage" aria-label="Group standings">
      <div className="display-section-heading"><h2>Groups</h2><p>W = wins · L = losses · MP = matches played</p></div>
      <div className="display-groups">{page.groups.map((groupIndex) => {
        const fixtures = matches.filter((match) => match.stage === 'groups' && match.groupIndex === groupIndex);
        const standings = groupStandings(state, event.id, groupIndex);
        return <article className="display-group" key={groupIndex}><header><h3>Group {groupIndex}</h3><span>{fixtures.filter((match) => match.state === 'completed' || match.state === 'void').length}/{fixtures.length} matches complete</span></header>
          <table><thead><tr><th>Place</th><th>Player</th><th>W</th><th>L</th><th>MP</th></tr></thead><tbody>{standings.map((standing) => <tr key={standing.entryId}><td>{standing.rank ?? 'Tie'}</td><th scope="row">{names.get(standing.entryId)}</th><td>{standing.wins}</td><td>{standing.losses}</td><td>{standing.played}</td></tr>)}</tbody></table>
        </article>;
      })}</div><p className="display-hint">Check the table assignments above. Head to your table when your names appear.</p>
    </section>}
    {page?.kind === 'bracket' && <ProjectorBracket matches={matches} names={names} division={page.division} branch={page.branch} />}
    {!page && <section className="display-empty"><h2>{event.state === 'setup' ? 'Ready for the first serve?' : stageNames[event.state]}</h2><p>{event.state === 'setup' ? 'Please check in with the organizers. Your groups will appear here when the draw starts.' : 'There are no matches to display.'}</p></section>}
    <footer className="display-footer"><span>{shared ? 'Updates automatically every 5 seconds' : 'Follows the organizer window in this browser'}</span><div className="display-controls">
      {pageCount > 1 && <><button type="button" onClick={() => setPageIndex((currentIndex + pageCount - 1) % pageCount)} aria-label="Previous display page">←</button><span>Screen {currentIndex + 1}/{pageCount}</span><button type="button" onClick={() => setPageIndex((currentIndex + 1) % pageCount)} aria-label="Next display page">→</button><button type="button" onClick={() => setRotating(!rotating)}>{rotating ? 'Pause rotation' : 'Rotate every 20s'}</button></>}
      <button type="button" onClick={() => void fullscreen()}>Toggle fullscreen</button>
    </div></footer>
    {fullscreenError && <p role="status">{fullscreenError}</p>}
  </main>;
}

export function ProjectorBracket({ matches, names, division, branch }: { matches: DemoMatch[]; names: Map<string, string>; division: Division; branch: number }) {
  const bracket = matches.filter((match) => match.stage === 'playoffs' && match.division === division).sort((a, b) => a.round - b.round || a.sequence - b.sequence);
  const finalRound = Math.max(...bracket.map((match) => match.round));
  const firstCount = bracket.filter((match) => match.round === 1).length;
  const rowCount = Math.min(4, firstCount);
  const final = bracket.find((match) => match.round === finalRound);
  function slotName(entryId: string | null, slot: Slot): string {
    if (entryId) return names.get(entryId) ?? 'Unknown player';
    if (slot.kind === 'empty') return 'Bye';
    if (slot.kind === 'winner') {
      const feeder = bracket.find((match) => match.matchKey === slot.matchKey);
      return feeder ? `Winner R${feeder.round} · M${feeder.sequence}` : 'Awaiting winner';
    }
    return 'Awaiting player';
  }
  const roundName = (round: number) => round === finalRound ? 'Final' : round === finalRound - 1 ? 'Semifinals' : round === finalRound - 2 ? 'Quarterfinals' : `Round of ${2 ** (finalRound - round + 1)}`;
  return <section className="display-stage" aria-label={`${division} bracket`}>
    <div className="display-section-heading"><h2>{division === 'championship' ? 'Championship' : 'Consolation'} bracket</h2><p>{firstCount > 4 ? `Section ${branch + 1} of ${Math.ceil(firstCount / 4)} · ` : ''}{final?.winnerEntryId ? `Winner: ${names.get(final.winnerEntryId)}` : 'Winners advance →'}</p></div>
    <div className="projector-bracket" style={{ '--bracket-rounds': finalRound, '--bracket-rows': rowCount } as CSSProperties}>
      {Array.from({ length: finalRound }, (_, offset) => {
        const round = offset + 1;
        const span = 2 ** offset;
        const start = Math.floor(branch * 4 / span) + 1;
        const end = Math.floor((branch * 4 + rowCount - 1) / span) + 1;
        const roundMatches = bracket.filter((match) => match.round === round && match.sequence >= start && match.sequence <= end);
        return <div className="projector-round" key={round}><h3>{roundName(round)}</h3><div className="projector-round-matches">{roundMatches.map((match) => {
          const resolved = resolvedDemoMatch(match, matches);
          const a = match.entryAId ?? resolved.entryAId;
          const b = match.entryBId ?? resolved.entryBId;
          const winsA = match.games.filter(([left, right]) => left > right).length;
          const winsB = match.games.filter(([left, right]) => right > left).length;
          const rowStart = Math.max(1, (match.sequence - 1) * span - branch * 4 + 1);
          const rowEnd = Math.min(rowCount + 1, match.sequence * span - branch * 4 + 1);
          return <div className={'projector-match-position' + (offset > 0 && span <= rowCount ? ' has-feeders' : '')} key={match.id} style={{ gridRow: `${rowStart} / ${rowEnd}` }}><article className={'projector-match' + (match.state === 'active' ? ' is-playing' : '')}>
            <header><span>R{round} · M{match.sequence}</span><span>{match.state === 'active' ? `Table ${match.tableNumber} · live` : match.state === 'bye' ? 'Bye advanced' : match.kind === 'walkover' ? 'Walkover' : match.state === 'completed' ? 'Final score' : match.state === 'void' ? 'Void' : 'Awaiting match'}</span></header>
            <div className={a && match.winnerEntryId === a ? 'bracket-player is-winner' : 'bracket-player'}><strong>{slotName(a, match.a)}</strong><span>{match.kind === 'played' ? winsA : a && match.winnerEntryId === a ? '✓' : '–'}</span></div>
            <div className={b && match.winnerEntryId === b ? 'bracket-player is-winner' : 'bracket-player'}><strong>{slotName(b, match.b)}</strong><span>{match.kind === 'played' ? winsB : b && match.winnerEntryId === b ? '✓' : '–'}</span></div>
            <small>{match.games.length > 0 ? match.games.map(([left, right]) => `${left}–${right}`).join(' · ') : `Best of ${match.bestOf}`}</small>
          </article></div>;
        })}</div></div>;
      })}
    </div>
  </section>;
}

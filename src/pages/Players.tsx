import { useMemo, useState } from 'react';
import type { Experience, Player } from '../types';

interface PlayersProps {
  players: Player[];
  onCreate: (input: { name: string; label?: string | null; experience?: Experience }) => Promise<string | null>;
  onUpdate: (playerId: string, patch: Partial<Pick<Player, 'name' | 'label' | 'experience'>>) => Promise<string | null>;
  onArchive: (playerId: string) => Promise<string | null>;
  readOnly?: boolean;
}

export function Players({ players, onCreate, onUpdate, onArchive, readOnly = false }: PlayersProps) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [experience, setExperience] = useState<Experience>('unknown');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const visible = useMemo(() => players.filter((player) => (includeArchived || !player.archived)
    && (player.name + ' ' + (player.label ?? '')).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [players, query, includeArchived]);

  async function run(action: () => Promise<string | null>, success: string) {
    setBusy(true);
    setMessage(null);
    try { setMessage((await action()) ?? success); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save player.'); }
    finally { setBusy(false); }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await run(() => onCreate({ name: trimmed, label: label.trim() || null, experience }), 'Player added to the directory.');
    setName('');
    setLabel('');
    setExperience('unknown');
  }

  return <section className="page-section" aria-labelledby="players-heading">
    <div className="section-heading"><div><h2 id="players-heading">Players</h2><p>Reuse player records across events. No player accounts or contact details are stored.</p></div><span className="section-count">{players.filter((player) => !player.archived).length} active</span></div>
    {!readOnly && <form className="player-create" onSubmit={(event) => void create(event)}>
      <label><span>Player name</span><input value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Full name" required /></label>
      <label><span>Distinguishing label</span><input value={label} onChange={(event) => setLabel(event.currentTarget.value)} maxLength={60} placeholder="Optional, e.g. varsity" /></label>
      <label><span>Experience estimate</span><select value={experience} onChange={(event) => setExperience(event.currentTarget.value as Experience)}><option value="unknown">Unknown</option><option value="beginner">Beginner</option><option value="casual">Casual</option><option value="club">Club</option><option value="varsity">Varsity</option></select></label>
      <button className="button button-primary" type="submit" disabled={busy || !name.trim()}>Add player</button>
    </form>}
    <div className="player-filters"><label className="search-field"><span>Search players</span><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Name or label" /></label><label className="check-line"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.currentTarget.checked)} /><span>Show archived</span></label></div>
    {message && <p className="inline-status" role="status">{message}</p>}
    <div className="table-scroll"><table className="player-table"><thead><tr><th>Name</th><th>Experience</th><th>Rating</th><th>Rated matches</th><th>Standing</th><th>Actions</th></tr></thead><tbody>
      {visible.map((player) => <PlayerRow key={player.id} player={player} readOnly={readOnly} busy={busy} onUpdate={onUpdate} onArchive={onArchive} onMessage={setMessage} />)}
      {!visible.length && <tr><td colSpan={6} className="empty-row">No players match this search.</td></tr>}
    </tbody></table></div>
    <p className="table-note">New players are unrated until they have played results. Elo uses an equal starting baseline of 1000 and updates when an admin finishes an event.</p>
  </section>;
}

function PlayerRow({ player, readOnly, busy, onUpdate, onArchive, onMessage }: {
  player: Player;
  readOnly: boolean;
  busy: boolean;
  onUpdate: PlayersProps['onUpdate'];
  onArchive: PlayersProps['onArchive'];
  onMessage: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.name);
  const [label, setLabel] = useState(player.label ?? '');
  const [experience, setExperience] = useState(player.experience);
  async function save() {
    onMessage(null);
    const error = await onUpdate(player.id, { name: name.trim(), label: label.trim() || null, experience });
    if (error) onMessage(error);
    else { setEditing(false); onMessage('Player details saved.'); }
  }
  return <tr>
    <th scope="row">{editing ? <div className="inline-edit"><input aria-label="Player name" value={name} onChange={(event) => setName(event.currentTarget.value)} /><input aria-label="Player label" value={label} onChange={(event) => setLabel(event.currentTarget.value)} placeholder="Label" /></div> : <><span className="table-player-name">{player.name}</span>{player.label && <small>{player.label}</small>}</>}</th>
    <td>{editing ? <select aria-label="Player experience" value={experience} onChange={(event) => setExperience(event.currentTarget.value as Experience)}><option value="unknown">Unknown</option><option value="beginner">Beginner</option><option value="casual">Casual</option><option value="club">Club</option><option value="varsity">Varsity</option></select> : player.experience}</td>
    <td><strong>{player.ratedMatchCount === 0 ? 'Unrated' : Math.round(player.rating)}</strong></td><td>{player.ratedMatchCount}{player.ratedMatchCount > 0 && player.ratedMatchCount < 5 && <span className="badge">provisional</span>}</td><td>{player.archived ? <span className="status-text status-withdrawn">Archived</span> : 'Active'}</td>
    <td className="row-actions">{!readOnly && !player.archived && (editing ? <><button className="text-button" type="button" disabled={busy} onClick={() => void save()}>Save</button><button className="text-button" type="button" onClick={() => { setEditing(false); setName(player.name); setLabel(player.label ?? ''); setExperience(player.experience); }}>Cancel</button></> : <><button className="text-button" type="button" onClick={() => { onMessage(null); setEditing(true); }}>Edit</button><button className="text-button danger-text" type="button" disabled={busy} onClick={async () => { if (!window.confirm('Archive ' + player.name + '? Their event history will remain.')) return; const error = await onArchive(player.id); onMessage(error ?? 'Player archived.'); }}>Archive</button></>)}</td>
  </tr>;
}

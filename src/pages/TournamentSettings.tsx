import { useState, type FormEvent } from 'react';
import type { BestOf, Tournament } from '../types';

interface TournamentSettingsProps {
  tournaments: Tournament[];
  selected: Tournament;
  onSelect: (eventId: string) => void;
  onCreate: (input: { name: string; startsAt: string }) => Promise<string | null>;
  onSave: (eventId: string, patch: Partial<Tournament>) => Promise<string | null>;
  onCancel: () => Promise<string | null>;
  onFinish: () => Promise<string | null>;
  readOnly?: boolean;
}

const localDateTime = (value: string) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
};

export function TournamentSettings({ tournaments, selected, onSelect, onCreate, onSave, onCancel, onFinish, readOnly = false }: TournamentSettingsProps) {
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(selected.name);
  const [startsAt, setStartsAt] = useState(localDateTime(selected.startsAt));
  const [bookingMinutes, setBookingMinutes] = useState(String(selected.bookingMinutes));
  const [entryFee, setEntryFee] = useState((selected.entryFeeCents / 100).toFixed(2));
  const [cap, setCap] = useState(String(selected.registrationCap));
  const [tableCount, setTableCount] = useState(String(selected.tableCount));
  const [groupBestOf, setGroupBestOf] = useState<BestOf>(selected.groupBestOf);
  const [playoffBestOf, setPlayoffBestOf] = useState<BestOf>(selected.playoffBestOf);
  const [finalBestOf, setFinalBestOf] = useState<BestOf>(selected.finalBestOf);
  const [consolation, setConsolation] = useState(selected.consolationEnabled);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try { const error = await onCreate({ name: name.trim(), startsAt: new Date(startsAt).toISOString() }); setMessage(error ?? 'Event created.'); if (!error) setCreating(false); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Event could not be created.'); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const feeCents = Math.round(Number(entryFee) * 100);
    if (!Number.isFinite(feeCents) || feeCents < 0 || !Number.isInteger(feeCents)) { setMessage('Enter a valid nonnegative entry fee.'); setBusy(false); return; }
    try {
      const error = await onSave(selected.id, { name: name.trim(), startsAt: new Date(startsAt).toISOString(), bookingMinutes: Number(bookingMinutes), entryFeeCents: feeCents, registrationCap: Number(cap), tableCount: Number(tableCount), groupBestOf, playoffBestOf, finalBestOf, consolationEnabled: consolation });
      setMessage(error ?? 'Event settings saved.'); if (!error) setEditing(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Settings could not be saved.'); }
    finally { setBusy(false); }
  }

  const locked = selected.state !== 'setup';
  return <section className="page-section" aria-labelledby="event-heading">
    <div className="section-heading"><div><h2 id="event-heading">Tournament</h2><p>Event setup, timeline and match settings.</p></div><span className={'status-pill status-' + selected.state}>{selected.state}</span></div>
    <div className="event-toolbar"><label><span>Selected event</span><select value={selected.id} onChange={(event) => onSelect(event.currentTarget.value)}>{tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name} · {tournament.state}</option>)}</select></label>{!readOnly && <button className="button button-secondary" type="button" onClick={() => { setCreating((value) => !value); setEditing(false); setMessage(null); }}>New event</button>}</div>
    {creating && <form className="event-create" onSubmit={(event) => void create(event)}><label><span>Event name</span><input value={name} onChange={(event) => setName(event.currentTarget.value)} required /></label><label><span>Start time</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.currentTarget.value)} required /></label><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create event'}</button></form>}
    {!creating && <>
      {!editing ? <div className="event-summary"><div className="event-summary-title"><div><h3>{selected.name}</h3><p>{new Date(selected.startsAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' })} · {selected.bookingMinutes} minute booking</p></div>{!readOnly && <button className="button button-secondary button-small" type="button" disabled={selected.state === 'finished' || selected.state === 'cancelled'} onClick={() => setEditing(true)}>Edit settings</button>}</div>
        <dl className="settings-grid"><div><dt>Entry fee</dt><dd>${(selected.entryFeeCents / 100).toFixed(2)} CAD</dd></div><div><dt>Capacity</dt><dd>{selected.registrationCap} players</dd></div><div><dt>Tables</dt><dd>{selected.tableCount}</dd></div><div><dt>Groups</dt><dd>Best of {selected.groupBestOf}</dd></div><div><dt>Playoffs</dt><dd>Best of {selected.playoffBestOf}</dd></div><div><dt>Final</dt><dd>Best of {selected.finalBestOf}</dd></div><div><dt>Consolation</dt><dd>{selected.consolationEnabled ? 'On' : 'Off'}</dd></div></dl>
      </div> : <form className="settings-form" onSubmit={(event) => void save(event)}>
        <div className="settings-fields"><label><span>Event name</span><input value={name} onChange={(event) => setName(event.currentTarget.value)} required /></label><label><span>Start time</span><input type="datetime-local" value={startsAt} disabled={locked} onChange={(event) => setStartsAt(event.currentTarget.value)} required /></label><label><span>Venue booking (minutes)</span><input type="number" min="30" max="720" step="15" value={bookingMinutes} disabled={locked} onChange={(event) => setBookingMinutes(event.currentTarget.value)} /></label><label><span>Entry fee (CAD)</span><input type="number" inputMode="decimal" min="0" step="0.01" value={entryFee} onChange={(event) => setEntryFee(event.currentTarget.value)} /></label><label><span>Registration cap</span><input type="number" min="4" max="64" value={cap} disabled={locked} onChange={(event) => setCap(event.currentTarget.value)} /></label><label><span>Tables</span><input type="number" min="1" max="20" value={tableCount} disabled={locked} onChange={(event) => setTableCount(event.currentTarget.value)} /></label>
          <label><span>Groups best of</span><select value={groupBestOf} disabled={locked} onChange={(event) => setGroupBestOf(Number(event.currentTarget.value) as BestOf)}><option value="1">1</option><option value="3">3</option><option value="5">5</option></select></label><label><span>Playoff best of</span><select value={playoffBestOf} onChange={(event) => setPlayoffBestOf(Number(event.currentTarget.value) as BestOf)}><option value="1">1</option><option value="3">3</option><option value="5">5</option></select></label><label><span>Final best of</span><select value={finalBestOf} onChange={(event) => setFinalBestOf(Number(event.currentTarget.value) as BestOf)}><option value="1">1</option><option value="3">3</option><option value="5">5</option></select></label><label className="check-line"><input type="checkbox" checked={consolation} onChange={(event) => setConsolation(event.currentTarget.checked)} /><span>Run consolation bracket</span></label>
        </div>{locked && <p className="table-note">Event timing, group rules and capacity lock when groups start. Update the entry fee for future entrants only.</p>}
        <div className="action-row"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button><button className="button button-secondary" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
      </form>}
      {!readOnly && selected.state === 'playoffs' && <div className="event-close-actions"><p>Finish after every match is resolved. Ratings are applied once.</p><button className="button button-primary" type="button" disabled={busy} onClick={async () => { if (!window.confirm('Finish this event and apply player ratings? This cannot be undone.')) return; setBusy(true); setMessage(null); try { setMessage((await onFinish()) ?? 'Event finished. Ratings updated.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Event could not be finished.'); } finally { setBusy(false); } }}>Finish event</button></div>}
      {!readOnly && selected.state !== 'finished' && selected.state !== 'cancelled' && <button className="text-button danger-text" type="button" onClick={async () => { if (!window.confirm('Cancel this unfinished event? Saved scores and payments remain, and no ratings are applied.')) return; setBusy(true); try { setMessage((await onCancel()) ?? 'Event cancelled.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Event could not be cancelled.'); } finally { setBusy(false); } }}>Cancel unfinished event</button>}
    </>}
    {message && <p className="inline-status" role="status">{message}</p>}
    <p className="table-note">CAD · local times are shown in Toronto time. One competitive event may run at a time.</p>
  </section>;
}

import { useMemo, useState } from 'react';
import { amountDueCents, parseMoneyToCents, paymentDraft } from '../lib/money';
import { downloadRosterCsv } from '../lib/export';
import type { TournamentState } from '../lib/tournament';
import type { Entry, Experience, MutationResult, PaymentMethod, Player, Tournament } from '../types';

interface RosterProps {
  state: TournamentState;
  event: Tournament;
  entries: Entry[];
  players: Player[];
  onRegister: (playerId: string, allowWaitlist?: boolean) => Promise<string | null>;
  onCreatePlayer: (input: { name: string }) => Promise<MutationResult<Player>>;
  onUpdateEntry: (entryId: string, patch: Partial<Entry>) => Promise<string | null>;
  onUpdateExperience: (playerId: string, experience: Experience) => Promise<string | null>;
  onPromoteWaitlist: () => Promise<string | null>;
}

const currency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const money = (cents: number) => currency.format(cents / 100);
const nameOrder = new Intl.Collator('en-CA', { sensitivity: 'base' });
const experienceLabels: Record<Experience, string> = {
  unknown: 'Unknown',
  beginner: 'Beginner',
  casual: 'Casual',
  club: 'Club',
  varsity: 'Varsity',
};

export interface BulkRosterPlanRow {
  line: number;
  name: string;
  playerId: string | null;
  alreadyOnRoster: boolean;
  existingRegistrationStatus: Entry['registrationStatus'] | null;
  existingCheckedIn: boolean | null;
}

export type BulkRosterPlan =
  | {
      ok: true;
      rows: BulkRosterPlanRow[];
      newEntrants: number;
      existingOnRoster: number;
      existingRegistered: number;
      existingWaitlisted: number;
      existingWithdrawn: number;
      existingNotCheckedIn: number;
    }
  | { ok: false; message: string };

function normalizedPlayerName(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase();
}

export function planBulkRosterImport(
  pastedNames: string,
  players: readonly Player[],
  entries: readonly Pick<Entry, 'playerId' | 'registrationStatus' | 'checkedIn'>[],
  event: Pick<Tournament, 'state' | 'registrationCap'>,
): BulkRosterPlan {
  if (event.state !== 'setup') return { ok: false, message: 'Bulk roster import is available only before groups start.' };
  const names = pastedNames.split(/\r\n?|\n/)
    .map((raw, index) => ({ line: index + 1, name: raw.trim() }))
    .filter(({ name }) => name.length > 0);
  if (names.length === 0) return { ok: false, message: 'Paste one player name per line.' };
  if (names.length > 25) return { ok: false, message: 'Paste no more than 25 names at a time.' };

  const seenNames = new Map<string, number>();
  for (const row of names) {
    if (row.name.length > 100) return { ok: false, message: `Line ${row.line} exceeds the 100-character player-name limit.` };
    const key = normalizedPlayerName(row.name);
    const previousLine = seenNames.get(key);
    if (previousLine !== undefined) {
      return { ok: false, message: `Lines ${previousLine} and ${row.line} have the same name after trimming and case-folding. Import them individually to disambiguate.` };
    }
    seenNames.set(key, row.line);
  }

  const rows: BulkRosterPlanRow[] = [];
  for (const row of names) {
    const matches = players.filter((player) => normalizedPlayerName(player.name) === normalizedPlayerName(row.name));
    if (matches.length > 1) {
      return { ok: false, message: `Line ${row.line} matches multiple player records. Resolve the duplicate-name choice in Players before importing.` };
    }
    const player = matches[0];
    const existingEntry = player ? entries.find((entry) => entry.playerId === player.id) : undefined;
    if (player?.archived && !existingEntry) {
      return { ok: false, message: `Line ${row.line} matches an archived player. Resolve that record in Players before importing.` };
    }
    rows.push({
      line: row.line,
      name: row.name,
      playerId: player?.id ?? null,
      alreadyOnRoster: existingEntry !== undefined,
      existingRegistrationStatus: existingEntry?.registrationStatus ?? null,
      existingCheckedIn: existingEntry?.checkedIn ?? null,
    });
  }

  const newEntrants = rows.filter((row) => !row.alreadyOnRoster).length;
  const existingOnRoster = rows.length - newEntrants;
  const existingRegistered = rows.filter((row) => row.existingRegistrationStatus === 'registered').length;
  const existingWaitlisted = rows.filter((row) => row.existingRegistrationStatus === 'waitlisted').length;
  const existingWithdrawn = rows.filter((row) => row.existingRegistrationStatus === 'withdrawn').length;
  const existingNotCheckedIn = rows.filter((row) =>
    row.existingRegistrationStatus === 'registered' && row.existingCheckedIn === false).length;
  const registeredCount = entries.filter((entry) => entry.registrationStatus === 'registered').length;
  const availableSpots = Math.max(0, event.registrationCap - registeredCount);
  if (newEntrants > availableSpots) {
    return {
      ok: false,
      message: `This paste needs ${newEntrants} new roster spots, but only ${availableSpots} remain within the event capacity. Increase the event cap before importing.`,
    };
  }
  return {
    ok: true,
    rows,
    newEntrants,
    existingOnRoster,
    existingRegistered,
    existingWaitlisted,
    existingWithdrawn,
    existingNotCheckedIn,
  };
}

function PaymentEditor({ entry, onSave }: {
  entry: Entry;
  onSave: RosterProps['onUpdateEntry'];
}) {
  const due = Math.max(0, entry.baseFeeCents - entry.discountCents);
  const [paid, setPaid] = useState(entry.paid);
  const [method, setMethod] = useState<PaymentMethod>(entry.paymentMethod);
  const [amount, setAmount] = useState((entry.amountPaidCents / 100).toFixed(2));
  const [discount, setDiscount] = useState((entry.discountCents / 100).toFixed(2));
  const [note, setNote] = useState(entry.paymentNote ?? '');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmAdjustment, setConfirmAdjustment] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);


  const discountCents = parseMoneyToCents(discount);
  const amountCents = parseMoneyToCents(amount);
  const currentDue = discountCents !== null && discountCents <= entry.baseFeeCents
    ? amountDueCents(entry.baseFeeCents, discountCents)
    : null;
  const needsAdjustment = paid && amountCents !== null && amountCents > 0 && currentDue !== null && amountCents !== currentDue;

  async function save() {
    setMessage(null);
    if (discountCents === null || discountCents > entry.baseFeeCents) {
      setMessage('Discount must be a valid amount no greater than the entry fee.');
      return;
    }
    if (amountCents === null) {
      setMessage('Enter an amount with up to two decimal places.');
      return;
    }
    try {
      const update = paymentDraft({
        baseFeeCents: entry.baseFeeCents,
        paid,
        method,
        amountPaidCents: amountCents,
        discountCents,
        note,
      });
      if (entry.paid && !paid && !confirmClear) {
        setMessage('Confirm clearing the existing payment before saving.');
        return;
      }
      if (needsAdjustment && !confirmAdjustment) {
        setMessage('Confirm the amount received differs from the amount due.');
        return;
      }
      setSaving(true);
      const error = await onSave(entry.id, update);
      setMessage(error ?? 'Payment saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Payment could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="payment-editor">
      <summary>{entry.paid ? 'Edit payment' : 'Record payment'}</summary>
      <div className="payment-fields">
        <label className="check-line">
          <input
            type="checkbox"
            checked={paid}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setPaid(checked);
              if (checked && !entry.paid) {
                const cents = currentDue ?? due;
                setAmount((cents / 100).toFixed(2));
                setMethod(cents > 0 ? 'cash' : null);
              }
              if (!checked) setConfirmClear(false);
            }}
          />
          <span>Paid</span>
        </label>
        <label>
          <span>Discount</span>
          <span className="input-with-prefix"><b>$</b><input type="text" inputMode="decimal" value={discount} onChange={(event) => {
            const next = event.currentTarget.value;
            setDiscount(next);
            const nextCents = parseMoneyToCents(next);
            if (paid && amountCents === currentDue && nextCents !== null && nextCents <= entry.baseFeeCents) {
              setAmount((amountDueCents(entry.baseFeeCents, nextCents) / 100).toFixed(2));
            }
          }} /></span>
        </label>
        <label>
          <span>Amount received</span>
          <span className="input-with-prefix"><b>$</b><input type="text" inputMode="decimal" value={amount} disabled={!paid} onChange={(event) => setAmount(event.currentTarget.value)} /></span>
        </label>
        <label>
          <span>Method</span>
          <select value={method ?? ''} disabled={!paid || amountCents === 0} onChange={(event) => setMethod(event.currentTarget.value ? event.currentTarget.value as PaymentMethod : null)}>
            <option value="">Choose</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
          </select>
        </label>
        <label className="payment-note">
          <span>Note</span>
          <input maxLength={120} value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder="Optional adjustment or discount reason" />
        </label>
        <div className="payment-summary-line">
          <span>Due {money(currentDue ?? due)}</span>
          <span>Collected {money(paid ? (amountCents ?? 0) : 0)}</span>
        </div>
        {entry.paid && !paid && (
          <label className="confirm-line">
            <input type="checkbox" checked={confirmClear} onChange={(event) => setConfirmClear(event.currentTarget.checked)} />
            <span>I confirm clearing the saved payment record.</span>
          </label>
        )}
        {needsAdjustment && (
          <label className="confirm-line">
            <input type="checkbox" checked={confirmAdjustment} onChange={(event) => setConfirmAdjustment(event.currentTarget.checked)} />
            <span>Confirm the amount received is different from the amount due.</span>
          </label>
        )}
        {message && <p className={message === 'Payment saved.' ? 'inline-success' : 'field-error'} role="status">{message}</p>}
        <button className="button button-secondary button-small" type="button" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save payment'}
        </button>
      </div>
    </details>
  );
}

function RosterExperience({ player, onSave }: { player: Player; onSave: RosterProps['onUpdateExperience'] }) {
  const [pending, setPending] = useState<Experience | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(experience: Experience) {
    setPending(experience);
    setError(null);
    try {
      setError(await onSave(player.id, experience));
    } catch {
      setError('Could not save experience. Try again.');
    } finally {
      setPending(null);
    }
  }

  return <>
    <select aria-label={`Experience for ${player.name}`} value={pending ?? player.experience}
      disabled={pending !== null} onChange={(event) => void change(event.currentTarget.value as Experience)}>
      {Object.entries(experienceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    {pending !== null && <small className="subcell" role="status">Saving…</small>}
    {error && <div className="field-error" role="alert">{error}</div>}
  </>;
}

export function Roster({ state, event, entries, players, onRegister, onCreatePlayer, onUpdateEntry, onUpdateExperience, onPromoteWaitlist }: RosterProps) {
  const [query, setQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const registered = entries.filter((entry) => entry.registrationStatus === 'registered');
  const waitlisted = entries.filter((entry) => entry.registrationStatus === 'waitlisted');
  const availablePlayers = useMemo(() => {
    const registeredIds = new Set(entries.map((entry) => entry.playerId));
    return players.filter((player) => !player.archived && !registeredIds.has(player.id))
      .filter((player) => `${player.name} ${player.label ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  }, [players, entries, query]);
  const checkedIn = registered.filter((entry) => entry.checkedIn).length;
  const paid = registered.filter((entry) => entry.paid).length;
  const cash = registered.filter((entry) => entry.paid && entry.paymentMethod === 'cash').reduce((sum, entry) => sum + entry.amountPaidCents, 0);
  const card = registered.filter((entry) => entry.paid && entry.paymentMethod === 'card').reduce((sum, entry) => sum + entry.amountPaidCents, 0);
  const collected = registered.filter((entry) => entry.paid).reduce((sum, entry) => sum + entry.amountPaidCents, 0);
  const discounts = entries.reduce((sum, entry) => sum + entry.discountCents, 0);
  const canEditAttendance = event.state === 'setup';
  const canWithdraw = event.state !== 'finished' && event.state !== 'cancelled';
  const playerById = new Map(players.map((player) => [player.id, player]));
  const roster = entries.map((entry) => ({ entry, player: playerById.get(entry.playerId) ?? entry.player }))
    .sort((a, b) => {
      if (!a.player || !b.player) return Number(!a.player) - Number(!b.player);
      return nameOrder.compare(a.player.name, b.player.name)
        || nameOrder.compare(a.player.label ?? '', b.player.label ?? '');
    });

  async function addSelected() {
    if (!selectedPlayer) return;
    setSaving(true);
    const error = await onRegister(selectedPlayer);
    setMessage(error ?? 'Entrant added.');
    if (!error) {
      setSelectedPlayer('');
      setQuery('');
    }
    setSaving(false);
  }

  return (
    <section className="page-section" aria-labelledby="roster-heading">
      <div className="section-heading">
        <div>
          <h2 id="roster-heading">Players &amp; payments</h2>
          <p>{canEditAttendance ? 'Check in players, set experience for the balanced draw, and record payments.' : 'Review attendance and record payments.'}</p>
        </div>
        <div className="roster-heading-actions"><span className="section-count">{registered.length} / {event.registrationCap} registered</span><button className="button button-secondary button-small" type="button" onClick={() => downloadRosterCsv(state, event.id)}>Export roster CSV</button></div>
      </div>

      <div className="metric-strip" aria-label="Event payment summary">
        <div><span>Checked in</span><strong>{checkedIn}</strong></div>
        <div><span>Paid</span><strong>{paid} <small>of {registered.length}</small></strong></div>
        <div><span>Cash collected</span><strong>{money(cash)}</strong></div>
        <div><span>Card collected</span><strong>{money(card)}</strong></div>
        <div><span>Total collected</span><strong>{money(collected)}</strong></div>
        <div><span>Discounts</span><strong>{money(discounts)}</strong></div>
      </div>

      {canEditAttendance && (
        <form className="add-entrant" onSubmit={(eventSubmit) => { eventSubmit.preventDefault(); void addSelected(); }}>
          <div>
            <label htmlFor="entrant-search">Add a returning player</label>
            <input id="entrant-search" value={query} onChange={(event) => { setQuery(event.currentTarget.value); setSelectedPlayer(''); }} placeholder="Search name or label" />
          </div>
          <div>
            <label htmlFor="entrant-select">Player record</label>
            <select id="entrant-select" value={selectedPlayer} onChange={(event) => setSelectedPlayer(event.currentTarget.value)}>
              <option value="">Choose a player</option>
              {availablePlayers.map((player) => <option value={player.id} key={player.id}>{player.name}{player.label ? ` · ${player.label}` : ''}</option>)}
            </select>
          </div>
          <button className="button button-primary" type="submit" disabled={!selectedPlayer || saving}>{saving ? 'Adding…' : 'Add entrant'}</button>
          <p className="add-entrant-hint">Create a new player record in the Players tab. At capacity, new entrants join the waitlist.</p>
        </form>
      )}

      {canEditAttendance && <BulkRosterImport
        event={event}
        entries={entries}
        players={players}
        onCreatePlayer={onCreatePlayer}
        onRegister={onRegister}
      />}

      {message && <p className="inline-status" role="status">{message}</p>}
      <div className="table-scroll">
        <table className="roster-table">
          <thead>
            <tr><th scope="col" aria-sort="ascending">Player</th><th>Check-in</th><th>Experience</th><th>Registration</th><th>Fee due</th><th>Payment</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {roster.map(({ entry, player }) => {
              const due = Math.max(0, entry.baseFeeCents - entry.discountCents);
              return (
                <tr key={entry.id}>
                  <th scope="row">
                    <span className="table-player-name">{player?.name ?? 'Unknown player'}</span>
                    {player?.label && <small>{player.label}</small>}
                  </th>
                  <td>
                    {entry.registrationStatus === 'registered' ? (
                      <label className="check-line">
                        <input type="checkbox" checked={entry.checkedIn} disabled={!canEditAttendance} onChange={(event) => void onUpdateEntry(entry.id, { checkedIn: event.currentTarget.checked })} />
                        <span>{entry.checkedIn ? 'Checked in' : 'Not checked in'}</span>
                      </label>
                    ) : <span className="muted-cell">—</span>}
                  </td>
                  <td>
                    {player && canEditAttendance && !player.archived && entry.registrationStatus !== 'withdrawn'
                      ? <RosterExperience player={player} onSave={onUpdateExperience} />
                      : <span className="muted-cell">{player ? experienceLabels[player.experience] : '—'}</span>}
                  </td>
                  <td><span className={`status-text status-${entry.registrationStatus}`}>{entry.registrationStatus}</span></td>
                  <td>{money(due)}{entry.discountCents > 0 && <small className="subcell">discount {money(entry.discountCents)}</small>}</td>
                  <td>
                    {entry.registrationStatus === 'registered' && (
                      <>
                        <span className={entry.paid ? 'payment-state paid' : 'payment-state unpaid'}>{entry.paid ? `Paid · ${money(entry.amountPaidCents)}` : 'Unpaid'}</span>
                        <PaymentEditor key={entry.id + ':' + entry.updatedAt} entry={entry} onSave={onUpdateEntry} />
                      </>
                    )}
                  </td>
                  <td>
                    {canWithdraw && entry.registrationStatus !== 'withdrawn' && (
                      <button className="text-button danger-text" type="button" onClick={() => void onUpdateEntry(entry.id, canEditAttendance ? { registrationStatus: 'withdrawn', checkedIn: false } : { registrationStatus: 'withdrawn' })}>Withdraw</button>
                    )}
                    {canEditAttendance && entry.registrationStatus === 'withdrawn' && (
                      <button className="text-button" type="button" onClick={() => void onUpdateEntry(entry.id, { registrationStatus: 'registered' })}>Restore</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && <tr><td colSpan={7} className="empty-row">No entrants yet. Add a returning player above or create a player record.</td></tr>}
          </tbody>
        </table>
      </div>
      {waitlisted.length > 0 && (
        <div className="waitlist-bar">
          <div><strong>{waitlisted.length} on waitlist</strong><span>Promote the next entrant when a spot opens.</span></div>
          {canEditAttendance && <button className="button button-secondary button-small" type="button" onClick={async () => {
            const error = await onPromoteWaitlist();
            setMessage(error ?? 'Next entrant promoted.');
          }}>Promote next</button>}
        </div>
      )}
      <p className="table-note">Unpaid entrants remain eligible for the draw. Totals use recorded amounts, not the number of players.</p>
      {canEditAttendance && <p className="table-note">Balanced seeding uses experience until a player has five rated matches. After that it uses their rating.</p>}
    </section>
  );
}

function BulkRosterImport({
  event,
  entries,
  players,
  onCreatePlayer,
  onRegister,
}: {
  event: Tournament;
  entries: Entry[];
  players: Player[];
  onCreatePlayer: RosterProps['onCreatePlayer'];
  onRegister: RosterProps['onRegister'];
}) {
  const [pastedNames, setPastedNames] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => pastedNames.trim()
    ? planBulkRosterImport(pastedNames, players, entries, event)
    : null, [pastedNames, players, entries, event]);

  async function applyPlan() {
    if (!plan?.ok || busy) return;
    setBusy(true);
    setMessage(null);
    let createdPlayers = 0;
    let reusedPlayers = 0;
    let addedEntries = 0;
    let skippedEntries = 0;
    let activeLine = plan.rows[0]?.line ?? 1;

    const stopWithPartialResult = (line: number, detail: string) => {
      setMessage(`${addedEntries} of ${plan.newEntrants} new entrants were added (${createdPlayers} player records created, ${reusedPlayers} existing players reused). Stopped at line ${line}: ${detail} Retry after the workspace refreshes; entries already on the roster will be skipped.`);
    };

    try {
      for (let index = 0; index < plan.rows.length; index += 1) {
        const row = plan.rows[index];
        activeLine = row.line;
        setProgress(`Processing name ${index + 1} of ${plan.rows.length}…`);
        if (row.alreadyOnRoster) {
          skippedEntries += 1;
          continue;
        }

        let playerId = row.playerId;
        if (playerId) {
          reusedPlayers += 1;
        } else {
          const created = await onCreatePlayer({ name: row.name });
          if (!created.ok) {
            stopWithPartialResult(row.line, created.message);
            return;
          }
          playerId = created.value.id;
          createdPlayers += 1;
        }

        const error = await onRegister(playerId, false);
        if (error) {
          stopWithPartialResult(row.line, error);
          return;
        }
        addedEntries += 1;
      }

      setMessage(`${addedEntries} new roster entr${addedEntries === 1 ? 'y' : 'ies'} added (${createdPlayers} new players, ${reusedPlayers} existing players reused). ${skippedEntries} entries were left unchanged: ${plan.existingRegistered} registered (${plan.existingNotCheckedIn} not checked in), ${plan.existingWaitlisted} waitlisted, ${plan.existingWithdrawn} withdrawn. Check-in and payment records were preserved.`);
      setPastedNames('');
    } catch (error) {
      stopWithPartialResult(activeLine, error instanceof Error ? error.message : 'The import could not be completed.');
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  return <details className="bulk-roster-import">
    <summary>Paste a roster list</summary>
    <form className="add-entrant" onSubmit={(submitEvent) => { submitEvent.preventDefault(); void applyPlan(); }}>
      <div>
        <label htmlFor="bulk-roster-names">Player names, one per line</label>
        <textarea
          id="bulk-roster-names"
          rows={5}
          maxLength={3000}
          value={pastedNames}
          disabled={busy}
          onChange={(changeEvent) => { setPastedNames(changeEvent.currentTarget.value); setMessage(null); }}
          placeholder="Paste up to 25 names, one per line"
          style={{ width: '100%', minHeight: 110, resize: 'vertical' }}
        />
      </div>
      <p className="add-entrant-hint">Unique existing names are reused case-insensitively. Review the capacity check before adding; repeated or ambiguous names need individual handling.</p>
      {plan?.ok && <p className="add-entrant-hint" role="status">
        Ready to add {plan.newEntrants} entries: {plan.rows.filter((row) => !row.alreadyOnRoster && row.playerId === null).length} new player records and {plan.rows.filter((row) => !row.alreadyOnRoster && row.playerId !== null).length} existing players. Already on event: {plan.existingRegistered} registered ({plan.existingNotCheckedIn} not checked in), {plan.existingWaitlisted} waitlisted, {plan.existingWithdrawn} withdrawn. Existing check-in and payment records will stay unchanged.
      </p>}
      {plan?.ok && (plan.existingWaitlisted > 0 || plan.existingWithdrawn > 0 || plan.existingNotCheckedIn > 0) && <ul className="add-entrant-hint" aria-label="Existing entries that are not draw-ready">
        {plan.rows.filter((row) => row.alreadyOnRoster && (
          row.existingRegistrationStatus === 'waitlisted'
          || row.existingRegistrationStatus === 'withdrawn'
          || (row.existingRegistrationStatus === 'registered' && !row.existingCheckedIn)
        )).map((row) => <li key={row.line}>
          Line {row.line}, {row.name}: {row.existingRegistrationStatus === 'registered' ? 'registered, not checked in' : row.existingRegistrationStatus}.
        </li>)}
      </ul>}
      {plan && !plan.ok && <p className="field-error" role="alert">{plan.message}</p>}
      {progress && <p className="inline-status" role="status">{progress}</p>}
      {message && <p className="inline-status" role="status">{message}</p>}
      <button className="button button-secondary button-small" type="submit" disabled={busy || !plan?.ok}>
        {busy ? 'Adding roster…' : 'Add pasted names'}
      </button>
    </form>
  </details>;
}

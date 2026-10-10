import { useMemo, useState } from 'react';
import { amountDueCents, parseMoneyToCents, paymentDraft } from '../lib/money';
import { downloadRosterCsv } from '../lib/export';
import type { DemoState } from '../lib/demo';
import type { Entry, PaymentMethod, Player, Tournament } from '../types';

interface RosterProps {
  state: DemoState;
  event: Tournament;
  entries: Entry[];
  players: Player[];
  onRegister: (playerId: string) => Promise<string | null>;
  onUpdateEntry: (entryId: string, patch: Partial<Entry>) => Promise<string | null>;
  onPromoteWaitlist: () => Promise<string | null>;
}

const currency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const money = (cents: number) => currency.format(cents / 100);

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

export function Roster({ state, event, entries, players, onRegister, onUpdateEntry, onPromoteWaitlist }: RosterProps) {
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
          <p>Check in entrants and record what was actually collected.</p>
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

      {message && <p className="inline-status" role="status">{message}</p>}
      <div className="table-scroll">
        <table className="roster-table">
          <thead>
            <tr><th>Player</th><th>Check-in</th><th>Registration</th><th>Fee due</th><th>Payment</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const player = entry.player ?? players.find((candidate) => candidate.id === entry.playerId);
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
            {entries.length === 0 && <tr><td colSpan={6} className="empty-row">No entrants yet. Add a returning player above or create a player record.</td></tr>}
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
    </section>
  );
}

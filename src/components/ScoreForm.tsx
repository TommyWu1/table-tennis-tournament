import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { validateSeries } from '../domain/scores';
import type { BestOf, GameScore } from '../types';

interface ScoreFormProps {
  matchId: string;
  version: number;
  playerA: string;
  playerB: string;
  bestOf: BestOf;
  initialGames?: readonly GameScore[];
  submitLabel?: string;
  saving?: boolean;
  error?: string | null;
  disabledMessage?: string | null;
  onSave: (games: GameScore[]) => void;
}

const draftKey = (matchId: string, version: number) => 'tttm:score-draft:' + matchId + ':' + version;

export function ScoreForm({
  matchId,
  version,
  playerA,
  playerB,
  bestOf,
  initialGames,
  submitLabel = 'Save score',
  saving = false,
  error,
  disabledMessage,
  onSave,
}: ScoreFormProps) {
  const [rows, setRows] = useState<Array<[string, string]>>(() => {
    try {
      const stored = sessionStorage.getItem(draftKey(matchId, version));
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.length <= bestOf
          && parsed.every((row) => Array.isArray(row) && row.length === 2 && row.every((value) => typeof value === 'string'))) {
          return parsed as Array<[string, string]>;
        }
      }
    } catch { /* Keep score draft in memory if session storage is unavailable. */ }
    const source = initialGames?.length ? initialGames : [[0, 0] as const];
    return source.map(([a, b]) => [initialGames?.length ? String(a) : '', initialGames?.length ? String(b) : '']);
  });
  const [tried, setTried] = useState(false);

  useEffect(() => {
    try { sessionStorage.setItem(draftKey(matchId, version), JSON.stringify(rows)); } catch { /* Session draft remains in component state. */ }
  }, [matchId, version, rows]);

  const numericGames = useMemo(() => rows.map(([a, b]) => [Number(a), Number(b)] as const), [rows]);
  const completeRows = rows.every(([a, b]) => a.trim() !== '' && b.trim() !== '');
  const validation = completeRows ? validateSeries(bestOf, numericGames) : null;
  const inputError = tried && !validation?.ok
    ? (completeRows && validation && !validation.ok ? validation.message : 'Enter both points for every game.')
    : null;

  function updateScore(index: number, side: 0 | 1, value: string) {
    setRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next: [string, string] = [...row];
      next[side] = value;
      return next;
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    if (!validation?.ok) return;
    onSave(numericGames);
  }

  return (
    <form className="score-form" onSubmit={submit} aria-label={`Score for ${playerA} vs ${playerB}`}>
      <div className="score-form-heading">
        <strong>Game scores</strong>
        <span>Best of {bestOf}</span>
      </div>
      {rows.map((row, index) => (
        <div className="game-score-row" key={index}>
          <span className="game-label">Game {index + 1}</span>
          <label>
            <span className="sr-only">{playerA} points, game {index + 1}</span>
            <input
              aria-label={`${playerA} points, game ${index + 1}`}
              type="number"
              inputMode="numeric"
              min="0"
              max="99"
              step="1"
              value={row[0]}
              onChange={(event) => updateScore(index, 0, event.currentTarget.value)}
              required
            />
          </label>
          <span className="score-separator">–</span>
          <label>
            <span className="sr-only">{playerB} points, game {index + 1}</span>
            <input
              aria-label={`${playerB} points, game ${index + 1}`}
              type="number"
              inputMode="numeric"
              min="0"
              max="99"
              step="1"
              value={row[1]}
              onChange={(event) => updateScore(index, 1, event.currentTarget.value)}
              required
            />
          </label>
          {rows.length > 1 && index === rows.length - 1 && !validation?.ok && (
            <button className="icon-button" type="button" aria-label="Remove last game" onClick={() => setRows((current) => current.slice(0, -1))}>−</button>
          )}
        </div>
      ))}
      {!validation?.ok && rows.length < bestOf && (
        <button className="text-button" type="button" onClick={() => setRows((current) => [...current, ['', '']])}>
          + Add game
        </button>
      )}
      {validation?.ok && (
        <p className="score-winner" role="status">
          Winner: <strong>{validation.winner === 'a' ? playerA : playerB}</strong>
        </p>
      )}
      {(inputError || error || disabledMessage) && <p className="field-error" role="alert">{disabledMessage ?? error ?? inputError}</p>}
      <button className="button button-primary button-small" type="submit" disabled={saving || Boolean(disabledMessage)}>
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

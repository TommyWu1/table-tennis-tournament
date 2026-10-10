import type { BestOf, GameScore, ScoreValidation } from '../types';

function validGame([pointsA, pointsB]: GameScore): 'a' | 'b' | null {
  if (!Number.isInteger(pointsA) || !Number.isInteger(pointsB) || pointsA < 0 || pointsB < 0 || pointsA === pointsB) return null;
  const high = Math.max(pointsA, pointsB);
  const low = Math.min(pointsA, pointsB);
  if (high === 11 && low <= 9) return pointsA > pointsB ? 'a' : 'b';
  if (high >= 12 && high - low === 2) return pointsA > pointsB ? 'a' : 'b';
  return null;
}

export function validateSeries(bestOf: BestOf, games: readonly GameScore[]): ScoreValidation {
  if (![1, 3, 5].includes(bestOf)) return { ok: false, message: 'Best-of must be 1, 3, or 5 games.' };
  const needed = Math.ceil(bestOf / 2);
  if (!games.length || games.length > bestOf) return { ok: false, message: 'Enter a complete match series.' };
  let winsA = 0;
  let winsB = 0;

  for (let index = 0; index < games.length; index += 1) {
    const winner = validGame(games[index]);
    if (!winner) return { ok: false, message: `Game ${index + 1} has an invalid score.` };
    if (winner === 'a') winsA += 1;
    else winsB += 1;
    if (winsA === needed || winsB === needed) {
      if (index !== games.length - 1) return { ok: false, message: 'Do not enter games after the series is decided.' };
      return { ok: true, winner: winsA === needed ? 'a' : 'b', winsA, winsB };
    }
  }
  return { ok: false, message: 'The series is incomplete.' };
}

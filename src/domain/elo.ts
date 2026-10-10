import type { GroupResult } from '../types';

export interface EloUpdate {
  ratingA: number;
  ratingB: number;
  delta: number;
  applied: boolean;
}

function roundSix(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function applyEloResult(
  ratingA: number,
  ratingB: number,
  result: Pick<GroupResult, 'entryA' | 'entryB' | 'kind' | 'winnerId'>,
  kFactor = 32,
): EloUpdate {
  if (result.kind !== 'played') return { ratingA, ratingB, delta: 0, applied: false };
  if (result.winnerId !== result.entryA && result.winnerId !== result.entryB) {
    throw new RangeError('A played result must identify one of its entrants as winner.');
  }
  const actual = result.winnerId === result.entryA ? 1 : 0;
  const delta = roundSix(kFactor * (actual - expectedScore(ratingA, ratingB)));
  return {
    ratingA: roundSix(ratingA + delta),
    ratingB: roundSix(ratingB - delta),
    delta,
    applied: true,
  };
}

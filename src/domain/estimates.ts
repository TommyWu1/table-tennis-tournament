import type { Experience } from '../types';

export const DEFAULT_RATING = 1000;

const EXPERIENCE_RATINGS: Record<Experience, number> = {
  unknown: DEFAULT_RATING,
  beginner: 800,
  casual: DEFAULT_RATING,
  club: 1200,
  varsity: 1400,
};

export function estimateRating(experience: Experience): number {
  return EXPERIENCE_RATINGS[experience];
}

export function isProvisional(ratedMatches: number): boolean {
  return ratedMatches < 5;
}

export function effectiveSeedValue(player: {
  rating: number;
  ratedMatchCount: number;
  experience: Experience;
}): number {
  return isProvisional(player.ratedMatchCount) ? estimateRating(player.experience) : player.rating;
}

/** A lower-bound table-time estimate from total fixture workload. */
export function minimumTableMinutes(
  matchCount: number,
  tableCount: number,
  averageMatchMinutes: number,
): number {
  if (!Number.isInteger(matchCount) || matchCount < 0) {
    throw new RangeError('Match count must be a non-negative integer.');
  }
  if (!Number.isInteger(tableCount) || tableCount < 1) {
    throw new RangeError('Table count must be a positive integer.');
  }
  if (!Number.isFinite(averageMatchMinutes) || averageMatchMinutes <= 0) {
    throw new RangeError('Average match minutes must be a positive finite number.');
  }

  return Math.ceil((matchCount * averageMatchMinutes) / tableCount);
}

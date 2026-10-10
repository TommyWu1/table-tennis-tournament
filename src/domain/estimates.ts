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

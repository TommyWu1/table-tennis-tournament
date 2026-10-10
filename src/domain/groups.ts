import type { Experience, GroupOption, GroupPlan, SeedEntry } from '../types';
import { effectiveSeedValue } from './estimates';
import { seededShuffle, type RandomSeed } from './random';

export interface DrawPlayer {
  entryId: string;
  playerId: string;
  name: string;
  rating: number;
  ratedMatchCount: number;
  experience: Experience;
  seedOverride?: number | null;
}

export type DrawMode = 'balanced' | 'random';

function balancedOrder(entries: readonly SeedEntry[], seed: RandomSeed): SeedEntry[] {
  const sorted = [...entries].sort((left, right) => right.seedValue - left.seedValue || left.entryId.localeCompare(right.entryId));
  const ordered: SeedEntry[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].seedValue === sorted[start].seedValue) end += 1;
    ordered.push(...seededShuffle(sorted.slice(start, end), `${String(seed)}:tie:${sorted[start].seedValue}`));
    start = end;
  }
  return ordered;
}

export function suggestGroups(entrantCount: number): GroupOption[] {
  if (!Number.isInteger(entrantCount) || entrantCount < 4 || entrantCount > 64) return [];
  const options: GroupOption[] = [];
  const minGroups = entrantCount <= 5 ? 1 : Math.ceil(entrantCount / 5);
  const maxGroups = Math.floor(entrantCount / 3);

  for (let groupCount = minGroups; groupCount <= maxGroups; groupCount += 1) {
    const baseSize = Math.floor(entrantCount / groupCount);
    const largerGroupCount = entrantCount % groupCount;
    const sizes = Array.from({ length: groupCount }, (_, index) => baseSize + (index < largerGroupCount ? 1 : 0));
    if (sizes.some((size) => size < 3 || size > 5)) continue;
    const matchCount = sizes.reduce((total, size) => total + (size * (size - 1)) / 2, 0);
    options.push({ sizes, matchCount, minimumGroupMatches: Math.min(...sizes.map((size) => size - 1)) });
  }

  return options.sort((left, right) => {
    const leftThreeEntrants = left.sizes.filter((size) => size === 3).length * 3;
    const rightThreeEntrants = right.sizes.filter((size) => size === 3).length * 3;
    return leftThreeEntrants - rightThreeEntrants
      || left.matchCount - right.matchCount
      || left.sizes.length - right.sizes.length;
  });
}

export function seedEntries(players: readonly DrawPlayer[], seed: RandomSeed): SeedEntry[] {
  const rows = players.map((player) => ({
    entryId: player.entryId,
    playerId: player.playerId,
    name: player.name,
    seedValue: player.seedOverride ?? effectiveSeedValue(player),
  }));
  return balancedOrder(rows, seed);
}

export function createGroupDraw(
  entries: readonly SeedEntry[],
  sizes: readonly number[],
  mode: DrawMode,
  seed: RandomSeed,
): GroupPlan[] {
  if (!sizes.length || sizes.some((size) => !Number.isInteger(size) || size < 3 || size > 5)) {
    throw new RangeError('Group sizes must be integers from 3 to 5.');
  }
  if (sizes.reduce((sum, size) => sum + size, 0) !== entries.length) {
    throw new RangeError('Group sizes must add up to the entrant count.');
  }
  if (new Set(entries.map(({ entryId }) => entryId)).size !== entries.length) {
    throw new RangeError('Each entrant may appear only once in a draw.');
  }

  const drawOrder = mode === 'random'
    ? seededShuffle([...entries].sort((a, b) => a.entryId.localeCompare(b.entryId)), `${String(seed)}:random-draw`)
    : balancedOrder(entries, seed);
  const groups = sizes.map((): string[] => []);
  let entrantIndex = 0;
  let round = 0;

  while (entrantIndex < drawOrder.length) {
    const groupOrder = round % 2 === 0
      ? sizes.map((_, index) => index)
      : sizes.map((_, index) => sizes.length - index - 1);
    for (const groupIndex of groupOrder) {
      if (entrantIndex >= drawOrder.length) break;
      if (groups[groupIndex].length >= sizes[groupIndex]) continue;
      groups[groupIndex].push(drawOrder[entrantIndex].entryId);
      entrantIndex += 1;
    }
    round += 1;
  }

  // Persisted group indexes are 1-based (see entries.group_index).
  return groups.map((entryIds, groupIndex) => ({ groupIndex: groupIndex + 1, entryIds }));
}

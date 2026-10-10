import type { BestOf, PlannedMatch, Slot } from '../types';
import { seededShuffle, type RandomSeed } from './random';

export interface QualifiedEntry {
  entryId: string;
  groupIndex: number;
  place: number;
}

function powerOfTwoAtLeast(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

function seedOrder(size: number): number[] {
  if (size === 1) return [1];
  let order = [1, 2];
  for (let currentSize = 4; currentSize <= size; currentSize *= 2) {
    order = order.flatMap((seed) => [seed, currentSize + 1 - seed]);
  }
  return order;
}

function seedPairs(entryCount: number): Array<[number, number]> {
  const order = seedOrder(powerOfTwoAtLeast(entryCount));
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < order.length; index += 2) {
    const a = order[index] - 1;
    const b = order[index + 1] - 1;
    if (a < entryCount && b < entryCount) pairs.push([a, b]);
  }
  return pairs;
}

export function buildBracket(entryIds: readonly string[], bestOf: BestOf, finalBestOf: BestOf = bestOf): PlannedMatch[] {
  if (entryIds.length > 64) throw new RangeError('A bracket supports at most 64 entrants.');
  if (new Set(entryIds).size !== entryIds.length) throw new RangeError('Bracket entry IDs must be unique.');
  if (entryIds.length < 2) return [];

  const slotCount = powerOfTwoAtLeast(entryIds.length);
  const slots: Slot[] = seedOrder(slotCount).map((seed) => seed <= entryIds.length
    ? { kind: 'entry', entryId: entryIds[seed - 1] }
    : { kind: 'empty' });
  const allMatches: PlannedMatch[] = [];
  let previousRound: PlannedMatch[] = [];
  let round = 1;

  for (let index = 0; index < slots.length; index += 2) {
    const match: PlannedMatch = {
      key: `r${round}-m${index / 2 + 1}`,
      round,
      sequence: index / 2 + 1,
      a: slots[index],
      b: slots[index + 1],
      bestOf,
    };
    previousRound.push(match);
    allMatches.push(match);
  }

  while (previousRound.length > 1) {
    round += 1;
    const nextRound: PlannedMatch[] = [];
    for (let index = 0; index < previousRound.length; index += 2) {
      const match: PlannedMatch = {
        key: `r${round}-m${index / 2 + 1}`,
        round,
        sequence: index / 2 + 1,
        a: { kind: 'winner', matchKey: previousRound[index].key },
        b: { kind: 'winner', matchKey: previousRound[index + 1].key },
        bestOf: previousRound.length === 2 ? finalBestOf : bestOf,
      };
      nextRound.push(match);
      allMatches.push(match);
    }
    previousRound = nextRound;
  }
  if (allMatches.length === 1) allMatches[0].bestOf = finalBestOf;
  return allMatches;
}

export function orderQualifiers(entries: readonly QualifiedEntry[], seed: RandomSeed): QualifiedEntry[] {
  const tiers = new Map<number, QualifiedEntry[]>();
  for (const entry of entries) {
    if (!Number.isInteger(entry.place) || entry.place < 1) throw new RangeError('Finishing place must be a positive integer.');
    tiers.set(entry.place, [...(tiers.get(entry.place) ?? []), entry]);
  }
  const ordered = [...tiers.entries()]
    .sort(([placeA], [placeB]) => placeA - placeB)
    .flatMap(([place, tier]) => seededShuffle(tier, `${String(seed)}:place:${place}`));
  const pairs = seedPairs(ordered.length);
  const rematches = (candidate: readonly QualifiedEntry[]) => pairs.reduce((count, [a, b]) =>
    count + Number(candidate[a].groupIndex === candidate[b].groupIndex), 0);

  for (let pass = 0; pass < ordered.length * ordered.length; pass += 1) {
    const current = rematches(ordered);
    let bestSwap: [number, number] | null = null;
    let bestCount = current;
    for (let left = 0; left < ordered.length; left += 1) {
      for (let right = left + 1; right < ordered.length; right += 1) {
        if (ordered[left].place !== ordered[right].place) continue;
        const candidate = [...ordered];
        [candidate[left], candidate[right]] = [candidate[right], candidate[left]];
        const count = rematches(candidate);
        if (count < bestCount) {
          bestCount = count;
          bestSwap = [left, right];
        }
      }
    }
    if (!bestSwap) break;
    [ordered[bestSwap[0]], ordered[bestSwap[1]]] = [ordered[bestSwap[1]], ordered[bestSwap[0]]];
  }
  return ordered;
}

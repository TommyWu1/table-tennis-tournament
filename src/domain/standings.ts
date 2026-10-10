import type { GameScore, GroupResult, Standing } from '../types';

interface Totals {
  entryId: string;
  played: number;
  walkovers: number;
  wins: number;
  losses: number;
  gameDifference: number;
  pointDifference: number;
}

function groupByValue(ids: readonly string[], value: (id: string) => number): string[][] {
  const buckets = new Map<number, string[]>();
  for (const id of ids) buckets.set(value(id), [...(buckets.get(value(id)) ?? []), id]);
  return [...buckets.entries()].sort(([a], [b]) => b - a).map(([, bucket]) => bucket);
}

function directWinner(a: string, b: string, results: readonly GroupResult[]): string | null {
  const meetings = results.filter((result) =>
    result.kind !== 'void'
      && ((result.entryA === a && result.entryB === b) || (result.entryA === b && result.entryB === a)));
  if (meetings.length !== 1) return null;
  const winner = meetings[0].winnerId;
  return winner === a || winner === b ? winner : null;
}

function lotOrder(ids: readonly string[], lots: readonly string[] | undefined): string[] | null {
  if (!lots) return null;
  const positions = new Map(lots.map((id, index) => [id, index]));
  if (!ids.every((id) => positions.has(id))) return null;
  return [...ids].sort((a, b) => positions.get(a)! - positions.get(b)!);
}

function resolvePair(
  ids: readonly string[],
  totals: ReadonlyMap<string, Totals>,
  results: readonly GroupResult[],
  lots?: readonly string[],
): string[][] {
  const [a, b] = ids;
  const headToHead = directWinner(a, b, results);
  if (headToHead) return [[headToHead], [headToHead === a ? b : a]];
  const statsA = totals.get(a)!;
  const statsB = totals.get(b)!;
  if (statsA.gameDifference !== statsB.gameDifference) {
    return statsA.gameDifference > statsB.gameDifference ? [[a], [b]] : [[b], [a]];
  }
  if (statsA.pointDifference !== statsB.pointDifference) {
    return statsA.pointDifference > statsB.pointDifference ? [[a], [b]] : [[b], [a]];
  }
  const drawn = lotOrder(ids, lots);
  return drawn ? drawn.map((id) => [id]) : [[...ids]];
}

function resolveTie(
  ids: readonly string[],
  totals: ReadonlyMap<string, Totals>,
  results: readonly GroupResult[],
  lots?: readonly string[],
): string[][] {
  if (ids.length <= 1) return [[...ids]];
  if (ids.length === 2) return resolvePair(ids, totals, results, lots);

  const byGames = groupByValue(ids, (id) => totals.get(id)!.gameDifference);
  const resolved: string[][] = [];
  for (const gameBucket of byGames) {
    if (gameBucket.length === 2) {
      resolved.push(...resolvePair(gameBucket, totals, results, lots));
      continue;
    }
    if (gameBucket.length === 1) {
      resolved.push(gameBucket);
      continue;
    }
    const byPoints = groupByValue(gameBucket, (id) => totals.get(id)!.pointDifference);
    for (const pointBucket of byPoints) {
      if (pointBucket.length === 2) resolved.push(...resolvePair(pointBucket, totals, results, lots));
      else if (pointBucket.length === 1) resolved.push(pointBucket);
      else {
        const drawn = lotOrder(pointBucket, lots);
        if (drawn) resolved.push(...drawn.map((id) => [id]));
        else resolved.push([...pointBucket]);
      }
    }
  }
  return resolved;
}

export function calculateStandings(
  entryIds: readonly string[],
  results: readonly GroupResult[],
  drawLots?: readonly string[],
): Standing[] {
  if (new Set(entryIds).size !== entryIds.length) throw new RangeError('Standing entry IDs must be unique.');
  const totals = new Map(entryIds.map((entryId) => [entryId, {
    entryId, played: 0, walkovers: 0, wins: 0, losses: 0, gameDifference: 0, pointDifference: 0,
  }]));

  for (const result of results) {
    const a = totals.get(result.entryA);
    const b = totals.get(result.entryB);
    if (!a || !b || result.entryA === result.entryB) throw new RangeError('Result references invalid group entries.');
    if (result.kind === 'void') continue;
    if (result.kind === 'walkover') {
      a.walkovers += 1;
      b.walkovers += 1;
    } else {
      a.played += 1;
      b.played += 1;
      for (const [pointsA, pointsB] of result.games as readonly GameScore[]) {
        a.gameDifference += pointsA > pointsB ? 1 : pointsA < pointsB ? -1 : 0;
        b.gameDifference += pointsB > pointsA ? 1 : pointsB < pointsA ? -1 : 0;
        a.pointDifference += pointsA - pointsB;
        b.pointDifference += pointsB - pointsA;
      }
    }
    if (result.winnerId === result.entryA) {
      a.wins += 1;
      b.losses += 1;
    } else if (result.winnerId === result.entryB) {
      b.wins += 1;
      a.losses += 1;
    }
  }

  const byWins = groupByValue(entryIds, (id) => totals.get(id)!.wins);
  const rankedBuckets = byWins.flatMap((winsBucket) => resolveTie(winsBucket, totals, results, drawLots));
  let nextRank = 1;
  return rankedBuckets.flatMap((bucket) => {
    const rank = bucket.length === 1 ? nextRank : null;
    nextRank += bucket.length;
    return bucket.map((entryId) => ({ ...totals.get(entryId)!, rank }));
  });
}

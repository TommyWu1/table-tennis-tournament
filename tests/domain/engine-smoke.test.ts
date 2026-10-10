import { describe, expect, test } from 'vitest';
import { applyEloResult } from '../../src/domain/elo';
import { DEFAULT_RATING, effectiveSeedValue, estimateRating } from '../../src/domain/estimates';
import { buildBracket, orderQualifiers } from '../../src/domain/bracket';
import { createGroupDraw, seedEntries, suggestGroups } from '../../src/domain/groups';
import { roundRobin } from '../../src/domain/roundRobin';
import { validateSeries } from '../../src/domain/scores';
import { calculateStandings } from '../../src/domain/standings';

describe('tournament engine smoke cases', () => {
  test('20-player recommendation yields 30 round-robin fixtures and a repeatable seeded draw', () => {
    const option = suggestGroups(20)[0];
    const seeded = seedEntries(Array.from({ length: 20 }, (_, index) => ({
      entryId: `e${index + 1}`,
      playerId: `p${index + 1}`,
      name: `Player ${index + 1}`,
      rating: 1000 + (20 - index),
      ratedMatchCount: 5,
      experience: 'unknown' as const,
      seedOverride: index === 0 ? 900 : null,
    })), 91);
    const draw = createGroupDraw(seeded, option.sizes, 'balanced', 91);
    const repeated = createGroupDraw(seeded, option.sizes, 'balanced', 91);
    const randomDraw = createGroupDraw(seeded, option.sizes, 'random', 91);
    const repeatedRandomDraw = createGroupDraw(seeded, option.sizes, 'random', 91);
    const fixtureCount = draw.reduce((sum, group) => sum + roundRobin(group.entryIds).length, 0);

    expect(seeded.find(({ entryId }) => entryId === 'e1')?.seedValue).toBe(900);
    expect(option.sizes).toEqual([4, 4, 4, 4, 4]);
    expect(option.matchCount).toBe(30);
    expect(fixtureCount).toBe(30);
    expect(repeated).toEqual(draw);
    expect(repeatedRandomDraw).toEqual(randomDraw);
  });

  test('rejects illegal deuce and games entered after the series is clinched', () => {
    expect(validateSeries(1, [[14, 12]]).ok).toBe(true);
    expect(validateSeries(1, [[11, 10]]).ok).toBe(false);
    expect(validateSeries(3, [[11, 4], [11, 7], [11, 8]]).ok).toBe(false);
  });

  test('ten-player knockout distinguishes six empty-slot byes from nine contested fixtures', () => {
    const matches = buildBracket(Array.from({ length: 10 }, (_, index) => `e${index + 1}`), 3);
    expect(matches.filter(({ a, b }) => a.kind === 'empty' || b.kind === 'empty')).toHaveLength(6);
    expect(matches.filter(({ a, b }) => a.kind !== 'empty' && b.kind !== 'empty')).toHaveLength(9);
    expect(matches.filter(({ round }) => round > 1).every(({ a, b }) => a.kind === 'winner' && b.kind === 'winner')).toBe(true);
  });

  test('keeps qualification tiers intact and avoids first-round group rematches when possible', () => {
    const qualifiers = [0, 1, 2, 3].flatMap((groupIndex) => [
      { entryId: `winner-${groupIndex}`, groupIndex, place: 1 },
      { entryId: `runner-${groupIndex}`, groupIndex, place: 2 },
    ]);
    const ordered = orderQualifiers(qualifiers, 37);
    const firstRound = buildBracket(ordered.map(({ entryId }) => entryId), 3).slice(0, 4);
    const groups = new Map(ordered.map(({ entryId, groupIndex }) => [entryId, groupIndex]));

    expect(ordered.slice(0, 4).every(({ place }) => place === 1)).toBe(true);
    expect(ordered.slice(4).every(({ place }) => place === 2)).toBe(true);
    expect(firstRound.every(({ a, b }) => groups.get(a.kind === 'entry' ? a.entryId : '') !== groups.get(b.kind === 'entry' ? b.entryId : ''))).toBe(true);
  });

  test('standings count walkover wins without inventing games and leave an unresolved tie null', () => {
    const standings = calculateStandings(['a', 'b', 'c', 'd'], [
      { entryA: 'a', entryB: 'b', kind: 'walkover', games: [], winnerId: 'a' },
      { entryA: 'c', entryB: 'd', kind: 'walkover', games: [], winnerId: 'c' },
    ]);
    expect(standings.find(({ entryId }) => entryId === 'a')).toMatchObject({ played: 0, walkovers: 1, wins: 1, gameDifference: 0, pointDifference: 0 });
    expect(standings.find(({ entryId }) => entryId === 'b')).toMatchObject({ played: 0, walkovers: 1, losses: 1, gameDifference: 0, pointDifference: 0 });
    expect(standings.filter(({ rank }) => rank === null)).toHaveLength(4);
    expect(calculateStandings(['a', 'b', 'c', 'd'], [
      { entryA: 'a', entryB: 'b', kind: 'walkover', games: [], winnerId: 'a' },
      { entryA: 'c', entryB: 'd', kind: 'walkover', games: [], winnerId: 'c' },
    ], ['c', 'a', 'b', 'd']).map(({ entryId, rank }) => [entryId, rank])).toEqual([
      ['c', 1], ['a', 2], ['b', 3], ['d', 4],
    ]);
  });

  test('uses the documented provisional estimate and one K=32 Elo update', () => {
    expect(DEFAULT_RATING).toBe(1000);
    expect(estimateRating('varsity')).toBe(1400);
    expect(effectiveSeedValue({ rating: 1800, ratedMatchCount: 4, experience: 'beginner' })).toBe(800);
    expect(effectiveSeedValue({ rating: 1800, ratedMatchCount: 5, experience: 'beginner' })).toBe(1800);
    expect(applyEloResult(1000, 1000, { entryA: 'a', entryB: 'b', kind: 'played', winnerId: 'a' }))
      .toMatchObject({ ratingA: 1016, ratingB: 984, delta: 16, applied: true });
  });
});

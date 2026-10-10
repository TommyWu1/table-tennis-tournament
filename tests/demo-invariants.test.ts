import { afterEach, describe, expect, test } from 'vitest';
import { loadDemoState, resetDemoState, startDemoGroups } from '../src/lib/demo';

afterEach(() => {
  resetDemoState();
});

describe('local demo invariants', () => {
  test('persists group assignment on canonical entrants when groups start', () => {
    const state = resetDemoState();
    const tournament = state.tournaments[0];
    const entries = state.entries.filter((entry) => entry.tournamentId === tournament.id);
    expect(state.players).toHaveLength(19);
    expect(new Set(state.players.map(({ id }) => id)).size).toBe(19);
    expect(state.players.every((player) => player.ratedMatchCount === 0 && player.experience === 'unknown')).toBe(true);
    expect(tournament.state).toBe('setup');
    expect(state.matches).toEqual([]);
    expect(entries.every((entry) => !entry.checkedIn && !entry.paid)).toBe(true);
    entries.forEach((entry) => { entry.checkedIn = true; });
    const sizes = [5, 5, 5, 4];
    let offset = 0;
    const plans = sizes.map((size, index) => {
      const entryIds = entries.slice(offset, offset + size).map(({ id }) => id);
      offset += size;
      return { groupIndex: index + 1, entryIds };
    });

    const result = startDemoGroups(state, tournament.id, tournament.revision, plans, 10, 'balanced');

    expect(result.ok).toBe(true);
    expect(entries.map(({ groupIndex }) => groupIndex)).toEqual(sizes.flatMap((size, index) => Array(size).fill(index + 1)));
    expect(loadDemoState().entries).toHaveLength(19);
  });
});

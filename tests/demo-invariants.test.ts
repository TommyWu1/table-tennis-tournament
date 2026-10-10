import { afterEach, describe, expect, test } from 'vitest';
import { loadDemoState, resetDemoState, startDemoGroups } from '../src/lib/demo';

afterEach(() => {
  resetDemoState();
});

describe('local demo invariants', () => {
  test('persists group assignment on canonical entrants when groups start', () => {
    const state = loadDemoState();
    const tournament = state.tournaments[0];
    const entries = state.entries.filter((entry) => entry.tournamentId === tournament.id);
    entries.forEach((entry) => { entry.checkedIn = true; });
    const plans = [
      { groupIndex: 1, entryIds: entries.slice(0, 4).map(({ id }) => id) },
      { groupIndex: 2, entryIds: entries.slice(4).map(({ id }) => id) },
    ];

    const result = startDemoGroups(state, tournament.id, tournament.revision, plans, 10, 'balanced');

    expect(result.ok).toBe(true);
    expect(entries.map(({ groupIndex }) => groupIndex)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
  });
});

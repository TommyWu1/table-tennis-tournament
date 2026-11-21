import { describe, expect, test } from 'vitest';
import { planBulkRosterImport } from '../src/pages/Roster';
import type { Entry, Player, Tournament } from '../src/types';

function player(id: string, name: string, archived = false): Player {
  return { id, name, label: null, experience: 'unknown', rating: 1000, ratedMatchCount: 0,
    archived, createdAt: '', updatedAt: '' };
}

const setupEvent = (registrationCap: number): Pick<Tournament, 'state' | 'registrationCap'> => ({
  state: 'setup', registrationCap,
});

describe('bulk roster import planning', () => {
  test('reuses a unique case-insensitive player match and skips an existing event entry', () => {
    const plan = planBulkRosterImport('  ava chen  \nNew Person', [player('p1', 'Ava Chen')], [
      { playerId: 'p1', registrationStatus: 'registered', checkedIn: true } as Entry,
    ], setupEvent(2));

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rows).toEqual([
      { line: 1, name: 'ava chen', playerId: 'p1', alreadyOnRoster: true,
        existingRegistrationStatus: 'registered', existingCheckedIn: true },
      { line: 2, name: 'New Person', playerId: null, alreadyOnRoster: false,
        existingRegistrationStatus: null, existingCheckedIn: null },
    ]);
    expect(plan.newEntrants).toBe(1);
    expect(plan.existingNotCheckedIn).toBe(0);
  });

  test('reports existing waitlisted, withdrawn and not-checked-in entries for review', () => {
    const plan = planBulkRosterImport('Ava Chen\nBea Kim\nCam Wu', [
      player('p1', 'Ava Chen'), player('p2', 'Bea Kim'), player('p3', 'Cam Wu'),
    ], [
      { playerId: 'p1', registrationStatus: 'waitlisted', checkedIn: false } as Entry,
      { playerId: 'p2', registrationStatus: 'withdrawn', checkedIn: false } as Entry,
      { playerId: 'p3', registrationStatus: 'registered', checkedIn: false } as Entry,
    ], setupEvent(3));

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.newEntrants).toBe(0);
    expect(plan.existingWaitlisted).toBe(1);
    expect(plan.existingWithdrawn).toBe(1);
    expect(plan.existingNotCheckedIn).toBe(1);
    expect(plan.rows.map((row) => row.existingRegistrationStatus)).toEqual([
      'waitlisted', 'withdrawn', 'registered',
    ]);
  });

  test('rejects ambiguous directory matches and repeated names in the paste', () => {
    const ambiguous = planBulkRosterImport('Jordan Lee', [
      player('p1', 'Jordan Lee'), player('p2', 'jordan lee', true),
    ], [], setupEvent(25));
    const repeated = planBulkRosterImport('Sam Lee\nsam lee', [], [], setupEvent(25));

    expect(ambiguous.ok).toBe(false);
    expect(repeated.ok).toBe(false);
  });

  test('rejects a batch before writes when its new entrants exceed remaining capacity', () => {
    const plan = planBulkRosterImport('One New Player', [], [
      { playerId: 'existing', registrationStatus: 'registered', checkedIn: true } as Entry,
    ], setupEvent(1));

    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toMatch(/capacity/i);
  });
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Roster } from '../src/pages/Roster';
import type { Entry, Player, Tournament } from '../src/types';

test('shows the roster in name order and saves an experience change for the selected player', async () => {
  const players = [
    { id: 'z', name: 'Zain Test', experience: 'unknown' },
    { id: 'a', name: 'ada Test', experience: 'casual' },
  ] as Player[];
  const event = { id: 'event', state: 'setup', registrationCap: 25 } as Tournament;
  const entries = players.map((player) => ({
    id: `entrant-${player.id}`, playerId: player.id, tournamentId: event.id,
    registrationStatus: 'registered', checkedIn: false, paid: false,
    baseFeeCents: 1000, discountCents: 0, amountPaidCents: 0,
  })) as Entry[];
  const onUpdateExperience = vi.fn().mockResolvedValue('Could not save. Try again.');
  render(<Roster state={{ players, tournaments: [event], entries, matches: [] }}
    event={event} entries={entries} players={players}
    onRegister={vi.fn()} onCreatePlayer={vi.fn()} onUpdateEntry={vi.fn()}
    onPromoteWaitlist={vi.fn()} onUpdateExperience={onUpdateExperience} />);

  expect(within(screen.getByRole('table')).getAllByRole('rowheader').map((cell) => cell.textContent))
    .toEqual(['ada Test', 'Zain Test']);
  const experience = screen.getByRole('combobox', { name: 'Experience for ada Test' });
  fireEvent.change(experience, { target: { value: 'club' } });
  expect(onUpdateExperience).toHaveBeenCalledWith('a', 'club');
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(experience).toHaveValue('casual');
});

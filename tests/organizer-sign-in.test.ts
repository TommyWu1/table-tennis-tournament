import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn } from '../src/lib/remote';

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock('../src/lib/supabase', () => ({
  getSupabase: () => ({
    auth,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: auth.getProfile }) }) }),
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'test-user' } } }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

describe('organizer access-code authentication', () => {
  const credentials = ['organizer@example.com', 'test-password'] as const;

  it('accepts an authenticated organizer without signing the session out', async () => {
    auth.getProfile.mockResolvedValue({ data: { id: 'test-user', role: 'admin' }, error: null });

    await expect(signIn(...credentials, 'admin')).resolves.toMatchObject({
      ok: true,
      value: { role: 'admin' },
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('rejects a scorekeeper and clears the session created by the organizer form', async () => {
    auth.getProfile.mockResolvedValue({ data: { id: 'test-user', role: 'scorekeeper' }, error: null });

    await expect(signIn(...credentials, 'admin')).resolves.toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });

    await expect(signIn(...credentials)).resolves.toMatchObject({
      ok: true,
      value: { role: 'scorekeeper' },
    });
  });
});

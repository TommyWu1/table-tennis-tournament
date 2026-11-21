import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Groups } from './pages/Groups';
import { Matches } from './pages/Matches';
import { Players } from './pages/Players';
import { Results } from './pages/Results';
import { Roster } from './pages/Roster';
import { Scorekeeper } from './pages/Scorekeeper';
import { TournamentSettings } from './pages/TournamentSettings';
import { LiveTables } from './components/LiveTables';
import { Display } from './pages/Display';
import { downloadWorkspaceSnapshot } from './lib/export';
import {
  getEntries,
  type TournamentMatch,
} from './lib/tournament';
import { isSupabaseConfigured } from './lib/supabase';
import {
  getRemoteProfile,
  loadRemoteWorkspace,
  remoteActions,
  scorekeeperActions,
  signIn,
  signOut,
  type RemoteWorkspace,
} from './lib/remote';
import type { Entry, GameScore, GroupPlan, MutationResult, Player, Profile, Role, Tournament } from './types';

type Section = 'Tournament' | 'Players' | 'Results';
type TournamentTab = 'Players & payments' | 'Matches' | 'Groups & bracket';
const remoteMode = isSupabaseConfigured();
const displayRequested = new URLSearchParams(window.location.search).get('view') === 'display';
const displayEventId = displayRequested ? new URLSearchParams(window.location.search).get('event') ?? '' : '';
const SCORE_DRAFT_PREFIX = 'tttm:score-draft:';
const ORGANIZER_EMAIL = import.meta.env.VITE_ORGANIZER_EMAIL?.trim() || 'organizer@example.com';

function withPlayers(workspace: RemoteWorkspace): RemoteWorkspace {
  const players = new Map(workspace.players.map((player) => [player.id, player]));
  return { ...workspace, entries: workspace.entries.map((entry) => ({ ...entry, player: players.get(entry.playerId) })) };
}

export default function App() {
  const [remoteWorkspace, setRemoteWorkspace] = useState<RemoteWorkspace | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(remoteMode);
  const [remoteFailure, setRemoteFailure] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState(displayEventId);
  const [loadedEventId, setLoadedEventId] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [section, setSection] = useState<Section>('Tournament');
  const [tournamentTab, setTournamentTab] = useState<TournamentTab>('Players & payments');
  const [notice, setNotice] = useState<string | null>(null);
  const refreshLock = useRef(false);
  const profileId = profile?.id;
  const profileRole = profile?.role;
  const state = remoteWorkspace;
  const eventId = selectedEventId || state?.tournaments[0]?.id || '';
  const event = state?.tournaments.find((tournament) => tournament.id === eventId) ?? (displayEventId ? undefined : state?.tournaments[0]);
  const entries = state && event ? getEntries(state, event.id) : [];

  const refreshRemote = useCallback(async (targetEventId?: string) => {
    if (!remoteMode || refreshLock.current) return;
    refreshLock.current = true;
    try {
      const requestedEventId = displayEventId || targetEventId;
      const workspace = await loadRemoteWorkspace(requestedEventId || undefined);
      if (!workspace) {
        setProfile(null);
        setRemoteWorkspace(null);
        setLoadedEventId('');
        setRemoteFailure(null);
      } else {
        const normalized = withPlayers(workspace);
        const preferred = normalized.tournaments.find((item) => item.state === 'groups' || item.state === 'playoffs') ?? normalized.tournaments[0];
        const actualEventId = normalized.scoreboard?.eventId
          ?? (requestedEventId && normalized.tournaments.some((item) => item.id === requestedEventId) ? requestedEventId : preferred?.id)
          ?? '';
        setProfile(normalized.profile);
        setRemoteWorkspace(normalized);
        setLoadedEventId(actualEventId);
        setRemoteFailure(null);
        if (normalized.scoreboard) setSelectedEventId(normalized.scoreboard.eventId);
        else if (!displayEventId && actualEventId && (!targetEventId || !normalized.tournaments.some((item) => item.id === targetEventId))) setSelectedEventId(actualEventId);
      }
      setLastRefreshed(new Date());
    } catch (error) {
      setRemoteFailure(error instanceof Error ? error.message : 'Could not connect to the shared tournament database.');
    } finally { refreshLock.current = false; setRemoteLoading(false); }
  }, []);

  useEffect(() => {
    if (!remoteMode) return;
    let active = true;
    (async () => {
      setRemoteLoading(true);
      try {
        const currentProfile = await getRemoteProfile();
        if (!active) return;
        setProfile(currentProfile);
        if (currentProfile) await refreshRemote();
        else { setRemoteWorkspace(null); setRemoteLoading(false); }
      } catch (error) {
        if (!active) return;
        setRemoteFailure(error instanceof Error ? error.message : 'Could not connect to Supabase.');
        setRemoteLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshRemote]);

  useEffect(() => {
    if (!remoteMode || !profileId || profileRole === 'scorekeeper' || !selectedEventId) return;
    const timer = window.setTimeout(() => void refreshRemote(selectedEventId), 0);
    return () => window.clearTimeout(timer);
  }, [profileId, profileRole, selectedEventId, refreshRemote]);

  useEffect(() => {
    if (!remoteMode || !profileId) return;
    const refreshIfVisible = () => { if (document.visibilityState === 'visible') void refreshRemote(profileRole === 'admin' ? selectedEventId : undefined); };
    const timer = window.setInterval(refreshIfVisible, 5000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshIfVisible); document.removeEventListener('visibilitychange', refreshIfVisible); };
  }, [profileId, profileRole, selectedEventId, refreshRemote]);

  async function runRemote<T>(resultPromise: Promise<MutationResult<T>>, targetId = eventId): Promise<{ error: string | null; value?: T }> {
    try {
      const result = await resultPromise;
      if (!result.ok) {
        setNotice(result.message);
        if (result.code === 'conflict') await refreshRemote(targetId);
        return { error: result.message };
      }
      await refreshRemote(targetId);
      setNotice(null);
      return { error: null, value: result.value };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save. Check the connection and try again.';
      setNotice(message);
      return { error: message };
    }
  }

  async function createEvent(input: { name: string; startsAt: string }): Promise<string | null> {
    const result = await runRemote(remoteActions.createTournament(input), '');
    if (result.value) setSelectedEventId(result.value.id);
    return result.error;
  }

  async function updateEvent(targetId: string, patch: Partial<Tournament>): Promise<string | null> {
    return (await runRemote(remoteActions.updateTournament(targetId, patch), targetId)).error;
  }

  async function updateEntry(entryId: string, patch: Partial<Entry>): Promise<string | null> {
    const allowed = {
      checkedIn: patch.checkedIn, paid: patch.paid, paymentMethod: patch.paymentMethod,
      amountPaidCents: patch.amountPaidCents, discountCents: patch.discountCents,
      paymentNote: patch.paymentNote, registrationStatus: patch.registrationStatus,
    };
    return (await runRemote(remoteActions.updateEntry(entryId, allowed))).error;
  }

  async function createPlayerRecord(input: { name: string }): Promise<MutationResult<Player>> {
    const result = await remoteActions.createPlayer(input);
    if (!result.ok) {
      if (result.code === 'network') {
        try {
          const latest = await loadRemoteWorkspace(eventId);
          const loaded = latest ? withPlayers(latest) : null;
          const normalizeName = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();
          const matches = loaded?.players.filter((player) => normalizeName(player.name) === normalizeName(input.name)) ?? [];
          if (loaded) {
            setRemoteWorkspace(loaded);
            setLoadedEventId(eventId);
          }
          if (matches.length === 1) {
            setNotice(null);
            return { ok: true, value: matches[0] };
          }
        } catch {
          // Keep the original mutation error; the retry can check the directory again.
        }
      }
      setNotice(result.message);
      if (result.code === 'conflict') await refreshRemote(eventId);
      return result;
    }
    await refreshRemote(eventId);
    setNotice(null);
    return result;
  }

  async function createPlayer(input: { name: string; label?: string | null; experience?: 'unknown' | 'beginner' | 'casual' | 'club' | 'varsity' }): Promise<string | null> {
    const result = await remoteActions.createPlayer(input);
    if (!result.ok) { setNotice(result.message); return result.message; }
    await refreshRemote(eventId);
    setNotice(null);
    return null;
  }

  async function updatePlayer(playerId: string, patch: { name?: string; label?: string | null; experience?: 'unknown' | 'beginner' | 'casual' | 'club' | 'varsity' }): Promise<string | null> {
    return (await runRemote(remoteActions.updatePlayer(playerId, patch))).error;
  }

  async function archivePlayer(playerId: string): Promise<string | null> {
    return (await runRemote(remoteActions.archivePlayer(playerId))).error;
  }

  async function registerEntry(playerId: string, allowWaitlist = true): Promise<string | null> {
    if (!event) return 'Create an event first.';
    return (await runRemote(remoteActions.registerEntry(event.id, playerId, allowWaitlist))).error;
  }

  async function promoteWaitlist(): Promise<string | null> {
    if (!event) return 'Create an event first.';
    return (await runRemote(remoteActions.promoteWaitlist(event.id))).error;
  }

  async function startGroups(plans: GroupPlan[], seed: number, mode: 'balanced' | 'random'): Promise<string | null> {
    if (!event || !state) return 'Create an event first.';
    return (await runRemote(remoteActions.startGroups(event.id, event.revision, plans, seed, mode))).error;
  }

  async function createPlayoffs(seed: number): Promise<string | null> {
    if (!event || !state) return 'Create an event first.';
    return (await runRemote(remoteActions.createPlayoffs(event.id, event.revision, seed))).error;
  }

  async function startMatch(matchId: string, table: number, version: number): Promise<string | null> {
    return (await runRemote(remoteActions.startMatch(matchId, table, version))).error;
  }

  async function saveScore(match: TournamentMatch, games: GameScore[], _correcting: boolean, expectedVersion: number): Promise<string | null> {
    const result = await runRemote(remoteActions.saveScore(match.id, expectedVersion, games));
    if (!result.error) sessionStorage.removeItem(SCORE_DRAFT_PREFIX + match.id + ':' + expectedVersion);
    return result.error;
  }

  async function resolveMatch(match: TournamentMatch, kind: 'walkover' | 'void', winner: string | null, reason: string): Promise<string | null> {
    return (await runRemote(remoteActions.resolveMatch(match.id, match.version, kind, winner, reason))).error;
  }

  async function clearResult(matchId: string, version: number): Promise<string | null> {
    return (await runRemote(remoteActions.clearResult(matchId, version))).error;
  }

  async function resetPlayoffs(): Promise<string | null> {
    if (!event) return 'Create an event first.';
    return (await runRemote(remoteActions.resetPlayoffs(event.id, event.revision))).error;
  }

  async function finishTournament(): Promise<string | null> {
    if (!event) return 'Create an event first.';
    return (await runRemote(remoteActions.finishTournament(event.id, event.revision))).error;
  }

  async function cancelTournament(): Promise<string | null> {
    if (!event) return 'Create an event first.';
    return (await runRemote(remoteActions.cancelTournament(event.id, event.revision))).error;
  }

  async function signOutUser() {
    const result = await signOut();
    if (!result.ok) { setRemoteFailure(result.message); return; }
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(SCORE_DRAFT_PREFIX)) sessionStorage.removeItem(key);
    }
    setProfile(null); setRemoteWorkspace(null); setSelectedEventId(''); setLoadedEventId(''); setRemoteFailure(null);
  }

  async function saveScorekeeper(match: import('./types').ScoreboardMatch, games: GameScore[], expectedVersion: number) {
    const result = await scorekeeperActions.saveScore(match.id, expectedVersion, games);
    if (!result.ok) {
      if (result.code === 'conflict') await refreshRemote(match.eventId);
      return result.message;
    }
    sessionStorage.removeItem(SCORE_DRAFT_PREFIX + match.id + ':' + expectedVersion);
    await refreshRemote(match.eventId);
    return null;
  }

  async function login(email: string, password: string, requiredRole?: Role): Promise<string | null> {
    const result = await signIn(email, password, requiredRole);
    if (!result.ok) return result.message;
    setProfile(result.value);
    setRemoteLoading(true);
    await refreshRemote();
    return null;
  }

  if (!remoteMode) return <MissingConfiguration />;
  if (remoteLoading && !profile && !remoteFailure) return <LoadingScreen />;
  if (remoteFailure && !profile) return <ConnectionError message={remoteFailure} onRetry={() => void refreshRemote()} />;
  if (!profile) return <SignInScreen onSignIn={login} error={remoteFailure} />;
  if (displayRequested && profile.role === 'scorekeeper') return <main className="display-shell"><h1>Organizer account required</h1><p>Open the projector view from the organizer’s browser. Scorekeeper accounts use the phone score-entry view.</p></main>;
  if (profile.role === 'scorekeeper') {
    if (remoteFailure && !remoteWorkspace?.scoreboard) return <ConnectionError message={remoteFailure} onRetry={() => void refreshRemote()} />;
    if (!remoteWorkspace?.scoreboard) return <LoadingScreen message="Looking for the active event…" />;
    return <Scorekeeper scoreboard={remoteWorkspace.scoreboard} onSave={saveScorekeeper} lastRefreshed={lastRefreshed} />;
  }
  if (remoteFailure && !remoteWorkspace) return <ConnectionError message={remoteFailure} onRetry={() => void refreshRemote()} />;
  if (!state) return <LoadingScreen />;
  if (displayRequested && !event) return <main className="display-shell"><h1>Tournament unavailable</h1><p>Open the projector view again from the tournament you want to display.</p></main>;
  if (!event) return <FirstEvent onCreate={createEvent} onSignOut={signOutUser} profile={profile} />;
  if (loadedEventId !== event.id) return remoteFailure
    ? <ConnectionError message={remoteFailure} onRetry={() => void refreshRemote(event.id)} />
    : <LoadingScreen message={`Loading ${event.name}…`} />;
  if (displayRequested) return <Display key={event.id + '-' + event.state} state={state} event={event} error={remoteFailure} lastRefreshed={lastRefreshed} />;

  const displayParams = new URLSearchParams({ view: 'display', event: event.id });

  return <main className="app-shell">
    <header className="app-header">
      <a className="product-lockup" href="/" aria-label="Table Tennis Tournament Manager home"><span className="brand-mark" aria-hidden="true">TT</span><span><strong>Table Tennis Tournament Manager</strong><small>{profile.displayName}</small></span></a>
      <nav className="primary-nav" aria-label="Main navigation">{(['Tournament', 'Players', 'Results'] as const).map((item) => <button type="button" key={item} className={section === item ? 'nav-link active' : 'nav-link'} onClick={() => setSection(item)}>{item}</button>)}</nav>
      <div className="header-actions"><span className="shared-badge"><i aria-hidden="true" />SHARED WORKSPACE</span><button className="text-button reset-link" type="button" onClick={() => void signOutUser()}>Sign out</button></div>
    </header>
    {remoteFailure && <p className="inline-status" role="status">Could not refresh the shared event: {remoteFailure}</p>}
    {notice && <p className="inline-status" role="status">{notice}</p>}
    {section === 'Tournament' && <>
      <section className="live-summary" aria-labelledby="live-heading">
        <div className="section-heading"><div><h2 id="live-heading">Live tables</h2><p>{event.name} · table assignments appear when you start a match.</p></div><div className="action-row"><button className="button button-secondary" type="button" onClick={() => downloadWorkspaceSnapshot(state, event.id)}>Export event snapshot</button><a className="button button-secondary" href={'/?' + displayParams.toString()} target="_blank" rel="noopener noreferrer">Open projector view ↗</a><button type="button" className="button button-secondary" onClick={() => setTournamentTab('Matches')}>Manage matches</button></div></div>
        <LiveTables state={state} event={event} />
      </section>
      <TournamentSettings key={event.id + '-' + event.updatedAt} tournaments={state.tournaments} selected={event} onSelect={(id) => { setSelectedEventId(id); void refreshRemote(id); }} onCreate={createEvent} onSave={updateEvent} onCancel={cancelTournament} onFinish={finishTournament} readOnly={false} />
      <nav className="tournament-tabs" aria-label="Tournament sections">{(['Players & payments', 'Matches', 'Groups & bracket'] as const).map((tab) => <button key={tab} type="button" className={tournamentTab === tab ? 'tournament-tab active' : 'tournament-tab'} onClick={() => setTournamentTab(tab)}>{tab}</button>)}</nav>
      {tournamentTab === 'Matches' && <Matches state={state} event={event} onStart={startMatch} onScore={saveScore} onResolve={resolveMatch} onClear={clearResult} />}
      {tournamentTab === 'Players & payments' && <Roster state={state} event={event} entries={entries} players={state.players} onRegister={registerEntry} onCreatePlayer={createPlayerRecord} onUpdateEntry={updateEntry} onPromoteWaitlist={promoteWaitlist} />}
      {tournamentTab === 'Groups & bracket' && <Groups state={state} event={event} onStart={startGroups} onPlayoffs={createPlayoffs} onRecordLots={async (groupIndex, entryIds) => updateEvent(event.id, { lotOrders: { ...event.lotOrders, [String(groupIndex)]: entryIds } })} onResetPlayoffs={resetPlayoffs} />}
    </>}
    {section === 'Players' && <Players players={state.players} onCreate={createPlayer} onUpdate={updatePlayer} onArchive={archivePlayer} />}
    {section === 'Results' && <Results state={state} tournaments={state.tournaments} selectedEventId={event.id} onSelectEvent={(id) => { setSelectedEventId(id); void refreshRemote(id); }} />}
    <footer className="app-footer"><span>Table Tennis Tournament Manager</span><span>Shared event · automatic refresh every five seconds</span></footer>
  </main>;
}

function LoadingScreen({ message = 'Loading tournament desk…' }: { message?: string }) {
  return <main className="app-shell"><div className="loading-panel"><span className="brand-mark">TT</span><p>{message}</p></div></main>;
}

function ConnectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="app-shell"><div className="login-panel"><p className="eyebrow">Shared event unavailable</p><h1>Could not refresh the tournament</h1><p className="setup-copy">{message}</p><button className="button button-primary" type="button" onClick={onRetry}>Try again</button></div></main>;
}

type SignInMode = 'organizer-code' | 'email-password';

function SignInScreen({ onSignIn, error }: { onSignIn: (email: string, password: string, requiredRole?: Role) => Promise<string | null>; error: string | null }) {
  const [mode, setMode] = useState<SignInMode>('organizer-code');
  const [email, setEmail] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(error);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const failure = mode === 'organizer-code'
        ? await onSignIn(ORGANIZER_EMAIL, accessCode, 'admin')
        : await onSignIn(email, password);
      setMessage(failure);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  function switchMode(nextMode: SignInMode) {
    setMode(nextMode);
    setAccessCode('');
    setPassword('');
    setMessage(null);
  }

  return <main className="auth-shell">
    <header className="product-lockup"><span className="brand-mark">TT</span><span><strong>Table Tennis Tournament Manager</strong><small>Shared tournament desk</small></span></header>
    <form className="login-panel" onSubmit={(event) => void submit(event)}>
      <p className="eyebrow">Team account</p>
      <h1>{mode === 'organizer-code' ? 'Organizer access' : 'Sign in'}</h1>
      <p className="setup-copy">{mode === 'organizer-code' ? 'Enter the organizer access code to open the shared tournament desk.' : 'Use the email and password for your organizer or scorekeeper account.'}</p>
      {mode === 'organizer-code' ? <label htmlFor="organizer-access-code"><span>Organizer access code</span><input id="organizer-access-code" aria-label="Organizer access code" name="organizer-access-code" type="password" autoComplete="current-password" required value={accessCode} onChange={(event) => setAccessCode(event.currentTarget.value)} /></label> : <>
        <label htmlFor="account-email"><span>Email</span><input id="account-email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} /></label>
        <label htmlFor="account-password"><span>Password</span><input id="account-password" aria-label="Password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></label>
      </>}
      {message && <p className="field-error" role="alert">{message}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : mode === 'organizer-code' ? 'Continue as organizer' : 'Sign in'}</button>
      <p className="table-note">Accounts are provisioned by the tournament administrator. An organizer or scorekeeper role is required.</p>
      <button className="text-button" type="button" disabled={busy} onClick={() => switchMode(mode === 'organizer-code' ? 'email-password' : 'organizer-code')}>
        {mode === 'organizer-code' ? 'Use email and password for scorekeeper access' : 'Use organizer access code'}
      </button>
    </form>
  </main>;
}

function MissingConfiguration() {
  return <main className="auth-shell"><header className="product-lockup"><span className="brand-mark">TT</span><span><strong>Table Tennis Tournament Manager</strong><small>Shared tournament desk</small></span></header><section className="login-panel"><p className="eyebrow">Setup required</p><h1>Shared workspace unavailable</h1><p className="setup-copy">This app requires a configured Supabase project to load tournaments and save changes.</p><p className="table-note">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in the deployment environment, then reload.</p></section></main>;
}

function FirstEvent({ onCreate, onSignOut, profile }: { onCreate: (input: { name: string; startsAt: string }) => Promise<string | null>; onSignOut: () => void; profile: Profile | null }) {
  const [name, setName] = useState(''); const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)); const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return <main className="auth-shell"><header className="product-lockup"><span className="brand-mark">TT</span><span><strong>Table Tennis Tournament Manager</strong><small>{profile?.displayName ?? 'Organizer'}</small></span><button className="text-button" type="button" onClick={onSignOut}>Sign out</button></header><form className="login-panel" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setMessage(null); try { const error = await onCreate({ name, startsAt: new Date(startsAt).toISOString() }); setMessage(error); } finally { setBusy(false); } }}><p className="eyebrow">First event</p><h1>Create a tournament</h1><p className="setup-copy">Your shared workspace is ready. Add the event you are organizing.</p><label><span>Event name</span><input required value={name} onChange={(event) => setName(event.currentTarget.value)} /></label><label><span>Start time</span><input type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.currentTarget.value)} /></label>{message && <p className="field-error" role="status">{message}</p>}<button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create tournament'}</button></form></main>;
}

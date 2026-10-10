import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Groups } from './pages/Groups';
import { Matches } from './pages/Matches';
import { Players } from './pages/Players';
import { Results } from './pages/Results';
import { Roster } from './pages/Roster';
import { Scorekeeper } from './pages/Scorekeeper';
import { TournamentSettings } from './pages/TournamentSettings';
import {
  archiveDemoPlayer,
  cancelDemoTournament,
  createDemoPlayer,
  createDemoPlayoffs,
  createDemoTournament,
  finishDemoTournament,
  getEntries,
  getTournament,
  loadDemoState,
  promoteDemoWaitlist,
  registerDemoEntry,
  resetDemoState,
  saveDemoScore,
  saveDemoState,
  saveDemoUnplayedResult,
  startDemoGroups,
  startDemoMatch,
  updateDemoEntry,
  updateDemoTournament,
  clearDemoResult,
  type DemoMatch,
  type DemoState,
} from './lib/demo';
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
import type { Entry, GameScore, GroupPlan, MutationResult, Profile, Tournament } from './types';

type Section = 'Tournament' | 'Players' | 'Results';
type TournamentTab = 'Players & payments' | 'Matches' | 'Groups & bracket';
const demoRequested = new URLSearchParams(window.location.search).get('demo') === '1';
const remoteMode = isSupabaseConfigured() && !demoRequested;
const localPhoneView = new URLSearchParams(window.location.search).get('view') === 'scorekeeper';
const SCORE_DRAFT_PREFIX = 'tttm:score-draft:';

function withPlayers(workspace: RemoteWorkspace): RemoteWorkspace {
  const players = new Map(workspace.players.map((player) => [player.id, player]));
  return { ...workspace, entries: workspace.entries.map((entry) => ({ ...entry, player: players.get(entry.playerId) })) };
}

export default function App() {
  const [localState, setLocalState] = useState<DemoState | null>(() => remoteMode ? null : loadDemoState());
  const [remoteWorkspace, setRemoteWorkspace] = useState<RemoteWorkspace | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(remoteMode);
  const [remoteFailure, setRemoteFailure] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [section, setSection] = useState<Section>('Tournament');
  const [tournamentTab, setTournamentTab] = useState<TournamentTab>(localPhoneView ? 'Matches' : 'Players & payments');
  const [notice, setNotice] = useState<string | null>(null);
  const refreshLock = useRef(false);
  const profileId = profile?.id;
  const profileRole = profile?.role;
  const state = remoteMode ? remoteWorkspace : localState;
  const eventId = selectedEventId || state?.tournaments[0]?.id || '';
  const event = state?.tournaments.find((tournament) => tournament.id === eventId) ?? state?.tournaments[0];
  const entries = state && event ? getEntries(state, event.id) : [];

  const refreshRemote = useCallback(async (targetEventId?: string) => {
    if (!remoteMode || refreshLock.current) return;
    refreshLock.current = true;
    try {
      const workspace = await loadRemoteWorkspace(targetEventId || undefined);
      if (!workspace) {
        setProfile(null);
        setRemoteWorkspace(null);
        setRemoteFailure(null);
      } else {
        const normalized = withPlayers(workspace);
        setProfile(normalized.profile);
        setRemoteWorkspace(normalized);
        setRemoteFailure(null);
        if (normalized.scoreboard) setSelectedEventId(normalized.scoreboard.eventId);
        else if (!targetEventId || !normalized.tournaments.some((item) => item.id === targetEventId)) {
          const preferred = normalized.tournaments.find((item) => item.state === 'groups' || item.state === 'playoffs') ?? normalized.tournaments[0];
          if (preferred) setSelectedEventId(preferred.id);
        }
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

  async function mutateLocal<T>(action: (next: DemoState) => MutationResult<T>): Promise<{ error: string | null; value?: T }> {
    if (!localState) return { error: 'Local demo state is unavailable.' };
    const next = structuredClone(localState);
    const result = action(next);
    if (!result.ok) { setNotice(result.message); return { error: result.message }; }
    saveDemoState(next);
    setLocalState(next);
    setNotice(null);
    return { error: null, value: result.value };
  }

  async function createEvent(input: { name: string; startsAt: string }): Promise<string | null> {
    if (remoteMode) {
      const result = await runRemote(remoteActions.createTournament(input), '');
      if (result.value) setSelectedEventId(result.value.id);
      return result.error;
    }
    if (!localState) return 'Demo is not ready.';
    const next = structuredClone(localState);
    const result = createDemoTournament(next, input);
    if (!result.ok) return result.message;
    saveDemoState(next); setLocalState(next); setSelectedEventId(result.value.id); setSection('Tournament'); setTournamentTab('Players & payments');
    return null;
  }

  async function updateEvent(targetId: string, patch: Partial<Tournament>): Promise<string | null> {
    if (remoteMode) return (await runRemote(remoteActions.updateTournament(targetId, patch), targetId)).error;
    return (await mutateLocal((next) => updateDemoTournament(next, targetId, patch))).error;
  }

  async function updateEntry(entryId: string, patch: Partial<Entry>): Promise<string | null> {
    if (remoteMode) {
      const allowed = {
        checkedIn: patch.checkedIn, paid: patch.paid, paymentMethod: patch.paymentMethod,
        amountPaidCents: patch.amountPaidCents, discountCents: patch.discountCents,
        paymentNote: patch.paymentNote, registrationStatus: patch.registrationStatus,
      };
      return (await runRemote(remoteActions.updateEntry(entryId, allowed))).error;
    }
    return (await mutateLocal((next) => updateDemoEntry(next, entryId, patch))).error;
  }

  async function createPlayer(input: { name: string; label?: string | null; experience?: 'unknown' | 'beginner' | 'casual' | 'club' | 'varsity' }): Promise<string | null> {
    if (remoteMode) return (await runRemote(remoteActions.createPlayer(input))).error;
    return (await mutateLocal((next) => createDemoPlayer(next, input))).error;
  }

  async function updatePlayer(playerId: string, patch: { name?: string; label?: string | null; experience?: 'unknown' | 'beginner' | 'casual' | 'club' | 'varsity' }): Promise<string | null> {
    if (remoteMode) return (await runRemote(remoteActions.updatePlayer(playerId, patch))).error;
    return (await mutateLocal((next) => updateDemoPlayer(next, playerId, patch))).error;
  }

  async function archivePlayer(playerId: string): Promise<string | null> {
    if (remoteMode) return (await runRemote(remoteActions.archivePlayer(playerId))).error;
    return (await mutateLocal((next) => archiveDemoPlayer(next, playerId))).error;
  }

  async function registerEntry(playerId: string): Promise<string | null> {
    if (!event) return 'Create an event first.';
    if (remoteMode) return (await runRemote(remoteActions.registerEntry(event.id, playerId))).error;
    return (await mutateLocal((next) => registerDemoEntry(next, event.id, playerId))).error;
  }

  async function promoteWaitlist(): Promise<string | null> {
    if (!event) return 'Create an event first.';
    if (remoteMode) return (await runRemote(remoteActions.promoteWaitlist(event.id))).error;
    return (await mutateLocal((next) => promoteDemoWaitlist(next, event.id))).error;
  }

  async function startGroups(plans: GroupPlan[], seed: number, mode: 'balanced' | 'random'): Promise<string | null> {
    if (!event || !state) return 'Create an event first.';
    if (remoteMode) return (await runRemote(remoteActions.startGroups(event.id, event.revision, plans, seed, mode))).error;
    return (await mutateLocal((next) => startDemoGroups(next, event.id, event.revision, plans, seed, mode))).error;
  }

  async function createPlayoffs(seed: number): Promise<string | null> {
    if (!event || !state) return 'Create an event first.';
    if (remoteMode) return (await runRemote(remoteActions.createPlayoffs(event.id, event.revision, seed))).error;
    return (await mutateLocal((next) => createDemoPlayoffs(next, event.id, event.revision, seed))).error;
  }

  async function startMatch(matchId: string, table: number, version: number): Promise<string | null> {
    if (remoteMode) return (await runRemote(remoteActions.startMatch(matchId, table, version))).error;
    return (await mutateLocal((next) => startDemoMatch(next, matchId, table, version))).error;
  }

  async function saveScore(match: DemoMatch, games: GameScore[], correcting: boolean, expectedVersion: number): Promise<string | null> {
    if (remoteMode) {
      const result = await runRemote(remoteActions.saveScore(match.id, expectedVersion, games));
      if (!result.error) sessionStorage.removeItem(SCORE_DRAFT_PREFIX + match.id + ':' + expectedVersion);
      return result.error;
    }
    const result = await mutateLocal((next) => saveDemoScore(next, match.id, expectedVersion, games, correcting));
    if (!result.error) sessionStorage.removeItem(SCORE_DRAFT_PREFIX + match.id + ':' + expectedVersion);
    return result.error;
  }

  async function resolveMatch(match: DemoMatch, kind: 'walkover' | 'void', winner: string | null, reason: string): Promise<string | null> {
    if (remoteMode) return (await runRemote(remoteActions.resolveMatch(match.id, match.version, kind, winner, reason))).error;
    return (await mutateLocal((next) => saveDemoUnplayedResult(next, match.id, match.version, kind, winner, reason))).error;
  }

  async function clearResult(matchId: string, version: number): Promise<string | null> {
    if (remoteMode) return (await runRemote(remoteActions.clearResult(matchId, version))).error;
    return (await mutateLocal((next) => clearDemoResult(next, matchId, version))).error;
  }

  async function resetPlayoffs(): Promise<string | null> {
    if (!event) return 'Create an event first.';
    if (remoteMode) return (await runRemote(remoteActions.resetPlayoffs(event.id, event.revision))).error;
    return (await mutateLocal((next) => resetLocalPlayoffs(next, event.id))).error;
  }

  async function finishTournament(): Promise<string | null> {
    if (!event) return 'Create an event first.';
    if (remoteMode) return (await runRemote(remoteActions.finishTournament(event.id, event.revision))).error;
    return (await mutateLocal((next) => finishDemoTournament(next, event.id, event.revision))).error;
  }

  async function cancelTournament(): Promise<string | null> {
    if (!event) return 'Create an event first.';
    if (remoteMode) return (await runRemote(remoteActions.cancelTournament(event.id, event.revision))).error;
    return (await mutateLocal((next) => cancelDemoTournament(next, event.id, event.revision))).error;
  }

  async function signOutUser() {
    const result = await signOut();
    if (!result.ok) { setRemoteFailure(result.message); return; }
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(SCORE_DRAFT_PREFIX)) sessionStorage.removeItem(key);
    }
    setProfile(null); setRemoteWorkspace(null); setSelectedEventId(''); setRemoteFailure(null);
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

  async function login(email: string, password: string): Promise<string | null> {
    const result = await signIn(email, password);
    if (!result.ok) return result.message;
    setProfile(result.value);
    setRemoteLoading(true);
    await refreshRemote();
    return null;
  }

  async function resetLocalDemo() {
    const next = resetDemoState(); setLocalState(next); setSection('Tournament'); setTournamentTab('Players & payments');
  }

  if (remoteMode && remoteLoading && !profile) return <LoadingScreen />;
  if (remoteMode && !profile) return <SignInScreen onSignIn={login} error={remoteFailure} />;
  if (remoteMode && profile?.role === 'scorekeeper') {
    if (remoteFailure && !remoteWorkspace?.scoreboard) return <ConnectionError message={remoteFailure} onRetry={() => void refreshRemote()} />;
    if (!remoteWorkspace?.scoreboard) return <LoadingScreen message="Looking for the active event…" />;
    return <Scorekeeper scoreboard={remoteWorkspace.scoreboard} onSave={saveScorekeeper} lastRefreshed={lastRefreshed} />;
  }
  if (remoteMode && remoteFailure && !remoteWorkspace) return <ConnectionError message={remoteFailure} onRetry={() => void refreshRemote()} />;
  if (!state) return <LoadingScreen />;
  if (!event && remoteMode) return <FirstEvent onCreate={createEvent} onSignOut={signOutUser} profile={profile} />;
  if (!event) return <main className="app-shell"><p className="field-error">No event is available.</p><button className="button button-primary" type="button" onClick={() => void resetLocalDemo()}>Reset local demo</button></main>;

  return <main className="app-shell">
    <header className="app-header">
      <a className="product-lockup" href={demoRequested ? '/?demo=1' : '/'} aria-label="Table Tennis Tournament Manager home"><span className="brand-mark" aria-hidden="true">TT</span><span><strong>Table Tennis Tournament Manager</strong><small>{remoteMode ? profile?.displayName : 'Varsity tournament desk'}</small></span></a>
      <nav className="primary-nav" aria-label="Main navigation">{(['Tournament', 'Players', 'Results'] as const).map((item) => <button type="button" key={item} className={section === item ? 'nav-link active' : 'nav-link'} onClick={() => setSection(item)}>{item}</button>)}</nav>
      <div className="header-actions">{remoteMode ? <><span className="shared-badge demo-badge"><i aria-hidden="true" />SUPABASE SHARED</span><button className="text-button reset-link" type="button" onClick={() => void signOutUser()}>Sign out</button></> : <><span className="demo-badge"><i aria-hidden="true" />LOCAL DEMO</span><button className="text-button reset-link" type="button" onClick={() => { if (window.confirm('Reset all local demo changes and restore the sample event?')) void resetLocalDemo(); }}>Reset demo</button></>}</div>
    </header>
    {!remoteMode && <div className="local-demo-note"><strong>PRACTICE DEMO</strong><span>19 new, unrated players. Check them in, record payments, then start groups. Changes stay in this browser.</span>{isSupabaseConfigured() && <a href="/">Shared workspace</a>}{localPhoneView && <a href="/?demo=1" aria-label="Open organizer view">Organizer view</a>}</div>}
    {remoteFailure && <p className="inline-status" role="status">Could not refresh the shared event: {remoteFailure}</p>}
    {notice && <p className="inline-status" role="status">{notice}</p>}
    {section === 'Tournament' && <>
      <TournamentSettings key={event.id + '-' + event.updatedAt} tournaments={state.tournaments} selected={event} onSelect={(id) => { setSelectedEventId(id); if (remoteMode) void refreshRemote(id); }} onCreate={createEvent} onSave={updateEvent} onCancel={cancelTournament} onFinish={finishTournament} readOnly={false} />
      <nav className="tournament-tabs" aria-label="Tournament sections">{(['Players & payments', 'Matches', 'Groups & bracket'] as const).map((tab) => <button key={tab} type="button" className={tournamentTab === tab ? 'tournament-tab active' : 'tournament-tab'} onClick={() => setTournamentTab(tab)}>{tab}</button>)}</nav>
      {tournamentTab === 'Matches' && <Matches state={state} event={event} onStart={startMatch} onScore={saveScore} onResolve={resolveMatch} onClear={clearResult} />}
      {tournamentTab === 'Players & payments' && <Roster state={state} event={event} entries={entries} players={state.players} onRegister={registerEntry} onUpdateEntry={updateEntry} onPromoteWaitlist={promoteWaitlist} />}
      {tournamentTab === 'Groups & bracket' && <Groups state={state} event={event} onStart={startGroups} onPlayoffs={createPlayoffs} onRecordLots={async (groupIndex, entryIds) => updateEvent(event.id, { lotOrders: { ...event.lotOrders, [String(groupIndex)]: entryIds } })} onResetPlayoffs={resetPlayoffs} />}
    </>}
    {section === 'Players' && <Players players={state.players} onCreate={createPlayer} onUpdate={updatePlayer} onArchive={archivePlayer} />}
    {section === 'Results' && <Results state={state} tournaments={state.tournaments} selectedEventId={event.id} remoteWorkspace={remoteMode} onSelectEvent={(id) => { setSelectedEventId(id); if (remoteMode) void refreshRemote(id); }} />}
    <footer className="app-footer"><span>Table Tennis Tournament Manager</span><span>{remoteMode ? 'Shared event · automatic refresh every five seconds' : 'Scores saved locally for this demo'}</span></footer>
  </main>;
}

function resetLocalPlayoffs(state: DemoState, tournamentId: string): MutationResult<{ revision: number }> {
  const tournament = getTournament(state, tournamentId);
  if (!tournament || tournament.state !== 'playoffs') return { ok: false, code: 'blocked', message: 'This event has no active playoff bracket.' };
  const playoffMatches = state.matches.filter((match) => match.eventId === tournamentId && match.stage === 'playoffs');
  if (playoffMatches.some((match) => match.state === 'active')) return { ok: false, code: 'blocked', message: 'Finish or clear active playoff matches before resetting.' };
  state.matches = state.matches.filter((match) => !(match.eventId === tournamentId && match.stage === 'playoffs'));
  for (const entry of state.entries.filter((candidate) => candidate.tournamentId === tournamentId)) entry.seedPosition = null;
  tournament.state = 'groups'; tournament.revision += 1; tournament.updatedAt = new Date().toISOString();
  return { ok: true, value: { revision: tournament.revision } };
}

function updateDemoPlayer(state: DemoState, playerId: string, patch: Partial<Pick<import('./types').Player, 'name' | 'label' | 'experience'>>) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return { ok: false as const, code: 'invalid' as const, message: 'Player not found.' };
  const name = patch.name?.trim();
  if (name === '') return { ok: false as const, code: 'invalid' as const, message: 'Enter a player name.' };
  Object.assign(player, patch, patch.name !== undefined ? { name } : {}, { label: patch.label !== undefined ? patch.label?.trim() || null : player.label, updatedAt: new Date().toISOString() });
  return { ok: true as const, value: player };
}

function LoadingScreen({ message = 'Loading tournament desk…' }: { message?: string }) {
  return <main className="app-shell"><div className="loading-panel"><span className="brand-mark">TT</span><p>{message}</p></div></main>;
}

function ConnectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="app-shell"><div className="login-panel"><p className="eyebrow">Shared event unavailable</p><h1>Could not refresh the tournament</h1><p className="setup-copy">{message}</p><button className="button button-primary" type="button" onClick={onRetry}>Try again</button></div></main>;
}

function SignInScreen({ onSignIn, error }: { onSignIn: (email: string, password: string) => Promise<string | null>; error: string | null }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [message, setMessage] = useState<string | null>(error); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try { setMessage(await onSignIn(email, password)); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell"><header className="product-lockup"><span className="brand-mark">TT</span><span><strong>Table Tennis Tournament Manager</strong><small>Shared tournament desk</small></span></header><form className="login-panel" onSubmit={(event) => void submit(event)}><p className="eyebrow">Team account</p><h1>Sign in</h1><p className="setup-copy">Use the email and password created for your organizer or scorekeeper account.</p><label><span>Email</span><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} /></label><label><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></label>{message && <p className="field-error" role="alert">{message}</p>}<button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button><p className="table-note">Accounts are provisioned by the tournament administrator. Public sign-up is disabled.</p><a className="button button-secondary" href="/?demo=1">Try the 19-player practice demo</a></form></main>;
}

function FirstEvent({ onCreate, onSignOut, profile }: { onCreate: (input: { name: string; startsAt: string }) => Promise<string | null>; onSignOut: () => void; profile: Profile | null }) {
  const [name, setName] = useState(''); const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)); const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return <main className="auth-shell"><header className="product-lockup"><span className="brand-mark">TT</span><span><strong>Table Tennis Tournament Manager</strong><small>{profile?.displayName ?? 'Organizer'}</small></span><button className="text-button" type="button" onClick={onSignOut}>Sign out</button></header><form className="login-panel" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setMessage(null); try { const error = await onCreate({ name, startsAt: new Date(startsAt).toISOString() }); setMessage(error); } finally { setBusy(false); } }}><p className="eyebrow">First event</p><h1>Create a tournament</h1><p className="setup-copy">Your shared workspace is ready. Add the event you are organizing.</p><label><span>Event name</span><input required value={name} onChange={(event) => setName(event.currentTarget.value)} /></label><label><span>Start time</span><input type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.currentTarget.value)} /></label>{message && <p className="field-error" role="status">{message}</p>}<button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create tournament'}</button></form></main>;
}

# Simple Tournament Organizer Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` when implementation is requested. Work task-by-task and use the checkboxes to report actual completion. This document is a plan, not authorization to deploy or buy services.

**Goal:** Build a small shared tournament desk for one organizer and a few phone scorekeepers.

**Architecture:** A React/Vite browser app calls Supabase for login and shared persistence. Pure TypeScript handles draw/standings previews; a small set of database functions validates and atomically saves scores, advances winners and finishes events. There is no custom application server.

**Tech stack:** React, TypeScript, Vite, plain CSS, `@supabase/supabase-js`; Vitest for domain tests. npm with a single committed lockfile. Vercel static hosting and Supabase Postgres/Auth.

**Spec:** [requirements.md](requirements.md). Read [PRODUCT.md](../PRODUCT.md) first. The user's latest simplicity and phone-scoring instructions supersede the initial larger design.

## Global constraints

- Groups → single-elimination championship and optional consolation first; Swiss later.
- One club, singles only, one competitive event active at a time.
- Two roles: admin and scorekeeper. Players do not have accounts.
- Payments are paid checkbox, method, amount and optional discount.
- Use five application tables. No payment processor or financial subsystem.
- No Next.js, custom API server, ORM, Redux, websocket infrastructure or offline synchronization.
- No runtime AI features. AI agents build the application; the application does not call an LLM.
- Preserve the planning files when scaffolding. Do not implement deferred features.
- No claims about timing, permission enforcement or deployment success without checks.

## Review focus

1. Two phones submit different scores for the same match: exactly one accepted result, with a readable conflict for the other. Task 4 owns the database check; Task 5 owns the phone behavior.
2. An authenticated scorekeeper calls APIs directly: cannot read payments, change groups, edit completed results or elevate role. Tasks 1 and 4 own permission checks.
3. A non-power-of-two bracket has unresolved feeders: never confuse them with empty slots and advance someone early. Task 2 owns fixtures for 3/5/6/10/17 entrants.
4. Corrected results have downstream games: block an unsafe winner change; never silently retain the wrong finalist. Task 4 owns the invariant and Task 5 the explanation.
5. A save committed but the phone lost its response: refreshing/retrying cannot create a second result or rating update. Tasks 4–6 own retry/finalization checks.

## File map and ownership

Keep this structure small. Separate a file further only when it becomes hard to read.

```text
src/
  main.tsx
  App.tsx                         # lead: login, role-specific navigation, event selection
  styles.css                      # lead: shared layout/controls; others use agreed classes
  types.ts                        # lead: canonical shared types
  lib/
    supabase.ts                   # lead: one configured client
    api.ts                        # lead/data owner: DB calls, camelCase↔snake_case mapping
    export.ts                     # export owner: CSV/JSON and formula escaping
  components/
    ScoreForm.tsx                 # score UI owner
    MatchList.tsx                 # score UI owner
    Bracket.tsx                   # score UI owner; ordinary HTML/CSS
  pages/
    Login.tsx                     # lead
    TournamentSetup.tsx           # roster UI owner
    Roster.tsx                    # roster UI owner
    Players.tsx                   # roster UI owner
    Matches.tsx                   # score UI owner
    Groups.tsx                    # score UI owner
    Results.tsx                   # finish/export owner
  domain/
    groups.ts                     # engine owner
    roundRobin.ts                 # engine owner
    scores.ts                     # engine owner
    standings.ts                  # engine owner
    bracket.ts                    # engine owner
    elo.ts                        # finish owner
    estimates.ts                  # finish owner
tests/
  fixtures.ts
  groups.test.ts
  scores.test.ts
  standings.test.ts
  bracket.test.ts
  elo.test.ts
  exports.test.ts
supabase/
  migrations/001_schema.sql       # lead/data owner exclusively
  migrations/002_operations.sql   # lead/data owner exclusively
  tests/permissions.sql
  tests/operations.sql
.env.example
docs/operations.md                # finish owner: human operator/deployment instructions
```

Do not have two agents edit `types.ts`, `api.ts`, `App.tsx`, `styles.css`, migrations or the lockfile simultaneously. The lead integrates changes to shared files.

## Shared contracts: settle before parallel work

Use camelCase in TypeScript and snake_case in SQL. UUIDs are strings. Integer cents are the only money representation. Match points are integer pairs. These are the minimum domain contracts; add required persistence fields from the requirements once in `types.ts`, not separate competing definitions in each page.

```ts
export type Id = string;
export type Role = 'admin' | 'scorekeeper';
export type BestOf = 1 | 3 | 5;
export type GameScore = readonly [number, number];
export type Stage = 'setup' | 'groups' | 'playoffs' | 'finished' | 'cancelled';
export type Division = 'championship' | 'consolation';
export type ResultKind = 'played' | 'walkover' | 'bye' | 'void';
export type Experience = 'unknown' | 'beginner' | 'casual' | 'club' | 'varsity';

export interface SeedEntry {
  entryId: Id;
  playerId: Id;
  name: string;
  seedValue: number;
}
export interface GroupPlan {
  groupIndex: number;
  entryIds: Id[];
}
export interface GroupOption {
  sizes: number[];
  matchCount: number;
  minimumGroupMatches: number;
}
export interface GroupResult {
  entryA: Id;
  entryB: Id;
  kind: 'played' | 'walkover' | 'void';
  games: GameScore[];
  winnerId: Id | null;
}
export interface Standing {
  entryId: Id;
  rank: number | null; // null means an unresolved final tie
  played: number;
  walkovers: number;
  wins: number;
  losses: number;
  gameDifference: number;
  pointDifference: number;
}
export type Slot =
  | { kind: 'entry'; entryId: Id }
  | { kind: 'winner'; matchKey: string }
  | { kind: 'empty' };
export interface PlannedMatch {
  key: string; // deterministic within generated plan; mapped to DB UUID when persisted
  round: number;
  sequence: number;
  a: Slot;
  b: Slot;
  bestOf: BestOf;
}
export type ScoreValidation =
  | { ok: true; winner: 'a' | 'b'; winsA: number; winsB: number }
  | { ok: false; message: string };
export type MutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'forbidden' | 'conflict' | 'invalid' | 'blocked' | 'network'; message: string };
export interface ScoreInput {
  matchId: Id;
  expectedVersion: number;
  games: GameScore[];
}
export interface UnplayedResultInput {
  matchId: Id;
  expectedVersion: number;
  kind: 'walkover' | 'void';
  winnerEntryId: Id | null; // required for walkover; null for void
  reason: string;
}
export interface ScoreboardMatch {
  id: Id;
  version: number;
  eventId: Id;
  label: string;
  nameA: string | null;
  nameB: string | null;
  tableNumber: number | null;
  bestOf: BestOf;
  state: 'pending' | 'active' | 'completed' | 'bye' | 'void';
  kind: ResultKind | null;
  games: GameScore[];
  winner: 'a' | 'b' | null;
  ready: boolean;
}
export interface Scoreboard {
  eventId: Id;
  eventName: string;
  stage: Stage;
  revision: number;
  matches: ScoreboardMatch[];
}
```

Domain exports:

```ts
suggestGroups(count: number): GroupOption[]; // recommended option first
generateGroups(entries: SeedEntry[], sizes: number[], mode: 'random' | 'balanced', seed: number): GroupPlan[];
roundRobin(entryIds: Id[]): Array<{ round: number; a: Id; b: Id }>;
validateSeries(bestOf: BestOf, games: GameScore[]): ScoreValidation;
rankGroup(entryIds: Id[], results: GroupResult[], lotOrder?: Id[]): Standing[];
buildBracket(orderedEntryIds: Id[], bestOf: BestOf, finalBestOf: BestOf): PlannedMatch[];
eloPair(ratingA: number, ratingB: number, winner: 'a' | 'b'): { a: number; b: number };
minimumTableMinutes(bestOfs: BestOf[], tables: number): number;
```

For `buildBracket`, the ordered entries are already seeded by finishing tier and saved lot order. Return an empty list for k=0/1; show the sole entrant outside the match engine. Include automatic bye nodes for k≥2, but exclude those nodes when counting contested matches. A fixture with a `winner` slot remains unresolved until its feeder finishes.

The API module exposes small named functions, not a generic repository framework. Required operations: `getScoreboard(eventId)`, `submitScore(input)`, `startMatch(matchId, tableNumber, expectedVersion)`, `clearResult(matchId, expectedVersion)`, `saveGroups(eventId, expectedRevision, plans)`, `savePlayoffs(eventId, expectedRevision, plans)`, `resetPlayoffs(eventId, expectedRevision)`, `finishTournament(eventId, expectedRevision)`. Score/clear/start return `MutationResult<ScoreboardMatch>`; draw/reset/finish return `MutationResult<{ revision: number }>`; get returns `Scoreboard`. Roster/player reads and setup edits can be direct typed Supabase calls wrapped in this module.

Also expose admin-only `resolveUnplayedMatch(input: UnplayedResultInput): Promise<MutationResult<ScoreboardMatch>>`, mapped to `save_score`, and `cancelTournament(eventId, expectedRevision): Promise<MutationResult<{ revision: number }>>`, mapped to `cancel_tournament`.

All write adapters catch network errors and normalize denied/stale/invalid responses. A phone page never imports an admin-only entry/payment query.

## Task 1 — Small foundation, schema and login

**Owner:** lead / GPT 6.1 Sol. **Depends on:** nothing. **Deliverable:** admin and exec can log in with different visible access; no tournament engine yet.

**Files:** scaffold/config, `types.ts`, Supabase client, `App.tsx`, `styles.css`, `Login.tsx`, migration 001, permission tests, `.env.example`.

- [ ] Select current stable compatible React/Vite/TypeScript versions, pin Node and dependencies, and record them in README. Generate a Vite React/TS scaffold in a temporary directory; copy the app files into this folder without overwriting these plans. Do not install Next.js or a UI framework.
- [ ] Add only Supabase JS and Vitest beyond the scaffold. Scripts: `dev`, `build`, `typecheck`, `test`, `lint`. Use `vitest run` for non-watch tests and `tsc --noEmit` through the configured project references for type checking.
- [ ] Create the five tables from the spec, foreign keys, unique event/player registration, legal money checks, stage/version fields and safe role lookup. Include setup-state guards and one-active-event constraint; do not allow direct admin edits to bypass locked draws or rating finalization.
- [ ] Increment event revision when setup entries/settings change so a stale draw cannot omit a newly checked-in entrant. After start, distinguish permitted payment updates/withdrawals from forbidden identity/group/eligibility edits; derived ratings/seeds remain function-only writes.
- [ ] Add RLS and grants: profiles readable by self/admin but never self-promotable; admin-only entry/payments access; no anonymous reads. Raw match/rating writes are denied and reserved for operation functions in Task 4/6.
- [ ] Implement plain login/logout and role-specific navigation. Store only the provider-managed session; do not create custom password storage.
- [ ] Record account bootstrap instructions: create Auth user, add admin/scorekeeper profile, disable public signup. Do not provision paid external resources without the owner selecting them.
- [ ] Check with three identities (admin, scorekeeper, authenticated-without-profile) plus anonymous. Prove that a scorekeeper cannot update `profiles.role` or read `entries` through direct requests.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build`. Commit this independently usable foundation when working in Git.

SQL permission test pattern, using synthetic UUIDs and actual project policies:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
-- Fixture 002 is a scorekeeper. Assert SELECT entries returns no private rows
-- or permission denied, and UPDATE profiles SET role='admin' cannot succeed.
rollback;
```

Put assertions in `supabase/tests/permissions.sql`, covering anon, unprovisioned account, scorekeeper and admin. Run only against synthetic test data. Permission checks must assert denial, not merely rely on hidden UI.

## Task 2 — Tournament rules as small pure functions

**Owner:** GPT 6.1 Sol. **Depends on:** shared contracts from Task 1. **Parallel with:** Task 3. **Deliverable:** tested groups, fixtures, scores, standings and bracket generation.

**Files:** five domain engine files and their tests; may request contract changes from the lead but does not edit UI/database.

- [ ] Create deterministic fixture helpers in `tests/fixtures.ts`: numbered entries with unique entry/player IDs; a fixed pseudorandom seed; a simple group result constructor. Implement helpers before tests use them.
- [ ] Write failing tests for group suggestions and pair generation, then implement the smallest candidate enumeration and snake/random assignment that satisfy the spec.
- [ ] Implement a small seeded shuffle; use it for equal seed values and lot order. Do not add a seeding library or use `Math.random()` during rendering.
- [ ] Write score tests, then implement legal games and series clinch validation. Share score fixtures with the later SQL checks.
- [ ] Implement the explicit house standings rules and unresolved-lot state. Do not introduce Swiss, cross-group strength scoring or an unofficial hidden tiebreak.
- [ ] Implement bracket construction, genuine byes, final best-of override and next-match references. A winner feeder never becomes an empty slot because its player is unknown.
- [ ] Test all field sizes 4–64 for unique group membership and complete pair coverage; test brackets for 0/1/2/3/5/6/10/12/17/32 entrants. For k≥2 assert exactly k−1 non-bye contested fixtures.
- [ ] Run `npm test -- tests/groups.test.ts tests/scores.test.ts tests/standings.test.ts tests/bracket.test.ts`, then typecheck. Report interfaces and fixtures to the lead.

Required concrete unit cases:

```ts
import { expect, test } from 'vitest';
import { suggestGroups } from '../src/domain/groups';
import { roundRobin } from '../src/domain/roundRobin';
import { validateSeries } from '../src/domain/scores';

test('18-player recommendation preserves three group matches', () => {
  expect(suggestGroups(18)[0].sizes).toEqual([5, 5, 4, 4]);
  expect(suggestGroups(18)[0].matchCount).toBe(32);
});
test('four-player group has six unique fixtures', () => {
  const fixtures = roundRobin(['a', 'b', 'c', 'd']);
  expect(fixtures).toHaveLength(6);
  expect(new Set(fixtures.map(m => [m.a, m.b].sort().join(':'))).size).toBe(6);
});
test('deuce must end by two and series must stop when clinched', () => {
  expect(validateSeries(1, [[14, 12]]).ok).toBe(true);
  expect(validateSeries(1, [[11, 10]]).ok).toBe(false);
  expect(validateSeries(1, [[12, 9]]).ok).toBe(false);
  expect(validateSeries(3, [[11, 4], [11, 7], [11, 8]]).ok).toBe(false);
  expect(validateSeries(3, [[11, 4]]).ok).toBe(false);
});
```

## Task 3 — Registration, check-in and simple payments

**Owner:** Luna at max effort. **Depends on:** Task 1. **Parallel with:** Task 2. **Deliverable:** organizer can prepare a real roster and see correct totals.

**Files:** `TournamentSetup.tsx`, `Roster.tsx`, `Players.tsx`. Lead integrates requested additions to `api.ts` and shared CSS.

- [ ] Implement event setup with the exact defaults in the spec. Load saved events; show only applicable settings for the current stage.
- [ ] Implement player search/create/reuse. Display distinguishing labels; warn but permit duplicate names. Archive instead of deleting history.
- [ ] Implement register, check-in, withdraw, capacity/waitlist and waitlist promotion before play. Do not build a public registration form.
- [ ] Implement payment row with paid checkbox, method, actual amount, discount and optional note. Keep money conversion at the form boundary; store cents.
- [ ] Derive totals directly from entry records; never from entrant count. Preserve editor input on errors. Warn before clearing an existing paid record.
- [ ] Show unpaid entrants without automatically excluding them from draw eligibility. The draw's start action confirms unpaid participants separately.
- [ ] Test a $10 entry with $3 discount paid by card at $7; unpaid discounted entry; zero-dollar fully discounted entry; name duplicate; duplicate registration; capacity reached. A $7 cash entry plus $10 card entry totals $17, not $20.
- [ ] Check the roster at laptop width and the player search on a phone, run typecheck/lint, and hand off a concise list of any shared-file changes to the lead.

Money behavior can be tested through a small exported helper, rather than adding a forms framework:

```ts
const baseFeeCents = 1000;
const discountCents = 300;
const amountDueCents = baseFeeCents - discountCents;
expect(amountDueCents).toBe(700);
// For paid=false persist amountPaidCents=0, paymentMethod=null.
// For paid=true and amountPaidCents>0 require cash/card.
```

## Task 4 — Shared database operations and conflict protection

**Owner:** lead / GPT 6.1 Sol. **Depends on:** Tasks 1–2. **Deliverable:** authoritative match operations usable by laptop and phones.

**Files:** migration 002, `api.ts`, operation/permission SQL tests. This owner alone edits SQL while the UI agent works against the shared contracts.

- [ ] Implement `get_scoreboard`: provisioned roles only, only permitted active-event fields for scorekeepers, display names joined internally, no payments/notes returned.
- [ ] Implement admin-only `save_groups` and `save_playoffs` with expected event revision; validate entry references, stage, completeness and one instance of each fixture. Map deterministic plan keys to UUIDs in one transaction. Preserve existing saved data if validation fails.
- [ ] Implement `start_match`: admin-only, ready participants, free table, no active-player conflict, version check. Lock the event row so two table starts cannot race.
- [ ] Implement `save_score`: lock event/match, check membership/role/stage, validate points and series in SQL, check expected version, write result/updater/time, update dependent slot, clear table, increment revisions. Identical replay is a no-op; different stale input returns conflict. Only admin can submit walkovers/voids or correct a completed result.
- [ ] Implement `clear_result` and `reset_playoffs` using the simple guards in the spec. Walk dependent matches to detect started/scored descendants. Clearing an upstream result resets affected unstarted feeder slots, including auto-bye propagation, but does not touch unrelated results.
- [ ] Ensure void and walkover resolution allows group completion; a stage with unreported matches cannot advance. No caller-provided winner can override played game points.
- [ ] Implement admin cancellation: lock event, confirm it is unfinished, release active assignments, mark cancelled and preserve existing records without ratings. Test a double-withdrawal knockout void advances no player and can resolve without fabricating a champion.
- [ ] Test direct API denial of scorekeeper group/payment/role mutations and completed-result changes, including forged function arguments. Test cross-event entry IDs and match IDs.
- [ ] Test two concurrent different saves, identical retry, two assignments using the same player, invalid game scores, a semifinal correction with a scored final, and a group edit after playoffs exist. Run each in transactions on test data.
- [ ] Run database checks plus domain tests. Verify the authenticated request's identity reaches SQL correctly; never introduce a browser service-role key to make tests pass.

Transaction outline to implement per operation, not as a generic framework:

```sql
-- Caller role verified inside the function.
select 1 from public.tournaments where id = target_event for update;
select * from public.matches where id = target_match for update;
-- Validate stage and participants. If already saved identically, return it.
-- If version differs, reject as conflict. Validate points and dependent state.
-- Update result, table assignment, next slot and versions together.
-- Return the saved row. A function exception rolls back all of these writes.
```

## Task 5 — Draw preview, live desk and phone scoring

**Owner:** Luna at max effort; lead reviews integration. **Depends on:** Task 2 and Task 4 contracts. **Deliverable:** groups → playoffs usable from laptop, with score entry on phones.

**Files:** `Groups.tsx`, `Matches.tsx`, `ScoreForm.tsx`, `MatchList.tsx`, `Bracket.tsx`.

- [ ] Build draw preview with group-size options, balanced/random seeding, saved seed, manual swaps and unpaid-player notice. Confirm Start groups using the exact preview revision.
- [ ] Show standings/remaining fixtures; expose a recorded draw-of-lots action only for unresolved ties. Store lots in event settings through the admin adapter with a revision check.
- [ ] Build qualification preview and basic round-column bracket/list. Handle zero/one-player divisions and label byes explicitly. Create playoffs only from resolved eligible standings.
- [ ] Build admin table assignment with three default table slots and a ready list. An exec sees the list and scores, but no management/payment controls.
- [ ] Implement numeric score entry with calculated winner, legal score messages, save feedback and focus movement. Do not require a confirmation modal for routine score saves.
- [ ] Poll the visible event every five seconds; pause when hidden and refresh on focus/save. Keep the editor's initial version and draft separate from refreshed match data. If polling reveals another saved result, explain it and prevent a stale overwrite.
- [ ] Preserve unsent inputs in sessionStorage; clear on saved/logout. Network failure leaves visibly unsaved input. On re-open, compare draft version to current version before offering to resubmit.
- [ ] Explain admin correction blocks using affected match labels. Reset playoffs requires a count-based confirmation and no active playoff match.
- [ ] On two phones and one laptop, verify separate results appear within one polling interval, same-match conflicts are readable, and no phone can see payments. Check keyboard and 390px layouts.

Frontend conflict handling should be this small:

```ts
const result = await submitScore({ matchId, expectedVersion: openedVersion, games });
if (!result.ok) {
  setError(result.message);
  if (result.code === 'conflict') await refreshScoreboard();
  // Keep the unsaved form visible; never silently resubmit with a new version.
  return;
}
clearSavedDraft(matchId);
await refreshScoreboard();
```

The snippet's `setError`, `refreshScoreboard` and `clearSavedDraft` are local component/helper functions to implement in this task, not additional services.

## Task 6 — Ratings, results, exports and release rehearsal

**Owner:** lead / GPT 6.1 Sol for finalization; Luna may own `Results.tsx` and exports in a separate bounded assignment. **Depends on:** Tasks 1–5. **Deliverable:** finished event with durable history and an operator guide.

**Files:** `elo.ts`, `estimates.ts`, `Results.tsx`, `export.ts`, tests, finalization SQL in migration 002 while unreleased (or a new numbered migration once deployed), `docs/operations.md`.

- [ ] Implement/test `eloPair` and deterministic event result ordering. Implement `finish_tournament` in one transaction: validate all matches resolved, lock affected players in consistent ID order, apply only played results, update counts and entry before/after snapshots, mark finished. Repeated finish is a no-op.
- [ ] Keep finished events read-only and explain that limitation. Do not add a rating replay engine or ledger.
- [ ] Show player ratings, provisional badge, event history and winners. Use persisted results; do not infer champions from names or highest ratings.
- [ ] Add the clearly labelled lower-bound time estimate and total fixtures to the draw preview/settings. No “fits” guarantee and no automatic rule changes.
- [ ] Add CSV exports, formula escaping and a small admin-only event JSON export. Add print CSS for fixtures/standings without payments. No PDF dependency.
- [ ] Write the short setup/operator/deployment guide, exact env variable names and commands, five-table schema instructions and account provisioning steps. Clearly distinguish test and production database settings.
- [ ] Run domain tests, SQL permissions/operations tests, typecheck, lint and production build. Do not claim database checks passed if credentials or a test project are unavailable; report the exact unverified checks.
- [ ] Rehearse the 20-player event through 48 fixtures, including six byes per division, a $3 discount, a withdrawal, a tie, a correction and failed network request. Also rehearse 19 entrants and simultaneous phone entry.
- [ ] Check production-like static hosting, login persistence and refresh using a test project. Confirm `dist` contains no secret/service-role key. Deploy to the owner's chosen Vercel project only when requested; no paid services selected automatically.
- [ ] Get one whole-app review focused on permissions, data integrity and operator usability. Fix material findings, then report what was actually verified.

Required rating test:

```ts
import { expect, test } from 'vitest';
import { eloPair } from '../src/domain/elo';
test('equal ratings move by 16 and preserve the total', () => {
  const next = eloPair(1000, 1000, 'a');
  expect(next).toEqual({ a: 1016, b: 984 });
  expect(next.a + next.b).toBe(2000);
});
```

Database finalization check: save one played match plus a walkover fixture in a synthetic event, finalize twice, and assert the players' rated counts and ratings are identical after the second call. The walkover contributes zero rated matches.

## Requirement coverage

| Requirements | Tasks |
|---|---|
| R01 login and roles | 1, 4, 5 |
| R02 directory; R03 settings; R04 attendance; R05 payments | 1, 3 |
| R06 groups; R07 scores/standings; R08 brackets | 2, 4, 5 |
| R09 tables; R10 shared phone scoring; R11 corrections | 4, 5 |
| R12 ratings/history | 6 |
| R13 estimates/exports | 6 |
| R14 laptop/mobile usability | 3, 5, 6 |
| R15 tests/rehearsal | all, with final gate in 6 |

## Completion criteria

The app is ready only when an admin can prepare and complete an event, execs can safely enter scores from phones, results survive reloads, fees/discounts total correctly, ratings apply once, and all required permission/data checks pass. Visual polish is secondary to a dependable event workflow.

Do not expand the build with the deferred list. If implementation reveals a conflict in these documents, the lead resolves it once and updates both the requirement and affected task before agents diverge.

# Simple Tournament App — Requirements

Date: October 9, 2026. Status: proposed build specification, updated for the user's explicit simplicity and phone-scoring requirements. No implementation yet.

## 1. Scope and engineering budget

Build one small app for one team. The organizer runs an event; a few execs help enter results from phones. Players are records, not user accounts.

**Use:** React, TypeScript, Vite, plain CSS, Supabase database/Auth, Vercel. Supabase supplies the shared database and login without a custom application server. Vite provides a static build. Use the Supabase JavaScript client directly, with database permissions and a few SQL functions for operations that must happen together.

**Do not add:** Next.js, an ORM, a custom API server, microservices, Redis, job queues, Redux, a component framework, realtime subscriptions, elaborate audit logs, offline synchronization, Docker as a development requirement, or payment processing. Use React state, normal forms, small functions and periodic refresh. Only add a dependency when it removes more work than it creates.

Alternative considered: SQLite on the laptop with a small web server. It avoids hosted storage but requires the laptop to stay on and every phone to reach it through venue Wi-Fi or a tunnel. Do not implement both architectures. Shared hosted storage is the recommended default for the requested Vercel + phone workflow. No hosting price or free-tier guarantee is assumed.

## 2. Requirements checklist

| ID | First-release requirement |
|---|---|
| R01 | Login with two roles: admin and scorekeeper |
| R02 | Persistent searchable player list, reused between events |
| R03 | Create/select a tournament and edit its settings before play |
| R04 | Add entrants, check in, withdraw and track a simple waitlist |
| R05 | Paid checkbox, cash/card, amount and optional discount |
| R06 | Automatic balanced groups with preview and manual swaps |
| R07 | Round-robin fixtures, score validation, standings and tiebreaks |
| R08 | Championship and optional consolation single-elimination brackets |
| R09 | Simple table assignment and a list of ready matches |
| R10 | Phone score entry, shared refresh and conflicting-save protection |
| R11 | Admin score correction with safeguards for dependent matches |
| R12 | Simple Elo, previous events and player results |
| R13 | Match-count/time warning, CSV export and printable match list |
| R14 | Straightforward laptop/mobile layouts and keyboard access |
| R15 | Core algorithm tests, permission checks and one full rehearsal |

Later, not first release: Swiss, double elimination, doubles/teams, public signup, player accounts, public live results, online payments, CSV import, detailed financial accounting, full offline use and automatic backups/restores inside the app.

## 3. Roles and login

| Action | Admin (organizer) | Scorekeeper (exec) |
|---|---|---|
| View active event, match names, tables and saved results | Yes | Yes |
| Submit an unresolved ready/active match result | Yes | Yes |
| Edit/delete an already saved result | Yes, subject to safeguards | No |
| Register/check in players or view/change payments | Yes | No |
| Change settings, groups, seeding, brackets or table assignments | Yes | No |
| Manage player directory/ratings, finish events, export private data | Yes | No |

Use Supabase email/password login with accounts created manually in the Supabase dashboard. Assign the two roles in a small `profiles` table. Disable public signup. No invitations, role editor or password-management application is required; use the provider's administration tools for the handful of execs. Each exec gets their own account; no shared admin password.

A scorekeeper opens the same web URL on their phone. After login they see the active event's matches and a score form. Roles must be enforced in the database, not only by hiding buttons. An authenticated account without a provisioned profile has no access.

## 4. Main screens

Keep navigation to **Tournament, Players, Results** for admins. Inside the tournament use three tabs: **Players & payments**, **Matches**, **Groups & bracket**. Tournament settings can be a small edit panel. A scorekeeper gets only **Matches**.

- **Players & payments:** searchable rows; add returning/new player; checked-in checkbox; paid checkbox; cash/card select; amount; discount; optional short note; withdrawal/waitlist actions. Totals at the top.
- **Matches:** three table slots, ready matches, completed matches filter, score entry. Do not build a calendar or automatic scheduling optimizer.
- **Groups & bracket:** preview before start; group standings during play; button to create playoffs when groups finish; championship/consolation tabs. A basic round-column bracket plus a plain match list is enough.
- **Players:** names, rating, matches played and event history. Search/select to reuse a player.
- **Results:** past tournaments, champions, final scores and export.
- **Phone scoring:** large player names, table/match label, one pair of numeric inputs per game, computed winner and Save score. Keep ordinary entry to one screen.

Use readable plain styling, native form controls, visible focus, labelled errors and sufficient contrast. Support a 1366×768 laptop and a 390px-wide phone. No animations, charts, branding exercise or marketing landing page is needed. Score status must be written in words as well as color.

## 5. Event settings and lifecycle

Defaults: 20-player registration cap, three numbered tables, CAD $10 fee, 240-minute booking, BO1 groups, BO1 playoffs, BO3 finals, top two per group advance, consolation enabled. Best-of choices are 1/3/5. Games are to 11, win by two. These are proposed defaults; the organizer may set BO3 groups and see the time warning.

Required event fields: name, date/start time, booking minutes, entry fee, registration cap, table count, stage best-of settings and consolation on/off. Store UTC timestamps; display in America/Toronto by default. Currency is CAD for version one.

States: `setup → groups → playoffs → finished`, plus `cancelled` for an unfinished event. One active competitive tournament at a time; future setup events are allowed. This is a small team tool, not a multi-venue platform.

An admin may cancel an unfinished event with confirmation. Stop/release its active matches, preserve recorded results and payments, and apply no ratings. A cancelled event is read-only. Recording payments remains available throughout an unfinished event; locking the draw does not lock payment bookkeeping.

The admin checks attendance, previews the draw, then chooses **Start groups**. After all group results/ties are resolved, **Create playoffs** previews and commits the bracket. Later winners advance automatically. **Finish event** requires no active/unresolved competitive match and applies ratings once.

Before any match starts, regenerate groups freely with confirmation. Once play starts, lock entrants and group scoring rules. Playoff scoring settings may change before playoffs are generated. Do not change a running event's rules automatically to fit the clock.

## 6. Player records, attendance and money

### Player identity

Player UUID, name, optional distinguishing label, optional experience (`unknown`, `beginner`, `casual`, `club`, `varsity`), rating and rated-match count. Do not collect personal contacts unless later requested. Same names are allowed: two Alex Chens can be separate people. Warn about likely duplicates and offer to reuse a record. Do not merge automatically. Archive a player rather than delete referenced history.

### Entry and attendance

One entry per player per tournament. Fields: registered/waitlisted/withdrawn, checked in, and payments. A new walk-in can join before groups start. At capacity, offer the waitlist; an admin may increase capacity after viewing the time warning. After play starts, no insertion into the competitive draw.

Group eligibility is **registered + checked in + not withdrawn**. Unpaid players are flagged in the preview; payment does not silently block participation. Admin confirms any unpaid entrants when starting. This allows collecting a fee later without falsifying paid status.

Mid-event withdrawal retains completed results. Remaining matches become walkovers to available opponents, entered/confirmed by the admin. Both players absent means void. Withdrawn players do not advance into a newly generated bracket. Never remove prior results to make standings look cleaner.

For a knockout match where both players have withdrawn, resolve it as void with no advancing player. Its next slot becomes genuinely empty; the admin resolves the downstream walkover/void. If neither finalist can play, finish with no champion awarded rather than inventing a winner.

### Payment: keep it a small row editor

- `paid`: boolean.
- `payment_method`: `cash | card | null`.
- `amount_paid_cents`: nonnegative integer, default 0; marking paid defaults to the discounted amount due.
- `discount_cents`: nonnegative integer, default 0, no larger than that entry's fee.
- Optional `payment_note`: a short explanation, including a discount reason if helpful.
- Snapshot the base fee on registration; changing the event fee affects new entries only.

Amount due = base fee − discount. Example: $10 fee, $3 discount, card paid $7. An unpaid discounted entry still shows $7 due and $0 collected. A fully discounted entry can be marked paid at $0 with no method. A nonzero paid amount requires cash/card. If a paid amount differs from amount due, show a warning and allow the admin to confirm the actual amount received. This accommodates simple real-world adjustments without a payment workflow.

Unchecking paid confirms clearing method/amount to avoid accidental loss of a record. This is bookkeeping; the app never charges/refunds a card. If money is returned, the admin updates the row and can record a note. Do not build a refund ledger, expenses module or payment audit subsystem.

Summary: checked-in count, paid/unpaid count, cash collected, card collected, total collected, total discounts. Sum actual recorded amounts, not $10 × people. Label this “collected,” not profit.

## 7. Groups and seeding

Support 4–64 entrants algorithmically; warn above 24 because physical capacity is limited. Fewer than four: show a clear message rather than create a broken bracket.

Enumerate balanced partitions with group sizes 3–5 (4/5 entrants may form one group). Recommend the option with the fewest people in three-player groups, then the fewest round-robin fixtures. Show the alternatives and their match counts. This keeps at least three group matches where practical while allowing a faster smaller-group option.

| Players | Suggested sizes | Group fixtures |
|---:|---|---:|
| 11 | 4,4,3 | 15 |
| 12 | 4,4,4 | 18 |
| 16 | 4,4,4,4 | 24 |
| 18 | 5,5,4,4 | 32 |
| 19 | 5,5,5,4 | 36 |
| 20 | 4,4,4,4,4 | 30 |
| 21 | 5,4,4,4,4 | 34 |
| 24 | 4,4,4,4,4,4 | 36 |

Seeding choices: random or balanced. Persist a draw seed so refresh does not change a preview. Balanced ordering uses an event-only admin seed override, otherwise established Elo (five or more rated matches), otherwise experience estimates 800/1000/1200/1400 for beginner/casual/club/varsity; unknown = 1000. Experience estimates do not alter stored Elo. Equal seed values are randomly ordered using the saved seed.

Snake sorted players across group capacity slots, skipping filled groups. Top seeds go into different groups. Admin can swap players before play. Persist the actual assignment and effective seed values; later rating changes do not move players.

Preview shows group sizes, names, unpaid entrants, minimum group matches and total fixtures. A three-player group means only two group matches. Byes never count as playing time. State guarantees conservatively; do not promise everyone four matches if some may get fewer or withdraw.

## 8. Scores and standings

Generate every pair once within each group: n(n−1)/2 fixtures. Use a circle-method round order; virtual byes for odd groups do not become scored matches. No duplicate/self fixtures.

Store actual points for each game, not just “2–1.” In a legal finished game either the winner has 11 and loser at most 9, or winner has at least 12 and leads by exactly two. Reject negatives, decimals, ties, incomplete series and games after the series was clinched. Winner is calculated. BO1/3/5 need 1/2/3 game wins respectively.

Walkover: admin selects winner and supplies a short reason; no invented 11–0 scores. It counts as a standings win/loss, but adds no games/points or Elo. A void match adds none of those. A scorekeeper may submit played results only.

Publish these simple house tiebreaks in the app: match wins; head-to-head when exactly two are tied; otherwise overall group game differential, then overall group point differential; if still tied, a recorded draw of lots. When a criterion reduces a tie to two, use their head-to-head. Group-stage best-of is the same for all groups. Do not resolve ties by name or Elo. An unresolved tie blocks playoff generation until lots are recorded. This is a house rule, not a federation-certification claim.

Standings show actual matches played, walkovers, wins/losses, game differential and point differential. Recompute from saved results; do not maintain a second editable standings table.

## 9. Knockout rounds

Championship: top two non-withdrawn finishers from each group. Consolation, when enabled: everyone else still participating. With withdrawals, advance only eligible finishers and preview any replacements. There is no double-elimination lower bracket in version one.

Seed each division by group finish (all first-place qualifiers before second-place, etc.), with a stored random order within each tier. This avoids pretending raw wins from groups of different sizes are comparable. Highest seeds get byes. Where possible swap within equal finishing tiers to avoid immediate group rematches; do not swap a runner-up above a group winner.

Create the next-power-of-two single-elimination bracket. For 10 entrants use 16 slots and six byes; there are nine contested fixtures. Represent an empty slot differently from “winner of a match not played yet.” Only genuine empty slots produce automatic byes. Standard eight-slot seed order is [1,8,4,5,2,7,3,6]. Recursively expand [1,2] by replacing each s with [s,newSize+1−s] for larger fields.

Zero entrants: no bracket. One: sole entrant, no match/rating. Two: final. Other counts: k−1 contested matches before any walkovers. No third-place match. Show championship and consolation champions separately.

At 20 entrants in 5×4 groups: 30 group matches + 9 championship + 9 consolation = 48 actual scheduled fixtures. Neither six-bye set is included in 48.

## 10. Match desk, phone scoring and corrections

Tables are numbered 1 through the event's configured count. The admin assigns a ready match to a free table; this changes it to active. List unassigned ready matches in round/fixture order. Do not build an optimization engine. A player or table cannot be in two active matches. A result releases the table automatically.

Scorekeepers see all ready/active matches in the active event and select a match by names/table. They can enter a completed series even if the organizer forgot to assign a table. Both participants must be resolved. They cannot change participants, report walkovers, edit previous results or view payments.

Refresh the visible event every five seconds, on window focus and after saving. Pause polling in background tabs. A score form does not lose unsaved inputs when polling refreshes. Show last refresh and Saved/Saving/Failed states. No websockets needed.

Each match has a version number. Saving sends the version the editor opened. In a database transaction, lock the event/match, validate caller/score/version, save result and updater/time, advance any winner, release table, increment version. Two phones saving different results: first succeeds; second sees the saved result and a conflict, never silently overwrites it. Resubmitting an identical already-saved score returns that saved result without a second side effect. No global command log or idempotency service is needed.

Only admins correct saved results. Keep safeguards simple:

- Before playoffs: edit group scores and recompute standings.
- After playoffs are created: group results are locked until admin explicitly resets the entire playoff bracket. Show how many saved playoff results will be cleared. Block reset while a playoff match is active.
- Knockout score correction with the same winner: permit.
- Changed knockout winner: permit only if no dependent match has started/scored. Otherwise explain which dependent matches must be cleared in reverse order first.
- Admin can clear a result only when no dependent match is active/scored. Clear its advancement and free any assignment; preserve unrelated matches.
- Finished events are read-only in version one. No historical rating replay or completed-event reopening UI.

Connection failure: leave typed inputs visible and say unsaved; do not show success. Keep an unsent score draft in sessionStorage keyed by event/match/version, clear on acknowledged save or logout, and revalidate against current data when reopened. No offline result queue. Printed sheets are the fallback; enter results when connectivity returns.

## 11. Simple Elo and history

New players start at 1000. Use K=32 and the standard expected-score formula; one update per played series, no point-margin multiplier. Exclude walkovers, voids, byes and cancelled events. Provisional badge for fewer than five rated matches.

At **Finish event**, apply updates in deterministic persisted fixture order, groups before playoffs; do not use the order that people happened to type scores. Read each player's current rating, update in memory/SQL order, and save all affected players plus event finished status in one database transaction. Repeated Finish calls cannot apply ratings again. Only one competitive event is active at a time.

Formula for A: expected = 1/(1+10^((RB−RA)/400)); delta = 32×(actual−expected); A += delta; B −= delta. Round the common delta to six decimals and store six-decimal ratings; display whole numbers. At equal 1000 ratings the winner becomes 1016 and loser 984.

No rating ledger table, confidence model, seasonal ranking or decay. Match history remains the source of results. Store before/after ratings for each participant on that event's entry so the event summary can show changes. Seeding uses a snapshot fixed when groups start. Finished-event score repairs, if ever needed, are a deliberate maintenance operation outside P0.

## 12. Small database and permission boundary

Five application tables; Supabase manages its own auth tables.

| Table | Contents |
|---|---|
| `profiles` | Auth user ID, display name, role admin/scorekeeper; provisioned manually |
| `players` | Name, optional distinguishing label/experience, rating, rated count, archived flag |
| `tournaments` | Name/date/settings, state, draw seed, resolved lot orders, revision, finalized timestamp |
| `entries` | Event/player IDs, registration/check-in, payment fields, group index, seed snapshot, before/after ratings |
| `matches` | Event/group or division, round/sequence, players as entry IDs, feeder/next-match references, games, best-of, result kind, winner, table/status, version, updated by/at |

Group membership lives on entries; do not create a group-management subsystem. Settings and tie-lot orders may be small validated JSON fields. Results and payments are normal rows. Unique event/player entry; no self matches; nonnegative money; valid event-local references.

Enable RLS. Admin can read/manage ordinary event/entry/player setup records subject to state guards. Scorekeeper sees a safe scoreboard projection via a read-only database function that returns event name, match details and display names, excluding payment/entry notes. Anonymous/non-provisioned users get nothing. Do not grant scorekeepers raw access to entries or player administration.

All match writes and finalization use SQL functions, not unrestricted client updates. Functions check auth role, stage and expected versions; use a safe search path when running with definer privileges and revoke public/anonymous execution. Clients cannot promote their own profile role. A publishable Supabase key can be in Vite; a service-role key must never be in the app.

Use a handful of named operations: `get_scoreboard`, `save_groups`, `save_playoffs`, `start_match`, `save_score`, `clear_result`, `reset_playoffs`, `finish_tournament`. Admin-only draw functions replace fixtures atomically and reject active/scored-state violations. Database stage guards also protect direct setup-table edits from bypassing the UI. Keep SQL readable; no generic command bus.

The admin cancellation operation is `cancel_tournament`. Admin walkover/void reporting uses `save_score` with an explicit result kind, advancing entry (when applicable) and reason; scorekeepers may only send played games. Entry/settings changes that affect a preview increment the event revision, including direct permitted setup edits. After groups start, allow payment updates and withdrawals, but reject changing entry identity, group membership or attendance eligibility through direct row edits. Derived group/seed/rating columns are writable only by their operation functions.

## 13. Timing, export and operations

Show total group/playoff match counts and a simple lower-bound estimate: sum(expected occupied minutes per fixture)/table count. Default assumptions BO1=10, BO3=18, BO5=28 minutes. Reserve 20 minutes for arrival and 20 for finishing/overruns. Label the estimate **minimum table time — actual event takes longer**, because player overlap and late rounds reduce utilization. Warn when even this minimum exceeds the booking; do not label a below-budget result “guaranteed to fit.” Show minimum group matches per entrant separately.

Admin CSV exports: roster/payments and match results. Quote commas/newlines and neutralize formula-like prefixes in user text. A browser print stylesheet for fixtures/standings is sufficient; no PDF generator. Hide payments on printed match sheets. An admin-only event JSON download is useful as a small record export; automatic restore and whole-database backup UI are out of scope.

Deploy Vite's `dist` to Vercel. Keep navigation in query parameters so deep links do not need custom server routing. Use `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; commit only an env example. Pin stable compatible versions and one npm lockfile at kickoff. A separate test database/project is needed for destructive test fixtures; do not point preview/test writes at the live event. No production migrations or paid-service creation is authorized by this planning request.

Write a short operator guide: create accounts once, open event, check in/payments, draw, run matches, resolve corrections, finish, export. Before the real event, test the laptop and two phones on venue connectivity and prepare a printed match sheet.

## 14. Acceptance checklist

- 20 entrants produce 5×4, 30 group matches, 10+10 playoffs, six byes per division, 48 contested fixtures.
- 11/18/19/21/24 and all sizes 4–64 produce valid balanced groups, unique pairs and valid non-power-of-two brackets.
- A returning player retains their UUID/rating; different players may share a name.
- $10 fee minus $3 discount, card paid $7 records $7 collected; unpaid is $0; a free entry can be paid at $0 without a method.
- Valid deuce scores accepted; 11–10, 12–9, incomplete series and extra post-clinch games rejected by both UI and database.
- Head-to-head, three-way ties and recorded lots resolve consistently; unknown ratings do not pretend to be precise.
- Byes never create scored games/Elo; unresolved feeders never become byes; walkovers are admin-only.
- Two phones can submit different matches; simultaneous different scores for one match produce one success and one conflict.
- Scorekeeper cannot access payments or mutate groups/players/finished results through either UI or direct API calls.
- Refresh retains saved state; failed saves retain visibly unsaved input; polling does not reset an open score editor.
- Admin corrects an early result safely; played downstream matches block unsafe winner changes.
- Finish twice leaves ratings unchanged after the first finish; cancelled/unplayed matches never change Elo.
- One real-browser rehearsal covers registration → groups → both brackets → finish, plus a discount, withdrawal, correction and failed connection.

## 15. Sources

These support the small stack, not additional product scope:

- [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Supabase with React](https://supabase.com/docs/guides/getting-started/quickstarts/reactjs)
- [Supabase Auth with React](https://supabase.com/docs/guides/auth/quickstarts/react)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase database functions](https://supabase.com/docs/guides/database/functions)

Original event context: the user's PDF and conversation. Format/rating/tiebreak defaults here are explicit house rules. Swiss is deferred by the user's choice.

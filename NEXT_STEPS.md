# Next steps

Updated 2026-10-10. This is the checklist for the next build session; these changes are **not implemented yet**. Keep the product simple and work in focused commits.

## Current starting point

- The MVP is built, pushed and deployed: [shared workspace](https://table-tennis-tournament-phi.vercel.app/) and [practice demo](https://table-tennis-tournament-phi.vercel.app/?demo=1).
- The practice demo starts with 19 new, unrated players. Existing browser rehearsals persist; do not reset them without being asked.
- Registration, check-in, manual payment records, groups, scoring, knockout advancement, ratings and exports exist.
- The organizer dashboard shows live table assignments, recorded start times and elapsed minutes. Its separate projector window follows scores and switches from groups to brackets.
- Supabase is connected and its two migrations are applied. Organizer/scorekeeper Auth users and matching role profiles still need provisioning before shared team use. Confirm current account status when returning; never request passwords in chat.
- Stack: React, TypeScript, Vite, plain CSS, optional Supabase and Vercel. Reuse it. No new framework, scheduling service or optimizer dependency is needed.

Read this file and the [README](README.md) before the older [requirements](docs/requirements.md) and [implementation plan](docs/implementation-plan.md). The priorities below supersede the old Bo1 defaults and the earlier decision to defer match-order suggestions.

## 1. Refine the UI with Impeccable

- [ ] Apply the **Impeccable** skill to the working product. Improve the existing interface rather than rebuilding it.
- [ ] Make the tournament-day actions obvious: check in, record payment, assign a table, enter a score and call the next players.
- [ ] Review spacing, labels, contrast, status visibility and long player names on laptop and phone screens.
- [ ] Keep live table assignments near the top. Make ready, playing and completed matches easy to distinguish without scrolling through every fixture.
- [ ] Check the projector with realistic names and active matches at the venue’s actual resolution. Keep groups, bracket connections, scores and table numbers readable from across the room.
- [ ] Preserve the simple cash/card payment checkbox, amount and discount flow. Avoid exposing payment details on the display or scorekeeper screens.

Likely files: `src/App.tsx`, `src/styles.css`, `src/pages/Matches.tsx`, `src/pages/Roster.tsx`, `src/pages/Scorekeeper.tsx`, `src/pages/Display.tsx`, `src/components/LiveTables.tsx`.

## 2. Determine the best practical match order

- [ ] Add a small, explainable **recommended next matches** function. The current list sorts by stage, round and sequence; it is not a schedule.
- [ ] Consider only pending fixtures with both entrants resolved and still eligible. Exclude players already playing and tables already occupied.
- [ ] Prefer players who have played fewer matches, rotate fairly across groups, and use waiting time/rest to break ties. Avoid repeatedly calling the same players back immediately.
- [ ] Allocate a batch across the three free tables with no player appearing twice. Recalculate after every saved result, withdrawal or table assignment.
- [ ] Keep the organizer in control: show recommendations and allow an override. Do not automatically mark a suggested match as started.
- [ ] During playoffs, prioritize ready matches that unblock subsequent rounds while keeping reasonable rest. Run championship and consolation alongside each other where practical.
- [ ] Show **playing now** and a clearly labelled **up next / report to the waiting area** list on the desk and projector. Only show a committed call-up as an assignment; a tentative recommendation must not send players to an occupied table.
- [ ] Decide whether a simple saved call-up list is necessary for stable announcements. If added, keep it small and shared; do not add a full calendar or background queue system.
- [ ] Use estimated start windows only if useful. Label them as estimates and update them when matches overrun.

Likely files: a small pure helper in `src/domain/`, `src/pages/Matches.tsx`, `src/components/LiveTables.tsx`, `src/pages/Display.tsx`, and the existing local/shared adapters if a saved call-up list is required.

## 3. Three guaranteed matches; Bo3, then Bo5 semifinals/finals

Confirmed target for the next build: approximately 20 entrants, three tables, **150 minutes of playing time**, at least **three played matches per participant**, regular matches **best of three games**, and semifinals/finals **best of five games**. A match is a series, not an individual game. Retain games to 11, win by two.

- [ ] Use Bo3 for groups and regular knockout rounds, and Bo5 for the final two knockout rounds. For planning, assume this applies to championship and consolation; revisit that assumption if the organizer wants different consolation rules.
- [ ] Prefer reusing the existing final best-of setting for both semifinals and finals, with a clear UI label, instead of adding another database field unnecessarily. Update the local and shared bracket builders consistently.
- [ ] Apply new defaults to new events only. Do not rewrite results or saved best-of values in existing tournaments.
- [ ] Guarantee three **actually played** matches for entrants who remain available. Byes, walkovers and voids do not count. Explain that withdrawals/no-shows can break the guarantee and flag affected entrants.
- [ ] Choose group sizes and any additional placement/consolation games together. Four-player groups give everyone three group matches. Three-player groups give only two, so their entrants need a real additional match; a bye is insufficient.
- [ ] Recalculate the guarantee and time warning for the actual checked-in count, especially 18, 19, 20 and 21 players. Do not silently retain the 20-player estimate when turnout changes.

Likely files: `src/domain/groups.ts`, `src/domain/bracket.ts`, `src/domain/estimates.ts`, `src/lib/demo.ts`, `src/lib/remote.ts`, `src/pages/Groups.tsx`, `src/pages/TournamentSettings.tsx`, and relevant validation in `supabase/migrations/002_operations.sql`. Any database change must be a **new migration**, not an edit to an already applied migration.

### Can this fit comfortably into 2.5 hours?

**Do not promise that yet.** With full championship and consolation brackets, the workload is substantial. The following alternatives are candidates to assess, not the current recommended draw:

| Entrants | Candidate groups | Group matches | Played knockout matches, both divisions | Total played matches |
| --- | --- | ---: | ---: | ---: |
| 19 | 4 / 4 / 4 / 4 / 3 | 27 | 17 | 44 |
| 20 | 4 / 4 / 4 / 4 / 4 | 30 | 18 | 48 |

These counts assume top two per group advance to championship, everyone else enters consolation, and nobody withdraws. Knockout byes are excluded. The three-player group in the 19-player option relies on an eventual played knockout match to reach three; check this explicitly. Unequal group sizes also create qualification tradeoffs to explain before choosing a draw.

Both options contain six Bo5 matches if semifinals and finals in both divisions use Bo5. The remaining 38 or 42 matches use Bo3.

For an **illustrative fast scenario**, assume eight minutes per Bo3, twelve per Bo5, plus one minute per match for changeover:

- 19 players: `(38 × 8 + 6 × 12 + 44 × 1) / 3 ≈ 140 minutes`.
- 20 players: `(42 × 8 + 6 × 12 + 48 × 1) / 3 = 152 minutes`.

These are workload lower bounds, **not measured typical match lengths or runnable timetables**. They assume all three tables stay busy. Player conflicts, late-round dependencies, rest, missing players and overruns add time. Even this fast scenario leaves little room for 19 players and exceeds the budget for 20, so full consolation should not yet be described as a comfortable 150-minute format.

- [ ] Measure several actual Bo3/Bo5 matches and changeovers with players similar to the expected field. Record ordinary and slower durations.
- [ ] Simulate the proposed match-order rule with three tables, actual bracket dependencies, reasonable rest and a stated overrun buffer (for example, 20–30 minutes within the 150-minute budget).
- [ ] Compare full consolation with fewer placement games that still preserve the three-match guarantee. For 20 players in four-player groups, the guarantee is already met before playoffs; removing full consolation would reduce the total to 39 played matches. For 19 players with a three-player group, explicitly schedule any needed third matches rather than dropping consolation and leaving someone with two.
- [ ] If the realistic schedule does not fit, present the tradeoff clearly: fewer entrants, less consolation, more playing time, or shorter series only with the organizer’s agreement. Do not silently weaken the confirmed Bo3/Bo5 rules.
- [ ] Show stage-specific duration assumptions, minimum guaranteed played matches, changeover allowance and a realistic time warning in the draw preview. Keep the existing lower-bound estimate labelled honestly.

Check-in/setup outside the playing window should not be subtracted twice. Rest, changeovers and match dependencies inside that window still consume it.

## How to resume

1. Confirm current Git state and pending account setup. Preserve other contributors’ edits and existing demo records.
2. Refine the UI, implement match-order recommendations, then implement the format/guarantee and timing changes in separate focused branches or commits.
3. Use a separate synthetic rehearsal for changes; do not experiment on live tournament records.
4. Run build/lint and the relevant existing checks. Add focused tests for player conflicts, rest/order rules, Bo5 semifinals, byes and the three-match guarantee; avoid broad new test infrastructure.
5. Rehearse the complete 19-player flow with laptop, phone scoring and projector windows. Report measured/simulated timing separately from a physical venue test.
6. Open a PR, attach it to the task, merge after required checks, and verify the Vercel deployment. Keep credentials and real payment records out of the public repository.

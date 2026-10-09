# AI Agent Handoff

This file coordinates future implementation. No agents have been dispatched and no application code has been written as part of the planning request.

## Read first

1. `PRODUCT.md`
2. `docs/requirements.md`
3. `docs/implementation-plan.md`

The latest user instruction is to keep the software and engineering simple, support exec phone score entry, and use a paid checkbox/method/amount/discount. That instruction takes precedence over earlier ideas for a larger organizer platform.

## Recommended team

| Role | Suggested model | Work |
|---|---|---|
| Lead/integrator | GPT 6.1 Sol | Shared contracts, schema, permissions, atomic operations, ratings, final integration |
| Tournament engine | GPT 6.1 Sol | Groups, fixtures, score rules, standings and non-power-of-two brackets |
| UI worker | Available Luna model at max reasoning | Roster/payments, then phone score forms and bracket presentation |

The user mentioned Sol and “Luna Max.” At execution, use the actual available model identifier for Luna with max reasoning; do not invent a model name. Suggested available mapping in this session is `gpt-6.1-sol` and `gpt-6-luna` with `max` for the latter. Recheck availability before spawning.

Use no more than two implementation workers alongside the lead. More concurrent agents would compete over a small application. Each worker gets a bounded task and file ownership; avoid giving every agent the entire build.

## Execution order

```text
Lead: Task 1, shared contracts and schema
                  |
          +-------+-------+
          |               |
Sol: Task 2 engine   Luna: Task 3 roster/payments
          |               |
          +-------+-------+
                  |
Lead/Sol: Task 4 database operations
                  |
Luna: Task 5 draw/desk/phone UI
                  |
Lead: Task 6 ratings/integration/rehearsal
      (bounded Results/export UI may go to Luna)
                  |
One whole-app review and fixes
```

Task 5 can develop against agreed adapters while Task 4 finishes, but mocked success is not proof of working shared scoring. Integrate real permissions and concurrency before calling it done.

## Ownership rules

- Lead owns `types.ts`, `api.ts`, app routing, shared CSS, migrations and dependency files.
- Engine worker owns `src/domain/` files assigned to Task 2 and corresponding tests.
- UI worker owns only the assigned pages/components; propose shared changes to the lead.
- Do not have two agents modify a migration, lockfile or shared interface simultaneously.
- Use a suitable branch/worktree per concurrent worker, or strictly disjoint files if the execution environment shares a checkout. The repository is RallyDesk (`rally-desk`); use the existing Git history rather than reinitializing it.
- No agent adds a new dependency, table, role or feature without first explaining why existing pieces cannot cover it. The lead can resolve ordinary implementation choices without another user approval loop.
- Never provision accounts, transmit email, purchase hosting, or deploy production just because a task discusses those actions.
- Report files changed, behavior implemented, commands/tests actually run and remaining limitations. Do not report intentions as completed work.

## Ready-to-use worker prompts

### Tournament engine

> Implement Task 2 from docs/implementation-plan.md. Read PRODUCT.md and docs/requirements.md first. Own only the assigned pure domain files and tests. Use the shared types from src/types.ts; request interface changes from the lead. Implement groups, unique round-robin fixtures, legal BO1/3/5 scores, the published house tiebreaks and single-elimination brackets for arbitrary field sizes. Test real byes versus unresolved feeders. Do not build Swiss, UI, storage or a scheduling optimizer. Return tested exports, files changed and test evidence.

### Roster and payments

> Implement Task 3 from docs/implementation-plan.md. Read the requirements and shared types first. Own TournamentSetup.tsx, Roster.tsx and Players.tsx. Keep ordinary controls and plain CSS. Payment is paid checkbox, cash/card, actual amount and discount; no processor or refund subsystem. Reuse player IDs, permit distinct people with the same name, show check-in separately from payment, and lock entrant additions/group changes after setup while allowing payment updates and withdrawals during the event. Coordinate API/shared CSS changes through the lead. Return behavior, files and checks.

### Phone scoring and brackets

> Implement Task 5 from docs/implementation-plan.md using the real adapters from Task 4. Own Groups.tsx, Matches.tsx, ScoreForm.tsx, MatchList.tsx and Bracket.tsx. Scorekeepers only view matches and submit unresolved played results. Keep an open score draft stable while polling. Show stale-result conflicts and failed saves clearly. Handle byes, unknown feeder names and admin correction blocks. Test laptop and phone layouts. Do not add websockets, full offline sync, payment views for execs or new tournament formats.

### Whole-app reviewer

> Review this implementation against docs/requirements.md and docs/implementation-plan.md. Focus on private payment access, direct API permissions, concurrent phone saves, invalid series scores, non-power-of-two byes, downstream correction safety, discounts/totals and double-applied Elo. Run available meaningful checks and distinguish tested evidence from inspection. Report actionable issues with severity and file references. Do not expand scope or request a redesign of a working simple interface.

## Deliberately omitted

Do not add public player registration, multi-club tenancy, a component design system, a custom backend, an ORM, financial accounting, complex audit/event sourcing, Elo uncertainty models, automated timetable optimization, or broad plugin infrastructure. These are not prerequisites for running the user's tournament.

The final handoff to the user should explain how to log in, register/check in, mark payment, start groups, input scores from phones, generate playoffs, finish and export. It should also identify any external setup or verification that remains incomplete.

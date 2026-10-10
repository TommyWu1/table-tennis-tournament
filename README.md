# Table Tennis Tournament Manager

A small web app for running table tennis tournaments at clubs and university teams. Manage the event from a laptop and let scorekeepers enter results from their phones.

## Run it

Use Node 24.19 (the version in `.nvmrc`), then:

```sh
npm ci
npm run dev
```

Open the address Vite prints. Without Supabase settings, the app starts in **Local demo** with sample players. Changes persist in that browser on your laptop; they do not sync to other devices. Export event JSON or CSV to keep a separate copy of your records.

## What it does

- Player directory, registration, check-in, waitlist and withdrawals.
- Manual payment records: paid, cash/card, amount received, discount and note.
- Random or balanced groups that adapt to the checked-in player count.
- Round-robin fixtures, standings and championship/consolation knockout brackets.
- Table assignment, game-score entry, winner advancement and result corrections.
- Simple Elo ratings applied when the organizer finishes an event.
- Results, CSV/JSON exports and printable match sheets.

The default setup is 20 players, three tables, a four-hour booking and a $10 CAD entry fee. Match counts and time estimates help plan the event; actual duration depends on match length and changeovers.

## Share scores with phones

Follow [Supabase setup](supabase/README.md), create organizer and scorekeeper accounts, and copy `.env.example` to `.env.local` with your project URL and publishable key. Admins manage events and payments; scorekeepers see the active scoreboard and enter played results.

For Vercel, use the Vite preset (`npm run build`, output `dist`) and add the same two environment variables. Shared login and device syncing require a configured Supabase project; the included local database smoke checks use a test-only Auth shim.

## Development

React, TypeScript, Vite and plain CSS. Supabase provides the optional shared database and authentication. There is no payment processor.

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

See [requirements](docs/requirements.md), the [build plan](docs/implementation-plan.md), and [contribution guide](CONTRIBUTING.md). Swiss tournaments and online registration are later additions.

For bugs, feature ideas, or questions about using this at your club, [open an issue](https://github.com/TommyWu1/table-tennis-tournament/issues) or contact [Tommy Wu](https://github.com/TommyWu1).

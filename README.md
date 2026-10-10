# Table Tennis Tournament Manager

A small web app for running table tennis tournaments at clubs and university teams. Manage the event from a laptop and let scorekeepers enter results from their phones.

[Try the 19-player practice tournament](https://table-tennis-tournament-phi.vercel.app/?demo=1). Start with check-in and payments, then generate groups and enter scores. Each browser keeps its own practice data; **Reset demo** starts again.

## Run it

Use Node 24.19 (the version in `.nvmrc`), then:

```sh
npm ci
npm run dev
```

Open the address Vite prints. Without Supabase settings, the app starts in a practice demo with **19 new, unrated players**. Nothing has started: check players in, record payments, preview groups, then enter scores yourself. Changes persist in that browser; they do not sync to other devices. Export JSON or CSV to keep a separate copy of your records.

The practice demo is also available at `/?demo=1` when shared login is configured. It never writes to the shared database. **Reset demo** restores the 19-player starting roster whenever you want another rehearsal.

## What it does

- Player directory, registration, check-in, waitlist and withdrawals.
- Manual payment records: paid, cash/card, amount received, discount and note.
- Random or balanced groups that adapt to the checked-in player count.
- Round-robin fixtures, standings and championship/consolation knockout brackets.
- Table assignment, game-score entry, winner advancement and result corrections.
- Live table summary with player names, recorded start times and elapsed minutes.
- Read-only projector window: live tables, rotating group standings and knockout brackets.
- Simple Elo ratings applied when the organizer finishes an event.
- Results, CSV/JSON exports and printable match sheets.

The default setup is 20 players, three tables, a four-hour booking and a $10 CAD entry fee. Match counts and time estimates help plan the event; actual duration depends on match length and changeovers.

## Share scores with phones

Follow [Supabase setup](supabase/README.md), create organizer and scorekeeper accounts, and copy `.env.example` to `.env.local` with your project URL and publishable key. Admins manage events and payments; scorekeepers see the active scoreboard and enter played results.

The [live shared workspace](https://table-tennis-tournament-phi.vercel.app/) is connected to Supabase. Its migrations and public connection settings are configured. Each team account still needs an Auth user and a matching role profile before it can sign in. The practice demo remains separate from shared records.

For Vercel, use the Vite preset (`npm run build`, output `dist`) and add the same two environment variables. Shared login and device syncing require a configured Supabase project; the included local database smoke checks use a test-only Auth shim.

The app is deployed as `table-tennis-tournament` on Vercel, with this repository connected and `main` selected as the production branch. To redeploy manually from an authenticated, linked checkout, run `vercel deploy --prod`.

## Use a projector while keeping your laptop free

From the tournament dashboard, click **Open projector view**. Move that tab into its own Chrome window and drag the window onto the projector. Use the display’s **Toggle fullscreen** button if desired. Keep the organizer window on your laptop for check-in, table assignments and scores.

On a Mac, connect the projector, then open **System Settings → Displays**, select the projector, and choose **Extended display** under **Use as**. Keep the MacBook as your main display. [Apple’s extended-display instructions](https://support.apple.com/en-gb/guide/mac-help/mchlb5f905a1/mac) explain the display setup. Keep the laptop plugged in and awake during the event.

The projector stays on the event you opened, even if you select another event on the desk. It shows live table assignments above group standings, then switches to the championship/consolation brackets when playoffs start. Large groups and bracket sections rotate every 20 seconds; pause rotation or use the arrows to hold a screen. Names, results, byes and advancing winners are visible; payment records and editing controls are omitted.

In practice mode, both windows must use the same browser profile and site address: updates follow browser storage immediately. In shared mode, open the display from a browser signed in as an organizer; it refreshes from Supabase every five seconds while visible, including scores entered by phone scorekeepers. This is an organizer’s read-only display, not an anonymous public scoreboard link. A connection warning identifies a stale shared view while the app reconnects.

A match’s start time is when the organizer clicks **Start match**, not a promised scheduled time. Elapsed minutes update automatically; saving a result clears its table. Entering a result without starting the match does not create a start-time record.

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

# Table Tennis Tournament Manager

A small web app for running table tennis tournaments at clubs and university teams. Manage the event from a laptop and let scorekeepers enter results from their phones.

[Open the tournament workspace](https://table-tennis-tournament-phi.vercel.app/).

## Run it

Use Node 24.19 (the version in `.nvmrc`), then:

```sh
npm ci
npm run dev
```

Configure Supabase as described below and open the address Vite prints. Organizer and scorekeeper sign-ins use the configured database.

## What it does

- Player directory, roster import from a list of names, registration, check-in, waitlist and withdrawals.
- Manual payment records: paid, cash/card, amount received, discount and note.
- Random or balanced groups that adapt to the checked-in player count.
- Round-robin fixtures, standings and championship/consolation knockout brackets.
- Table assignment, game-score entry, winner advancement and result corrections.
- Live table summary with player names, recorded start times and elapsed minutes.
- Read-only projector window: live tables, rotating group standings and knockout brackets.
- Simple Elo ratings applied when the organizer finishes an event.
- Results, CSV/JSON exports and printable match sheets. Organizers can download an event snapshot during play.

New tournaments start with a 25-player cap, three tables, a four-hour booking and a $10 CAD entry fee. Existing event settings can be edited before groups start. Check in everyone who arrives before generating groups. The preview and saved draw use only checked-in, registered players.

## Share scores with phones

Follow [Supabase setup](supabase/README.md), create organizer and scorekeeper accounts, and copy `.env.example` to `.env.local` with your project URL and publishable key. Admins manage events and payments; scorekeepers see the active scoreboard and enter played results.

The deployed app uses Supabase. Each team account needs an Auth user and a matching role profile before it can sign in. If the project pauses, resume it in the Supabase Dashboard and verify organizer login and a score save from a second device before relying on the service.

For Vercel, use the Vite preset (`npm run build`, output `dist`) and add the same two environment variables. Shared login and device syncing require a configured Supabase project; the included local database smoke checks use a test-only Auth shim.

The app is deployed as `table-tennis-tournament` on Vercel, with this repository connected and `main` selected as the production branch. To redeploy manually from an authenticated, linked checkout, run `vercel deploy --prod`.

## Use a projector while keeping your laptop free

From the tournament dashboard, click **Open projector view**. Move that tab into its own Chrome window and drag the window onto the projector. Use the display’s **Toggle fullscreen** button if desired. Keep the organizer window on your laptop for check-in, table assignments and scores.

On a Mac, connect the projector, then open **System Settings → Displays**, select the projector, and choose **Extended display** under **Use as**. Keep the MacBook as your main display. [Apple’s extended-display instructions](https://support.apple.com/en-gb/guide/mac-help/mchlb5f905a1/mac) explain the display setup. Keep the laptop plugged in and awake during the event.

The projector stays on the event you opened, even if you select another event on the desk. It shows live table assignments above group standings, then switches to the championship/consolation brackets when playoffs start. Large groups and bracket sections rotate every 20 seconds; pause rotation or use the arrows to hold a screen. Names, results, byes and advancing winners are visible; payment records and editing controls are omitted.

Open the display from a browser signed in as an organizer. It refreshes from Supabase every five seconds while visible, including scores entered by phone scorekeepers. A connection warning identifies a stale shared view while the app reconnects.

A match’s start time is when the organizer clicks **Start match**, not a promised scheduled time. Elapsed minutes update automatically; saving a result clears its table. Entering a result without starting the match does not create a start-time record.

## Development

React, TypeScript, Vite and plain CSS. Supabase provides the shared database and authentication.

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Start with [next steps](NEXT_STEPS.md) when returning to the project. See also [requirements](docs/requirements.md), the [build plan](docs/implementation-plan.md), and [contribution guide](CONTRIBUTING.md). Swiss tournaments and online registration are later additions.

For bugs, feature ideas, or questions about using this at your club, [open an issue](https://github.com/TommyWu1/table-tennis-tournament/issues) or contact [Tommy Wu](https://github.com/TommyWu1).

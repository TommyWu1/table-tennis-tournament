# RallyDesk

A simple tournament desk for table tennis clubs.

RallyDesk started as a varsity table tennis side project: three tables, around twenty players, a few hours in the venue, and a fundraiser to run. The goal is to keep the tournament organized while spending less time managing it.

An organizer runs the desk from a laptop, and teammates enter match scores from their phones.

> **In development.** This repository currently contains the product requirements and build plan. The application and a hosted demo are not available yet.

## What we're building

- **Players and check-in:** register entrants, reuse returning players, and track who's arrived.
- **Simple payment tracking:** mark paid, choose cash or card, and record the amount and any discount.
- **Groups and standings:** generate balanced groups, record scores, and determine who advances.
- **Knockout brackets:** championship and optional consolation brackets, with automatic winner advancement.
- **Shared score entry:** organizers manage the event; scorekeepers log in on their phones to submit results.
- **Player history:** save past results and use a simple Elo rating to help seed future tournaments.

The first release focuses on singles tournaments with groups followed by single elimination. It's designed around small club events with limited tables and changing turnout. Swiss is a possible later addition.

## Built to stay simple

React, TypeScript and Vite for the app; plain CSS for the interface; Supabase for shared storage and login; Vercel for hosting.

Payments are recorded manually after collection. Players don't need accounts. The aim is a practical tool a small team can maintain.

## Interested in using it?

I'd like to hear from other table tennis clubs and tournament organizers. [Open an issue](https://github.com/TommyWu1/rally-desk/issues/new) with a little about your event, how many players and tables you have, and what you'd need from RallyDesk.

Created by [Tommy Wu](https://github.com/TommyWu1).

## Development

Start with the [product brief](PRODUCT.md) and [requirements](docs/requirements.md). The [implementation plan](docs/implementation-plan.md) breaks the build into six tasks, and the [agent handoff](docs/agent-handoff.md) defines ownership for parallel work.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the collaboration workflow. Setup and run commands will be added when the application is scaffolded.

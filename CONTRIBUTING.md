# Working on Table Tennis Tournament Manager

Table Tennis Tournament Manager is a small team project. Keep changes focused on making tournament day easier.

## Before starting

Read the [requirements](docs/requirements.md) and [implementation plan](docs/implementation-plan.md). Pick a task and agree on file ownership with anyone working in parallel. The [agent handoff](docs/agent-handoff.md) covers shared files and dependencies.

The first release is groups → knockout, with simple payment records and phone score entry. Discuss new formats, dependencies or broader features in an issue before adding them.

## Workflow

1. Clone the repository and create a branch for your change.
2. Implement one focused task. Keep credentials and real player/payment data out of commits; use synthetic data for examples and tests.
3. Run the relevant checks available in the project. Once scaffolded, these include domain tests, type checking, linting and the production build; permission changes also need database checks.
4. Open a pull request describing the change, how you checked it, and any remaining limitations.

Do not mark a plan checkbox complete until the behavior is implemented and checked. Update the relevant documentation if the agreed behavior changes.

The app is implemented. Use the setup commands in the [README](README.md), and read [NEXT_STEPS.md](NEXT_STEPS.md) for current build priorities.

## Questions or interest in using Table Tennis Tournament Manager

[Open an issue](https://github.com/TommyWu1/table-tennis-tournament/issues/new). A brief description of your tournament or the problem you ran into is enough to start.

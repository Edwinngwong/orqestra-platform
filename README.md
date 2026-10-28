# Orqestra Platform

Control plane for the independent Orqestra AI SDLC MVP.

## First vertical slice

`GitHub/Jira work item -> intake approval -> coding agent -> isolated tests -> PR approval -> draft PR`

The current scaffold implements the orchestration state machine, durable local run and audit storage, verified GitHub webhook primitives, and ports for external services. It intentionally cannot merge a PR. Human approvals are explicit, audited domain transitions rather than UI-only checks.

## Run

```sh
npm install
npm test
npm run typecheck
npm run dev
```

Set `GITHUB_WEBHOOK_SECRET` before starting. GitHub issue webhooks are accepted at `POST /webhooks/github`; valid newly opened issues create runs in `awaiting_intake_approval`. Local data defaults to `.data/runs.json` and can be moved with `ORQESTRA_DATA_PATH`.

## Next milestones

1. Replace the local JSON store with Postgres using the `RunStore` contract.
2. Add the HTTP webhook endpoint and a GitHub App adapter.
3. Connect the sandbox API using short-lived, run-scoped credentials.
4. Add Jira intake behind the same `WorkItem` contract.
5. Add an operator UI for approvals, logs, diffs, and cancellation.

See [the implementation plan](docs/IMPLEMENTATION_PLAN.md) and [security baseline](docs/SECURITY.md) before extending the scaffold. Copy `.env.example` to `.env` for local development; never commit the resulting file.

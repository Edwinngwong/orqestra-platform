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

For PostgreSQL development, run `docker compose up -d`, set `DATABASE_URL` from `.env.example`, and run `npm run db:migrate`. When `DATABASE_URL` is absent, the service uses the local JSON store.

Operator endpoints require `Authorization: Bearer $OPERATOR_TOKEN` and support reading a run or its audit history plus `approve-intake`, `execute`, and `approve-pr` actions under `/v1/runs/:id`.

Intake approval enqueues an `execute_run` job. PostgreSQL workers lease jobs using `FOR UPDATE SKIP LOCKED`, renew leases with heartbeats, retry failures with bounded exponential backoff, and recover expired leases. Cancellation marks both the run and any pending or leased job as cancelled.

Run the API with `npm run dev` and the durable worker separately with `npm run worker`. The worker exchanges a GitHub App JWT for a short-lived installation token, reads a bounded repository snapshot, asks the configured OpenAI Responses API model for schema-constrained file replacements, creates a GitHub branch and commit through the Git Data API, and submits that immutable commit to the sandbox. Only a signed passing sandbox result moves the run to PR approval.

The model response is bounded to 20 files and 1 MB, rejects absolute/traversal paths, and cannot directly execute commands. Repository text is explicitly treated as untrusted prompt content. See `.env.example` for required runtime configuration.

For a live acceptance run, follow [the live setup checklist](docs/LIVE_SETUP.md). `scripts/bootstrap-local.sh` generates all non-provider secrets into an ignored, mode-0600 `.env.local` file.

## Next milestones

1. Replace the local JSON store with Postgres using the `RunStore` contract.
2. Add the HTTP webhook endpoint and a GitHub App adapter.
3. Connect the sandbox API using short-lived, run-scoped credentials.
4. Add Jira intake behind the same `WorkItem` contract.
5. Add an operator UI for approvals, logs, diffs, and cancellation.

See [the implementation plan](docs/IMPLEMENTATION_PLAN.md) and [security baseline](docs/SECURITY.md) before extending the scaffold. Copy `.env.example` to `.env` for local development; never commit the resulting file.

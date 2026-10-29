# Orqestra Platform

Control plane for the independent Orqestra AI SDLC MVP.

## First vertical slice

`GitHub/Jira work item -> intake approval -> coding agent -> isolated tests -> PR approval -> draft PR`

The current MVP implements the orchestration state machine, durable PostgreSQL run and audit storage, verified GitHub webhooks, workspace/project onboarding, repository-specific execution policies, GitHub App repository discovery, and a human approval dashboard. It intentionally cannot merge a PR. Human approvals are explicit, audited domain transitions rather than UI-only checks.

## Run

For the complete local stack, including PostgreSQL, both workers, the sandbox,
Cloudflare Tunnel, and automatic GitHub webhook configuration:

```sh
./scripts/local-up.sh
./scripts/local-status.sh
./scripts/local-down.sh
```

`local-up.sh` uses `.env.local`, keeps runtime state and logs under the ignored
`.local/` directory, and refuses to start if required credentials are missing.
The tunnel URL is temporary, but the GitHub App is updated automatically on
every start. Keep the startup terminal open; pressing Ctrl+C, or running
`local-down.sh` from another terminal, stops the processes and PostgreSQL
container while preserving database data.

For individual development commands:

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

## Workspaces and projects

The operator dashboard at `http://127.0.0.1:8786/` lists delivery runs and their audit history. A workspace represents a company or team. A project binds one GitHub repository and installation to a policy containing its test command, timeout, change-size limits, and protected paths.

Only repositories explicitly registered as projects can create runs. The dashboard discovers repositories already authorized through the GitHub App, so operators never enter installation tokens or private keys. The local operator token is a single-administrator development mechanism; customer authentication and workspace-scoped authorization are required before external production use.

## Next milestones

1. Add user authentication and workspace-scoped roles.
2. Add an inline diff viewer and cost/usage accounting.
3. Add Jira intake behind the same `WorkItem` contract.
4. Replace the local executor with one ephemeral cloud task per run for production.

See [the implementation plan](docs/IMPLEMENTATION_PLAN.md) and [security baseline](docs/SECURITY.md) before extending the scaffold. Copy `.env.example` to `.env` for local development; never commit the resulting file.

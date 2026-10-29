# Orqestra Platform

Control plane for the independent Orqestra AI SDLC MVP.

Before contributing, read [`AGENTS.md`](AGENTS.md). It is the authoritative
project-state and engineering guide, and every milestone commit must update it.

## First vertical slice

`GitHub/Jira work item -> intake approval -> coding agent -> isolated tests -> PR approval -> draft PR`

The current MVP implements the orchestration state machine, durable PostgreSQL run and audit storage, verified GitHub webhooks, workspace/project onboarding, repository-specific execution policies, GitHub App repository discovery, and a human approval dashboard. It intentionally cannot merge a PR. Human approvals are explicit, audited domain transitions rather than UI-only checks.

## Muse intake and tracker routing

Muse is the channel-independent intake layer. Requests from the web dashboard—and
later WhatsApp, Slack, Teams, email, GitHub, or Jira adapters—become canonical
proposals. A reviewer must confirm a proposal before Muse creates the project's
configured tracker item and an Orqestra run awaiting the existing intake
approval. Ordinary channel messages never execute work directly.

Each project selects `github_issue`, `jira_issue`, or `orqestra_only` during
onboarding. GitHub issues use the project's GitHub App installation. Jira stores
only the project key; API credentials remain in the runtime environment through
`JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`. Tracker choice and code host
are independent, so a Jira ticket can drive changes in a GitHub repository.

The dashboard includes a Muse proposal and confirmation panel. External channel
adapters should call the same authenticated work-item API and preserve a unique
source reference for replay protection.

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

Only repositories explicitly registered as projects can create runs. The dashboard discovers repositories already authorized through the GitHub App, so operators never enter installation tokens or private keys.

## Authentication and roles

Dashboard users sign in with an email and password. Passwords are salted and hashed with scrypt. Successful login creates a 12-hour opaque HttpOnly, SameSite=Strict session and a separate CSRF token for state-changing requests. Temporary passwords must be changed before workspace data can be accessed.

Workspace roles are enforced by the API:

- `owner`: manage members, including other owners; configure projects; review and approve runs.
- `admin`: manage non-owner members and projects; review and approve runs.
- `reviewer`: inspect, approve, retry, and cancel runs.
- `viewer`: read projects, runs, audit trails, and PR links.

After migrations, bootstrap the first local owner with `npm run auth:bootstrap -- owner@example.com`. The command returns a one-time password. The `OPERATOR_TOKEN` remains a local emergency/bootstrap credential and is not used by the normal dashboard.

## Next milestones

1. Add an inline diff viewer and cost/usage accounting.
2. Add Jira intake behind the same `WorkItem` contract.
3. Replace the local executor with one ephemeral cloud task per run for production.
4. Add OIDC/SSO and email-based invitations before broad customer rollout.

See [the implementation plan](docs/IMPLEMENTATION_PLAN.md) and [security baseline](docs/SECURITY.md) before extending the scaffold. Copy `.env.example` to `.env` for local development; never commit the resulting file.

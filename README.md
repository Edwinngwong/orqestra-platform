# Orqestra Platform

Control plane for the independent Orqestra AI SDLC MVP.

Before contributing, read [`AGENTS.md`](AGENTS.md). It is the authoritative
project-state and engineering guide, and every milestone commit must update it.

## Website and client dashboard

- **Public site:** `/` — responsive Orqestra landing page explaining both onboarding paths.
- **Client sign-in and dashboard:** `/app` — invited users see their accessible projects, status timeline, approval queues, delivery runs and audit trails.
- **Operator compatibility:** `/operator` and legacy `/?muse=<proposalId>` load the authenticated application.

This is an **invite-only pilot**, not public self-service registration. Workspace owners add members through the admin panel. User identity and workspace roles are verified by the server for each API call.

### Workspace-specific GitHub authorization

To support customers who already have GitHub repositories, Orqestra now links GitHub App installations to authorized workspaces rather than offering global installation discovery to customers.

1. Configure the GitHub App's OAuth callback URL as `<ORQESTRA_PUBLIC_URL>/v1/github/oauth/callback`. Set `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, and `ORQESTRA_PUBLIC_URL` from the same app.
2. Ask a workspace owner/admin to sign in to `/app`. The owner installs the Orqestra GitHub App on selected repositories and obtains its numeric installation ID from GitHub's settings page.
3. In **Connect an existing project**, they enter the installation ID and select **Authorize GitHub**.
4. GitHub redirects the user back via a short-lived, single-use, session-bound OAuth state. The platform checks user installation access, the configured GitHub App ID and individual repository admin permissions before saving workspace grants.
5. Repository selection then lists **only** repositories within the verified installation, checked against the saved grant and current App installation access.

An installation can belong to only one Orqestra workspace; credentials and user access tokens are never stored in project records or the browser. Existing connected projects must be migrated before a GitHub connection may be removed.

**Requirements before real customer testing:** public HTTPS origin, matching GitHub App OAuth callback, valid GitHub App ID/private key/client ID/client secret, PostgreSQL migrations through `011_workspace_github_connections.sql`, and an authenticated user. The connection flow is not live-tested against an external installation in this PR. See [onboarding architecture](docs/ONBOARDING_ARCHITECTURE.md) for production security gaps and approvals.

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

### WhatsApp development adapter

The optional WhatsApp adapter receives Meta Cloud API callbacks at
`/webhooks/whatsapp`. It verifies Meta's challenge and every payload signature,
durably deduplicates message IDs, and ignores all conversation unless a text
message begins with `@muse`. A bound sender is mapped to one Orqestra user,
workspace, and default project. Muse either asks one clarification question or
creates a proposal and returns its review link; it never confirms or executes
work from WhatsApp.

Proposal creation is idempotent per WhatsApp message and project, so a failed
outbound confirmation can be retried without creating duplicate work.

Meta publication documents are maintained in `docs/`: the public privacy policy,
terms of service, data-deletion instructions, and app icon can be hosted using
GitHub Pages from the `main` branch's `/docs` folder.

Run `./scripts/configure-whatsapp-local.sh` to enter Meta's Phone Number ID, App
Secret, and replacement access token without echoing secrets. The script creates
a separate random webhook verification token in the ignored mode-0600
`.env.local`. Restart the complete local stack afterward. Local startup injects
the current Cloudflare tunnel URL before the platform starts, so proposal links
use the same public origin. Production must use a permanent HTTPS URL and a
managed system-user token rather than Meta's temporary development token.

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

## Dual-mode customer onboarding (0.11.0)

Orqestra now offers two entry points in the operator dashboard. Both operate under
the existing workspace authorization and project boundary:

1. **Connect an existing project** — select a GitHub repository already authorized
   through the Orqestra GitHub App. Provide its project policy, tracker, and test
   command. This is the existing connected-project workflow and can be used for
   supervised issue-to-draft-PR delivery.
2. **Start a new project** — submit a name and meaningful project goal, select
   either customer-owned accounts or a request for Orqestra-managed operations,
   and optionally specify a monthly budget in USD. The request is stored with
   status `pending_review` and the authenticated submitter identity. It cannot
   provision GitHub repositories, infrastructure, databases, or launch an AI run.

New-project requests are accessible through:

- `GET /v1/new-project-intakes` — returns only visible workspaces.
- `GET /v1/new-project-intakes?workspaceId=<id>` — requires workspace viewer access.
- `POST /v1/new-project-intakes` — requires workspace admin/owner access and
  CSRF validation for session users. Body: `workspaceId`, `name`, `goal`,
  `ownershipMode` (`customer_owned` or `orqestra_managed`), and optional
  `monthlyBudgetUsd` (positive integer).

Once an admin has connected an approved GitHub repository to the workspace, the
**Continue setup** action can activate the original new-project request via
`POST /v1/new-project-intakes/:id/activate`. Activation creates the executable
project registration and marks the intake `activated` in one transaction. It
cannot be repeated; it does not create the repository or provision infrastructure.

A new-project request is not a contract, a quote, a billable task, or permission
to incur cloud costs. A separate approval, customer authorization, and managed
provisioning workflow will be built before automated setup is supported. Do not
enter secrets, credentials, or sensitive personal data into the project-goal field.

Run `npm run db:migrate` after upgrading to apply
`010_new_project_intakes.sql`, `011_workspace_github_connections.sql`, and
`012_new_project_activation.sql` without deleting existing projects or runs.

For the complete onboarding trust model and rollout requirements, read
[`docs/ONBOARDING_ARCHITECTURE.md`](docs/ONBOARDING_ARCHITECTURE.md). GitHub App discovery now requires a workspace-verified connection. Production
rate limiting, account verification, revocation handling, and live OAuth testing
remain necessary before general-availability customer onboarding.

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

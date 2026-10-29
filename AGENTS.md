# Orqestra Platform agent guide

This file is the authoritative starting point for humans and AI coding agents working in this repository. Read it before changing code. Instructions apply recursively unless a deeper `AGENTS.md` explicitly narrows them.

## Product and clean-room boundary

Orqestra is an independent, human-governed AI software-delivery product. It accepts work from GitHub issues (and later Jira), requires explicit human approval, creates bounded code changes, runs tests in an isolated execution plane, requires a second human approval, and opens a draft pull request. It never merges automatically.

Do not use, request, reproduce, translate, or derive from any employer-proprietary source code, architecture, documentation, prompts, customer data, credentials, or internal product knowledge. Implement from public documentation, first principles, and code already committed to the Orqestra repositories.

## Current milestone

- Milestone: Muse core and customer-selectable tracker routing
- Platform version: 0.6.0
- Latest migration: 006_muse_tracker_routing.sql
- Compatible sandbox version: 0.2.x
- Milestone status: complete and live-tested locally

Current capabilities:

- Signed GitHub issue webhooks with delivery replay protection.
- Explicit workspace and project onboarding.
- GitHub App repository discovery using short-lived installation tokens.
- Durable PostgreSQL runs, audit events, jobs, leases, retries, and cancellation.
- One bounded OpenAI coding agent that creates a branch and commit through GitHub APIs.
- Project policies for test commands, runtime, changed-file/byte limits, and protected paths.
- Signed sandbox results before a run can reach PR approval.
- Two durable human approval gates; draft PR creation only; no merge capability.
- Email/password users with salted scrypt hashes, forced temporary-password replacement, opaque HttpOnly sessions, CSRF protection, and workspace roles.
- Owner, admin, reviewer, and viewer authorization enforced by the API.
- Local operator dashboard for onboarding, runs, audits, approvals, retries, cancellation, members, and PR links.
- Channel-independent Muse proposals with explicit reviewer confirmation and durable provenance.
- Per-project routing to GitHub Issues, Jira, or Orqestra-only tracking while keeping the code host independent.
- Dashboard support for tracker selection, Muse proposal review, confirmation, and external ticket links.
- One-command local start/status/stop with automatic Cloudflare quick-tunnel webhook updates.

Known gaps before broad production use:

- OIDC/SSO, verified email invitations, account recovery, login rate limiting, and mandatory HTTPS.
- Inline diff review, usage metering, budgets, and customer billing.
- Signed WhatsApp, Slack, Teams, and email channel adapters; Muse currently accepts authenticated dashboard/API intake.
- Jira OAuth/installation management; the current Jira adapter uses runtime-held service credentials.
- Azure DevOps/GitLab code-host integrations.
- Cloud-native ephemeral execution; the current Docker executor is local-development only.
- Production deployment, observability, backups, disaster recovery, retention, and incident controls.

## Repository responsibility

This repository is the control plane. It owns:

- HTTP webhook and authenticated operator APIs.
- Workspace, project, identity, role, run, audit, and job persistence.
- Orchestration state transitions and human approval enforcement.
- GitHub App authentication, repository discovery, branches, commits, and draft PRs.
- OpenAI Responses API integration and deterministic output validation.
- Submission of immutable commits to the sandbox and verification of signed results.
- The local operator dashboard and local lifecycle scripts.

It does not execute untrusted repository commands. That belongs to `orqestra-sandbox`.

## Architecture map

- `src/server.ts`: HTTP routing, authentication boundary, authorization, webhook intake.
- `src/orchestrator.ts`: run state machine and approval invariants.
- `src/auth.ts`: password hashing, sessions, CSRF, and workspace roles.
- `src/projects.ts`: workspace/project registry.
- `src/muse.ts`: canonical proposal persistence, confirmation, tracker routing, and run creation.
- `src/adapters/trackers.ts`: GitHub Issue, Jira, and Orqestra-only tracker adapters.
- `src/postgres-store.ts`: durable run and audit persistence.
- `src/queue/`: durable background jobs and worker leases.
- `src/adapters/github.ts`: GitHub App tokens, discovery, and draft PRs.
- `src/adapters/openai-github-agent.ts`: bounded coding-agent integration.
- `src/adapters/sandbox.ts`: sandbox admission, polling, and signature verification.
- `src/ui/operator.ts`: local operator UI.
- `migrations/`: ordered, forward-only PostgreSQL migrations.
- `scripts/local-*.sh`: complete local lifecycle.

## Non-negotiable invariants

- Never weaken or bypass either human approval gate.
- Never add automatic merge behavior.
- Treat issue text, repository files, model output, logs, and external API responses as untrusted.
- Never expose private keys, API keys, webhook secrets, installation tokens, session tokens, CSRF tokens, passwords, or repository tokens to prompts, browser responses, logs, commits, or test fixtures.
- Use GitHub App installation tokens, never personal access tokens, for repository operations.
- Validate model output deterministically after generation; prompt instructions alone are not controls.
- Preserve protected-path, file-count, byte-count, timeout, and command-policy enforcement.
- Only signed passing sandbox results may reach `awaiting_pr_approval`.
- Enforce workspace authorization on the server, not only by hiding UI controls.
- Use constant-time comparisons for secrets where applicable.
- Migrations are forward-only and must preserve existing data. Add a new numbered migration; do not rewrite an applied migration to change live state.
- Keep `.env.local`, `.local/`, keys, tokens, and generated runtime data untracked.

## Development and validation

Requirements: Node.js 20+, Docker, PostgreSQL via `compose.yaml`, and `cloudflared` for live webhooks.

```sh
npm install
npm run typecheck
npm test
```

Run every PostgreSQL integration test:

```sh
set -a; source .env.local; set +a
TEST_DATABASE_URL="$DATABASE_URL" npm test
```

Run the complete local product:

```sh
./scripts/local-up.sh
./scripts/local-status.sh
./scripts/local-down.sh
```

Before committing:

- Run platform typecheck and all tests with PostgreSQL.
- Run sandbox typecheck and tests when a cross-repository contract changes.
- Run `git diff --check` and inspect the diff for secrets.
- Apply migrations to a preserved database and verify existing runs/audits remain accessible.
- For workflow changes, prove issue -> intake approval -> branch -> isolated tests -> PR approval -> draft PR.

## Cross-repository contract

The platform submits a run ID, repository, immutable commit SHA, allow-listed command, bounded timeout, and optional run-scoped repository token to the sandbox. The sandbox returns lifecycle state plus a signed completion payload. A request being accepted is never evidence that tests passed.

When changing this contract, update both repositories in the same milestone, add compatibility tests on both sides, state the required compatible versions in both `AGENTS.md` files, and push both repositories.

## Milestone update protocol

Every milestone commit must update this file in the same commit:

1. Update `Current milestone`, `Platform version`, `Latest migration`, compatibility, and status.
2. Move newly completed functionality into `Current capabilities`.
3. Remove resolved gaps and add newly discovered production gaps.
4. Update architecture paths, commands, invariants, and cross-repository contracts when changed.
5. Update README and security/live-setup docs where user behavior changed.
6. Add or update tests that prove the milestone, including failure and authorization paths.

`test/agent-guidance.test.ts` enforces the declared package version and latest migration. Do not disable that test. A milestone is not complete while this guide is stale.

## Definition of done

A change is done only when implementation, negative-path tests, typecheck, migrations, documentation, security review, and relevant live acceptance all pass; both Git repositories are clean and pushed; and this guide accurately describes the resulting system.

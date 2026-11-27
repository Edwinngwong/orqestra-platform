# Orqestra Platform agent guide

This file is the authoritative starting point for humans and AI coding agents working in this repository. Read it before changing code. Instructions apply recursively unless a deeper `AGENTS.md` explicitly narrows them.

## Product and clean-room boundary

Orqestra is an independent, human-governed AI software-delivery product. Muse accepts proposals from authenticated web and signed messaging channels, optionally synchronizes them to GitHub Issues or Jira, and hands confirmed work to Orqestra. Orqestra requires explicit human approval, creates bounded code changes, runs tests in an isolated execution plane, requires a second human approval, and opens a draft pull request. It never merges automatically.

Do not use, request, reproduce, translate, or derive from any employer-proprietary source code, architecture, documentation, prompts, customer data, credentials, or internal product knowledge. Implement from public documentation, first principles, and code already committed to the Orqestra repositories.

## Current milestone

- Milestone: Public client site, workflow portal, verified GitHub onboarding
- Platform version: 0.10.0
- Latest migration: 011_workspace_github_connections.sql
- Compatible sandbox version: 0.2.x
- Milestone status: implemented; latest CI and live GitHub OAuth acceptance pending

Current capabilities:

- Signed GitHub issue webhooks with delivery replay protection.
- Explicit workspace and project onboarding, including a customer-facing choice between connecting an existing GitHub repository and requesting a new project from scratch.
- GitHub App repository discovery using short-lived installation tokens.
- Durable PostgreSQL runs, audit events, jobs, leases, retries, and cancellation.
- One bounded OpenAI coding agent that creates a branch and commit through GitHub APIs.
- Project policies for test commands, runtime, changed-file/byte limits, and protected paths.
- Signed sandbox results before a run can reach PR approval.
- Two durable human approval gates; draft PR creation only; no merge capability.
- Email/password users with salted scrypt hashes, forced temporary-password replacement, opaque HttpOnly sessions, CSRF protection, and workspace roles.
- Owner, admin, reviewer, and viewer authorization enforced by the API.
- Public marketing page at `/`, authenticated client workflow dashboard at `/app`, plus `/operator` and Muse deep-link compatibility.
- Workspace-filtered project cards, approval counts, stage-by-stage workflow history, and explicit new/existing project onboarding.
- GitHub user-to-server OAuth proof, one-time session-bound state, GitHub-admin repository grants, workspace-only installation discovery, and guarded disconnects.
- Local operator dashboard for onboarding, runs, audits, approvals, retries, cancellation, members, and PR links.
- Durable new-project intake requests scoped to workspaces, with customer-owned or Orqestra-managed hosting preference and optional monthly budget. New-project intake does not create repositories, cloud resources, or executable work until separately designed and approved.
- Channel-independent Muse proposals with explicit reviewer confirmation and durable provenance.
- Per-project routing to GitHub Issues, Jira, or Orqestra-only tracking while keeping the code host independent.
- Dashboard support for tracker selection, Muse proposal review, confirmation, and external ticket links.
- Meta webhook verification and constant-time `X-Hub-Signature-256` validation.
- Durable, replay-protected WhatsApp inbox with bounded retries, restart recovery, and idempotent proposal creation when outbound delivery is retried.
- Explicit `@muse` intake only, deterministic model-output validation, clarification replies, and proposal links.
- Revocable phone-to-user/workspace/project bindings that stop working when membership is removed.
- Outbound WhatsApp Cloud API replies and dashboard binding controls with masked phone numbers.
- Live Meta validation completed for WABA app subscription, authorized inbound `@muse` delivery, proposal creation, and outbound proposal notification.
- Configurable direct-message trigger prefixes and durable, retryable WhatsApp notifications for work start, passing tests, draft PR readiness, merged completion, and failures.
- Public privacy, terms, and data-deletion pages for Meta app publication, with a project-owned app icon.
- One-command local start/status/stop with automatic Cloudflare quick-tunnel webhook updates.
- Direct WhatsApp proposal-review URLs load the operator console correctly when the `muse` query parameter is present; regression-tested after a persistent local restart.
- Confirmed Muse proposals create `muse`-sourced delivery runs on upgraded databases and safely resume after tracker or persistence failures without duplicating the external issue.

Known gaps before broad production use:

- OIDC/SSO, verified email invitations, account recovery, login rate limiting, and mandatory HTTPS.
- Inline diff review, usage metering, budgets, and customer billing.
- Slack, Teams, and email channel adapters.
- Production WhatsApp system-user token lifecycle, business verification, permanent HTTPS hosting, rate limits, retention controls, and operational alerting.
- Live GitHub user-to-server OAuth callbacks and installation permission-change handling must be verified before hosted customer onboarding.
- Pre-0.10 projects must be reconciled with verified GitHub connections before new repository assignments.
- Jira OAuth/installation management; the current Jira adapter uses runtime-held service credentials.
- Azure DevOps/GitLab code-host integrations.
- Cloud-native ephemeral execution; the current Docker executor is local-development only.
- Automated repository creation, infrastructure provisioning, and new-project approval conversion after the new-project intake is reviewed.
- Production deployment, observability, backups, disaster recovery, retention, and incident controls.

## Repository responsibility

This repository is the control plane. It owns:

- HTTP webhook and authenticated operator APIs.
- Workspace, project, new-project intake, identity, role, run, audit, and job persistence.
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
- `src/projects.ts`: workspace/project registry and durable new-project intake requests.
- `src/github-connections.ts`: OAuth challenge verification and workspace-to-installation grants.
- `src/ui/landing.ts`: public product page and client portal navigation.
- `docs/ONBOARDING_ARCHITECTURE.md`: dual-mode onboarding boundaries, trust model, and production readiness.
- `src/muse.ts`: canonical proposal persistence, confirmation, tracker routing, and run creation.
- `src/adapters/trackers.ts`: GitHub Issue, Jira, and Orqestra-only tracker adapters.
- `src/whatsapp.ts`: signed webhook intake, durable message queue, authorization bindings, and Muse processing.
- `src/adapters/openai-muse.ts`: bounded natural-language proposal interpretation.
- `src/adapters/whatsapp.ts`: outbound WhatsApp Cloud API messages.
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
- Never expose global GitHub App installations in customer sessions; filter repository selection by OAuth-verified workspace grants.
- OAuth authorization states expire quickly, are session-bound and single-use. Never store GitHub user access tokens.
- Never treat a new-project intake as authorization to create resources, spend money, execute code, or trigger a deployment.
- Ignore ordinary WhatsApp conversation; only explicit `@muse` messages enter the durable inbox.
- Never process a WhatsApp sender without an active binding and current workspace membership.
- A WhatsApp message may create only a proposal; it cannot confirm, approve intake, approve a PR, or merge.
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
- For dual-mode onboarding, test tenant isolation, role enforcement, request validation, and that new-project intake creates no executable project.
- For GitHub connections, test bad state, replay, wrong user/session, insufficient repository admin rights, and cross-tenant installation conflicts.

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

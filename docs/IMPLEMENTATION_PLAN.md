# Orqestra MVP implementation plan

## Product slice

A maintainer labels or assigns a GitHub issue to Orqestra. The platform verifies the webhook, normalizes it to a work item, and waits for an operator to approve scope. A coding agent works only in an ephemeral sandbox with a run-scoped repository credential. Tests run in the same isolated environment. The platform presents the diff, logs, and test evidence for a second approval, then opens a draft PR. Orqestra never merges.

## Repository responsibilities

- `orqestra-platform`: integrations, workflow state, approvals, audit history, agent coordination, operator API/UI, and draft PR creation.
- `orqestra-sandbox`: ephemeral job provisioning, resource and network policy, command execution, artifact signing, log redaction, and teardown.

## Milestones

### M1 — control-plane API

- Replace JSON persistence with Postgres migrations and a `RunStore` adapter.
- Add authenticated run, audit, approval, cancellation, and retry endpoints.
- Add idempotency using GitHub delivery IDs and unique source-item constraints.
- Move execution from request handlers to a durable queue worker.
- Acceptance: process restarts and duplicate webhooks cannot lose or duplicate a run.

### M2 — GitHub App

- Use installation tokens instead of personal tokens.
- Fetch repository policy, create a run branch, push the agent commit, and open a draft PR.
- Report status checks and link immutable logs/test artifacts.
- Acceptance: a test repository can complete the entire flow without broad organization permissions.

### M3 — isolated execution

- Implement a provider-neutral worker interface, starting with one ephemeral-container/VM provider.
- Enforce no host mounts, read-only base image, non-root user, resource limits, default-deny egress, per-run secrets, and guaranteed teardown.
- Sign result manifests containing commit SHA, command, image digest, exit code, and artifact hashes.
- Acceptance: adversarial fixtures cannot reach host files, metadata endpoints, or another run.

### M4 — coding agent and operator experience

- Add repository discovery, plan generation, constrained edits, test repair loop, and cancellation.
- Build an operator UI for scope approval, live logs, diff/test review, and draft-PR approval.
- Acceptance: a maintainer can understand and stop every material action.

### M5 — Jira and hardening

- Add Jira intake through the existing `WorkItem` model.
- Add organization policy, quotas, retention, secret rotation, observability, backup/restore, and incident runbooks.

## Initial backlog order

1. Postgres schema and adapter: runs, work items, transitions, approvals, webhook deliveries.
2. Authenticated operator API and idempotent GitHub webhook transaction.
3. Durable queue plus worker leases, heartbeats, cancellation, and retries.
4. GitHub App installation-token and repository adapters.
5. Sandbox job lifecycle and signed result contract.
6. Coding-agent adapter with a fake deterministic implementation for integration tests.
7. End-to-end test repository and operator UI.

## Non-goals for MVP

Automatic merging, production deployments, unrestricted shell access, arbitrary outbound networking, cross-organization learning, and Jira-specific workflow customization.

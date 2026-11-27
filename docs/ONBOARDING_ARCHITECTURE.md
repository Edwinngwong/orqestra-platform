# Customer onboarding architecture

This document describes Orqestra's independent customer-onboarding design. It is
not a copy of an employer or customer system.

## Website and dashboard

The public landing page is available at `/`. Invite-only client accounts sign
in at `/app` and see workspace-scoped project cards, workflow counts, active
runs, outstanding approval requests, and auditable run progress. The existing
operator dashboard is available at `/operator`. The public site does not
expose project data; operational APIs require authentication and roles.

There is no public account signup, billing, or automatic production deployment.
Production requires invitation verification, account recovery, rate limits,
mandatory HTTPS, retention policies, and operational support.

## Two customer entry points

| | Connect existing project | Start new project |
| --- | --- | --- |
| Customer already has code? | Yes | Not required |
| First step | Authorize selected GitHub repository | Describe product goal |
| Infrastructure access | Optional; not required for draft PR work | Not requested during intake |
| First durable record | `projects` | `new_project_intakes` |
| Can launch engineering runs immediately? | Only via existing ticket + approvals | **No** |
| Who reviews changes? | Authorized workspace reviewers | Human scopes and approves provisioning separately |
| Production deployment | Not part of current MVP | Not part of current MVP |

### Connect existing project (currently supported)

1. Create a workspace with a human owner.
2. Connect GitHub with an approved GitHub App installation and select a repository.
3. Choose the tracker (GitHub Issues, Jira, or Orqestra-only).
4. Configure permitted test commands, timeouts, change limits, and protected paths.
5. Process a work item through intake approval, bounded coding, signed sandbox
   tests, PR approval, and **draft** PR creation.
6. Customer reviews and decides what to merge; Orqestra has no automatic merge.

GitHub App installation discovery is now **workspace-scoped**. To establish a
connection, an Orqestra workspace admin signs in, selects a numeric GitHub App
installation ID and completes a GitHub user-to-server OAuth exchange. The server
requires a one-time, session-bound state and verifies that the user can access
that installation and has `admin` permissions on each repository it grants.
Tokens are not stored. Installation IDs are unique across Orqestra workspaces;
the server also rechecks GitHub App repository access when registering projects.

The stored repository allowlist is a snapshot of authorization at connection
time. **Do not consider this full production permission revocation support.**
Before a public rollout, respond to app installation removals and repository
permission changes, revoke running task tokens as appropriate, provide customer
disconnect/offboarding, reconcile historical projects, and independently verify
tenant isolation of background workers.

### Start new project (intake supported in 0.9.0)

1. Sign in to a workspace with an admin or owner role.
2. Choose **Start a new project** in the dashboard.
3. Enter project name, business goal, ownership preference, and optionally
   estimated monthly budget.
4. Submit a `pending_review` intake request.
5. A human evaluates scope, technology template, hosting ownership,
   requirements, cost estimates, and separate customer authorization.
6. Once an authorized repository exists and is connected through the GitHub
   App, an admin selects **Continue setup**, chooses the installation and
   repository, and activates the original request. This registers the project
   and records the intake-to-project link in one database transaction. Repeated
   activation attempts fail.

Customer-owned and Orqestra-managed projects both need an approved repository
before AI coding begins. The platform **does not** create new repositories or
provision AWS/cloud resources yet. Those require a separately approved,
template-based, budget-controlled provisioning service.

This **does not** create an executable `projects` record, trigger a run, spend
money, create a GitHub repository, grant cloud permissions, or deploy code.

API: `GET /v1/new-project-intakes` and `POST /v1/new-project-intakes`.
List access is workspace viewer or higher; creation is workspace admin or owner.
The authenticated principal's identity is recorded server-side. CSRF checks
are applied to cookie-authenticated writes.

## Shared delivery engine

Once a customer has an authorized, configured repository and environment,
the existing orchestration pipeline can handle requirements from compatible
intake adapters. All execution stays subject to the project's existing human
approval gates, restricted changes, sandbox test checks, and draft-PR limit.

Neither flow should automatically accept untrusted project text as permission
to modify the repository or cloud infrastructure.

## Provisioning design — not implemented yet

For new projects, a future, separately reviewed service should:

1. Present a short list of supported application templates and a cost estimate.
2. Record explicit ownership/authorization and a bounded spending limit.
3. Create a customer-owned repository via a customer-approved GitHub installation,
   or create an expressly contracted managed environment with an export path.
4. Provision an isolated preview environment using approved IaC templates.
5. Verify repository creation, policy, CI/CD, test suite, credentials, deployment
   status, and baseline monitoring before marking onboarding complete.
6. Require an explicit approval for any production deployment.

Secrets belong in managed secret stores and customer-controlled cloud roles, not
in prompt text, source control, or onboarding notes. Production deployments
must be through authorized pipelines and independently enforced approvals.

## Communications and meeting integration — not general group surveillance

Muse currently processes authorized, explicitly triggered WhatsApp messages
rather than reading an arbitrary existing WhatsApp group. Automatic group
monitoring requires official supported capabilities and group/participant
authorization; do not implement unofficial chat scraping or collect unrelated
conversation. AI meeting attendance should be opt-in, visibly identified,
restricted to authorized meetings, and respect participant notice and consent.

## Production readiness checklist

- [x] Bind GitHub installations and admin-authorized repositories to workspaces via OAuth
- [ ] Live-test OAuth callbacks and GitHub App installations with a nonproduction customer
- [ ] Reconcile grants after GitHub App installation, repository, and access changes
- [ ] Re-onboard pre-0.10 projects with verified connections
- [ ] OIDC/SSO, verified invitations, rate limits, recovery, HTTPS
- [ ] Auditable and revocable connector authorization
- [ ] Private ephemeral code execution with quotas and network restrictions
- [ ] Data retention, customer deletion/export, billing and spending enforcement
- [ ] Infrastructure access only after explicit user-approved role delegation
- [ ] Templated provisioning, failure rollback, and cost alerts
- [ ] Customer-facing project discovery report and architecture confirmation
- [ ] Human approval for new-project scope, costs, and production release
- [ ] Per-tenant metrics, alerting, backups, disaster recovery and incident plan

## Acceptance tests

`npm run db:migrate && npm test && npm run typecheck`

CI covers the new-project API, workspace permissions, server-side validation,
PostgreSQL persistence, UI markup, and compatibility with existing onboarding.
A real customer provision/Cloud integration acceptance has **not** happened.

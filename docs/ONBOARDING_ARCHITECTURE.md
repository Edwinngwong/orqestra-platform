# Customer onboarding architecture

This document describes Orqestra's independent customer-onboarding design. It is
not a copy of an employer or customer system.

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

The current local GitHub App discovery reads all installations visible to the
configured GitHub App. **This is not tenant-safe self-service discovery for a
hosted SaaS.** Before onboarding unrelated organizations, map authenticated
GitHub installations to exactly one authorized workspace, enforce that mapping
on discovery and project creation, validate the repository belongs to that
installation, and support revocation. Until then, use a controlled trusted
pilot deployment and do not expose the operator service to unrelated customers.

### Start new project (intake supported in 0.9.0)

1. Sign in to a workspace with an admin or owner role.
2. Choose **Start a new project** in the dashboard.
3. Enter project name, business goal, ownership preference, and optionally
   estimated monthly budget.
4. Submit a `pending_review` intake request.
5. A human evaluates scope, technology template, hosting ownership,
   requirements, cost estimates, and separate customer authorization.

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

- [ ] Bind GitHub installations and repositories to authorized workspaces
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

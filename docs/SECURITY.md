# Security baseline

Treat issue text, repository contents, generated code, tool output, and sandbox logs as untrusted input. They can contain prompt injection and must never change platform policy or approval requirements.

Required controls before production use:

- GitHub App least-privilege installation tokens scoped to one run and repository.
- Explicit workspace/project registration before webhook intake; GitHub App discovery never exposes installation tokens to the browser.
- Per-project test commands, timeouts, changed-file/byte limits, and protected-path enforcement.
- Authenticated operator endpoints with organization authorization and CSRF protection.
- Immutable audit events for every approval, credential grant, execution, cancellation, and PR action.
- Webhook replay protection and delivery-id idempotency in the same database transaction as intake.
- No secrets in prompts, logs, git commits, test artifacts, or agent-readable environment variables unless explicitly run-scoped.
- Sandbox isolation controls described in the sandbox repository; acceptance of a job is never evidence that tests passed.
- Rate limits, quotas, timeouts, cancellation, artifact retention, log redaction, and emergency disable switches.
- Dependency scanning, secret scanning, signed builds, pinned deploy artifacts, and protected default branches.

The local operator token is not multi-tenant authentication. Do not expose the local dashboard to customers until workspace-scoped identity and roles are implemented.

The current code is an implementation scaffold, not a production security boundary.

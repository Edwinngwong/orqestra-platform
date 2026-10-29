# Security baseline

Treat issue text, repository contents, generated code, tool output, and sandbox logs as untrusted input. They can contain prompt injection and must never change platform policy or approval requirements.

Required controls before production use:

- GitHub App least-privilege installation tokens scoped to one run and repository.
- Explicit workspace/project registration before webhook intake; GitHub App discovery never exposes installation tokens to the browser.
- Per-project test commands, timeouts, changed-file/byte limits, and protected-path enforcement.
- Authenticated operator endpoints with organization authorization and CSRF protection.
- Salted scrypt password hashes, short-lived opaque HttpOnly sessions, SameSite cookies, CSRF validation, forced temporary-password replacement, and server-side workspace role checks.
- Immutable audit events for every approval, credential grant, execution, cancellation, and PR action.
- Webhook replay protection and delivery-id idempotency in the same database transaction as intake.
- Constant-time Meta webhook verification/signature checks, durable WhatsApp message-ID deduplication, bounded message size, and no trust in sender-supplied project selection.
- Revocable WhatsApp bindings scoped to an active workspace member and one registered project. Unbound senders receive no response, and ordinary messages are ignored.
- WhatsApp can create a proposal only; confirmation, intake approval, PR approval, and merge authority are never delegated to the channel.
- No secrets in prompts, logs, git commits, test artifacts, or agent-readable environment variables unless explicitly run-scoped.
- Sandbox isolation controls described in the sandbox repository; acceptance of a job is never evidence that tests passed.
- Rate limits, quotas, timeouts, cancellation, artifact retention, log redaction, and emergency disable switches.
- Dependency scanning, secret scanning, signed builds, pinned deploy artifacts, and protected default branches.

The local operator token bypasses workspace roles and exists only for emergency/bootstrap access. Never distribute it to customers. Password authentication and roles are suitable for local pilots; add OIDC/SSO, verified email invitations, rate limiting, account lockout, password recovery, and mandatory HTTPS before broad production use.

WhatsApp message text and sender identifiers are customer data. Define encryption, retention/deletion, access logging, regional storage, and incident-response controls before a production pilot. The current temporary Meta token is development-only; use a managed system-user token with rotation in production.

The current code is an implementation scaffold, not a production security boundary.

# Live MVP setup

1. Run `./scripts/bootstrap-local.sh` to create a mode-0600 `.env.local` containing generated local secrets.
2. Create a GitHub App with read access to metadata and issues, and read/write access to contents and pull requests. Subscribe it to issue events.
3. Install the App only on the intended test repository. Put its App ID and private-key path in `.env.local`.
4. Put an OpenAI API key and an available Responses API model in `.env.local`.
5. Copy the matching sandbox tokens/signing secret into the sandbox environment. Configure a digest-pinned executor image.
6. Start PostgreSQL, apply migrations, then start the platform API, platform worker, sandbox API, and sandbox worker.
   After the first migration, run `npm run auth:bootstrap -- owner@example.com` once and store the returned temporary password securely.
7. Configure the GitHub App webhook URL as `/webhooks/github` with the generated webhook secret.
8. Open an issue, approve intake in the operator console, review the signed test result, then approve creation of the draft PR.

## WhatsApp Muse development setup

1. Create a Meta business app with the WhatsApp use case and prove the test number can send the `hello_world` template.
2. Rotate any temporary token that has appeared in a screenshot or chat.
3. Run `./scripts/configure-whatsapp-local.sh`. Enter the Phone Number ID, App Secret, and replacement access token only in the hidden terminal prompts.
4. Restart with `./scripts/local-down.sh` followed by `./scripts/local-up.sh` and note the current public URL.
5. In Meta WhatsApp configuration, set the callback to `<public-url>/webhooks/whatsapp`, copy `WHATSAPP_VERIFY_TOKEN` directly from `.env.local` into Meta, and subscribe to `messages`. Never paste the token into chat.
6. Publish the Meta app, then subscribe the app itself to the WhatsApp Business Account using `POST /<WABA_ID>/subscribed_apps` with `subscribed_fields=messages`. Enabling the `messages` field alone does not create this account-level subscription; verify it with `GET /<WABA_ID>/subscribed_apps`.
7. Sign in as a workspace admin, use the WhatsApp Muse access panel to bind your own international-format number to a project, and send `@muse` followed by a concrete software request to the Meta test number. Bind the business phone-number ID from a verified inbound webhook, not a display number or WABA ID.
7. Open the returned proposal link, confirm it in the dashboard, and continue through the existing intake and PR approvals.

Meta's temporary token and Cloudflare quick-tunnel URL are for development only. Production requires a permanent domain, managed system-user token, business verification as applicable, secret rotation, rate limits, retention controls, monitoring, and a registered production number.

The first workspace migration creates a local development workspace and backfills projects for existing runs. For additional repositories, install the GitHub App with selected-repository access, open the operator dashboard, click **Refresh GitHub**, and register the discovered repository under a workspace. Webhooks from repositories that have not been registered are rejected.

Never commit `.env.local`, private keys, installation tokens, API keys, session cookies, CSRF tokens, or temporary passwords. The secret bootstrap refuses to overwrite an existing secret file.

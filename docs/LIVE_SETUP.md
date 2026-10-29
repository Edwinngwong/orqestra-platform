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

The first workspace migration creates a local development workspace and backfills projects for existing runs. For additional repositories, install the GitHub App with selected-repository access, open the operator dashboard, click **Refresh GitHub**, and register the discovered repository under a workspace. Webhooks from repositories that have not been registered are rejected.

Never commit `.env.local`, private keys, installation tokens, API keys, session cookies, CSRF tokens, or temporary passwords. The secret bootstrap refuses to overwrite an existing secret file.

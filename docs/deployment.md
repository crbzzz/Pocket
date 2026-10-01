# Deploy Pocket

The initial deployment uses one Cloudflare Worker, Supabase, and ephemeral Daytona compute. The API and browser are served at https://pocket-api.pocket-edouard.workers.dev; the Mac is not involved in production requests.

## Supabase

Create a Supabase project on the free tier. Apply both SQL files in `supabase/migrations` in order using the Supabase SQL editor or your migration tooling. The first creates the schema; the second enables RLS, restricts grants, publishes job changes to Realtime, and creates a private checkpoint bucket. The API refuses production startup when required tables do not have RLS.

Enable GitHub under Auth providers using your OAuth credentials. Register `pocket://auth-callback`, `pocket://github-connected`, and the HTTPS API origin followed by `/` in allowed redirect URLs. GitHub’s OAuth callback points to Supabase’s `/auth/v1/callback`. The native app uses PKCE rather than accepting an access token in a deep link. Supabase’s [PKCE documentation](https://supabase.com/docs/guides/auth/sessions/pkce-flow) describes the underlying flow.

Server configuration:

- `DATABASE_URL`: Supabase session pooler connection. Local Node connections verify the Supabase CA from `DATABASE_SSL_CA`. Cloudflare uses the Hyperdrive binding, configured with `sslmode=verify-full`, that same CA, caching disabled, and five origin connections.
- `SUPABASE_URL`: project URL.
- `SUPABASE_PUBLISHABLE_KEY`: public Auth/Realtime key.
- `SUPABASE_SERVICE_ROLE_KEY`: secret, for private checkpoints and the dispatcher’s queue inspection.

The iPhone receives only the Supabase URL, publishable key, and its own user session. Put the URL and public key in the app target’s `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` build settings. Server-side identity validation uses [getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims); no unverified JWT payload authorizes API requests.

## GitHub App

For other users to install Pocket, make the GitHub App public under Settings → GitHub Apps → Pocket → Advanced → Make public. Repository permissions remain limited to each authorized installation.

Create a GitHub App with **Metadata: read**, **Contents: read/write**, and **Pull requests: read/write** permissions. These are the minimum permissions for the implemented clone + branch + PR workflow; Contents write is requested only for approved shipping. Installation tokens are repository-scoped and read-only during cloning. GitHub documents [installation-token authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).

Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_FILE` (a path inside ignored `secrets/`, loaded for local development/deployment), `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `POCKET_PUBLIC_URL` (your HTTPS API origin), `GITHUB_TOKEN_ENCRYPTION_KEY` (32 random bytes as 64 hex characters), and a strong `GITHUB_WEBHOOK_SECRET`. Set the App’s Setup URL to `https://YOUR_API/github/installed` for the native return. Register `https://YOUR_API/github/webhook`; subscribe to Installation and Installation repositories events. PEM private keys may use escaped newlines. Never add them to Xcode settings or the repository.

Keep Supabase’s regular GitHub OAuth App for identity sign-in. Register a separate callback on your Pocket GitHub App at `https://YOUR_API/github/callback`. Sign into Pocket and install the App for selected repositories. Personal installations are discovered from the App and matched against each user’s GitHub identity verified by Supabase, so personal repositories do not need a second OAuth grant. The implementation contains no production account ID or owner-name restriction. Sync imports repository metadata and user memberships atomically, preserves existing project memory, and removes this user’s memberships for repositories no longer authorized. GitHub REST calls send Pocket’s User-Agent explicitly, including on Workers. Organization repositories still use **Connect organization repositories** and a separate App user grant. For organizations, the App user grant verifies membership and repository access rather than inferring access from organization installation alone. A single-use, ten-minute hashed state binds that authorization to the signed-in GitHub identity. The App user token is encrypted with AES-256-GCM in server-side PostgreSQL and retained for at most eight hours; it never enters the iPhone. The API checks the GitHub token against the Supabase identity and uses only repositories accessible to that user. Re-sync refreshes branches. Webhooks revoke access to removed repositories. An expired App authorization requires tapping Authorize repository access again. App user-token refresh is not yet implemented.

## Daytona and models

Set `DAYTONA_API_KEY`. Optionally create a small reusable Node/TypeScript snapshot containing Git and Python 3, then set `DAYTONA_SNAPSHOT` to its name. Otherwise the SDK uses its default TypeScript snapshot. Repositories with different stacks need appropriate snapshots; do not assume the initial image can compile every language.

The adapter uses documented [sandbox creation](https://www.daytona.io/docs/en/typescript-sdk/daytona/), lifecycle TTL/auto-delete, file transfer, and process execution. It sets a 20-minute backup TTL and deletes compute after the task. A real task should be exercised to confirm your account’s snapshot, resource, lifecycle, and networking behavior.

Set one or more provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`. Define `MODEL_CATALOG` as JSON:

```json
[
  {
    "id": "coding",
    "name": "Coding",
    "description": "Your configured coding model",
    "provider": "openai",
    "model": "ACTUAL_PROVIDER_MODEL_ID",
    "maxCostCents": 300,
    "inputCentsPerMillion": 100,
    "outputCentsPerMillion": 400
  }
]
```

The numerical rates above are illustrative configuration values, **not current provider pricing**. Replace them with actual input/output prices in US cents per million tokens. Put a low-cost model first and your desired reasoning model last. Auto resolves to the first enabled entry; Fast chooses the lowest input rate; Powerful uses the last enabled entry. Only entries whose provider has credentials are enabled. There is no provider-specific model ID in the iOS code.

## Cloudflare hosting

`infra/cloudflare/wrangler.jsonc` defines the API, static preview, native rate limiter, minute schedule, and Hyperdrive binding. Configure the binding for your own account when moving deployments. The existing Pocket deployment has its Supabase schema and RLS migrations applied.

Place `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the ignored root `.env`. The token requires Workers Scripts edit and account settings read; creating Hyperdrive or uploading a CA additionally requires their respective permissions. Deploy with:

```sh
npm run deploy:cloudflare
npm run configure:ios
```

The script uploads only the selected server settings, resolves the PEM file, removes its temporary secret file, deploys the Worker, and checks `/health`. Cloudflare administration credentials are never uploaded to the Worker or copied into Xcode. The iOS configuration contains only the HTTPS origin, production mode, and public Supabase values.

Production routing uses `edge-router.ts`; local development uses Fastify. Both share the same route handlers, Zod validation, authentication, tenant checks, and PostgreSQL store. This avoids runtime code generation prohibited by Workers. SQL sockets belong to one invocation and close after it. Hyperdrive verifies the origin certificate; the Worker does not use a permanent database connection.

The schedule inspects one queued or expired job each minute through Supabase REST. An empty queue creates no sandbox or SQL socket. A nonempty queue claims work with PostgreSQL locks and runs the agent until completion, cancellation, or its hard timeout. There is no separate dispatcher deployment or worker fleet. A submitted job may wait up to a minute. [Scheduled invocations](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) have a fifteen-minute wall limit; the three-minute free-profile task cap and four-minute outer timeout fit within it. The deployed MVP stays on the free Workers tier: one job per scheduled invocation, at most six agent actions, three minutes of runtime, and 18,000 LLM tokens. Two task slots remain available per user, so a second task can wait in the database. The limits are returned by `/v1/config`. The local default retains the larger limits for development. Monitor CPU and request quotas before increasing concurrency.

The Dockerfile and `infra/dispatcher` remain optional Node hosting alternatives; they are not used by the current deployment.

## Validate a real deployment

Use a disposable private repository. Sign in, authorize that repository, submit a small bounded change, check the diff and truthful check results, and verify that a private checkpoint exists before the sandbox disappears. Restore it and run a follow-up task. Cancel another running task and verify compute deletion in Daytona. Finally approve a new branch/PR and check GitHub’s result. Keep provider spending caps enabled while validating.

Cloud smoke checks exercised a temporary real Supabase session against config, models, repositories, jobs, and usage, verified unauthorized requests are rejected, and removed that test account. GitHub App credentials were verified separately. Signing in as the owner and running a change against an authorized repository still requires the owner’s interactive GitHub consent. APNs background delivery is not configured. The app currently uses foreground Realtime and local completion notifications; it reloads jobs on return from the background.

# Deploy Pocket

No production resources are created by this repository. Start with the local demo, then configure a real private test repository before wider use.

## Supabase

Create a Supabase project on the free tier. Apply both SQL files in `supabase/migrations` in order using the Supabase SQL editor or your migration tooling. The first creates the schema; the second enables RLS, restricts grants, publishes job changes to Realtime, and creates a private checkpoint bucket. The API refuses production startup when required tables do not have RLS.

Enable GitHub under Auth providers using your OAuth credentials. Register `pocket://auth-callback` in allowed redirect URLs. GitHub’s OAuth callback points to Supabase’s `/auth/v1/callback`. The native app uses PKCE rather than accepting an access token in a deep link. Supabase’s [PKCE documentation](https://supabase.com/docs/guides/auth/sessions/pkce-flow) describes the underlying flow.

Server configuration:

- `DATABASE_URL`: Supabase session pooler connection with SSL, preferably `?sslmode=require`. The API pool has two connections per instance. Keep pool size and Cloud Run instance count within the free project’s connection budget.
- `SUPABASE_URL`: project URL.
- `SUPABASE_PUBLISHABLE_KEY`: public Auth/Realtime key.
- `SUPABASE_SERVICE_ROLE_KEY`: secret, for private checkpoints and the dispatcher’s queue inspection.

The iPhone receives only the Supabase URL, publishable key, and its own user session. Put the URL and public key in the app target’s `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` build settings. Server-side identity validation uses [getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims); no unverified JWT payload authorizes API requests.

## GitHub App

Create a GitHub App with **Metadata: read**, **Contents: read/write**, and **Pull requests: read/write** permissions. These are the minimum permissions for the implemented clone + branch + PR workflow; Contents write is requested only for approved shipping. Installation tokens are repository-scoped and read-only during cloning. GitHub documents [installation-token authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).

Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `POCKET_PUBLIC_URL` (your HTTPS API origin), `GITHUB_TOKEN_ENCRYPTION_KEY` (32 random bytes as 64 hex characters), and a strong `GITHUB_WEBHOOK_SECRET`. Register `https://YOUR_API/github/webhook`; subscribe to Installation and Installation repositories events. PEM private keys may use escaped newlines. Never add them to Xcode settings or the repository.

Keep Supabase’s regular GitHub OAuth App for identity sign-in. Register a separate callback on your Pocket GitHub App at `https://YOUR_API/github/callback`. Sign into Pocket, install the App for selected repositories, tap **Authorize repository access**, then enter the installation ID to sync. The separate GitHub App authorization is necessary because installation discovery requires an App user access token, not a regular OAuth App token. A single-use, ten-minute hashed state binds that authorization to the signed-in GitHub identity. The App user token is encrypted with AES-256-GCM in server-side PostgreSQL and retained for at most eight hours; it never enters the iPhone. The API checks the GitHub token against the Supabase identity and uses only repositories accessible to that user. Re-sync refreshes branches. Webhooks revoke access to removed repositories. An expired App authorization requires tapping Authorize repository access again. App user-token refresh is not yet implemented.

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

## Request-driven Node hosting

Build the supplied Dockerfile for Cloud Run. Use request-based billing, `--min=0`, a conservative maximum instance count, and a request timeout of at least 12 minutes. The app’s ten-minute runtime plus cleanup must fit inside the HTTP timeout. The free database’s connection budget is often the first scaling constraint; start with few instances and monitor it before raising limits. Use a managed secret store for credentials.

An illustrative configuration, after building and publishing your container image:

```sh
gcloud run deploy pocket-api \
  --image YOUR_IMAGE \
  --region YOUR_REGION \
  --min=0 --max=5 --concurrency=4 \
  --cpu=1 --memory=512Mi --timeout=900 \
  --set-env-vars POCKET_MODE=production,POCKET_WORKER=off
```

Configure secrets and HTTPS access separately. The public API requires user JWTs, and `/internal/drain` additionally requires the independent strong `WORKER_DISPATCH_SECRET`. Keep Cloud Run minimum instances at zero; do not enable a persistent polling worker or instance-based billing. See Google’s [minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances) and [billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings) documentation. The Docker image runs as a non-root user.

## Cloudflare dispatcher

`infra/dispatcher` contains a standalone scheduled Worker. Configure `POCKET_API_URL` and `SUPABASE_URL` in `wrangler.jsonc`. Set secrets from that directory using the Cloudflare CLI:

```sh
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put WORKER_DISPATCH_SECRET
npx wrangler deploy
```

The dispatcher reads up to four queued job IDs each minute (raise `DISPATCH_BATCH` up to 25 when workload grows), then sends one drain request per queued job. SQL locks arbitrate concurrent claims; the browser or phone can disconnect after submission. There are no long-lived Workers, dedicated queues, or Redis services. An empty queue causes no call to the Node API. Jobs may wait up to a minute before being claimed.

[Cloudflare scheduled invocations](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) have a finite wall-time limit; the ten-minute agent timer and twelve-minute dispatch timeout fit below the documented fifteen-minute ceiling. Verify limits for your selected plan before deployment. SDK work stays in Node so no compatibility polyfills are needed on the edge.

## Validate a real deployment

Use a disposable private repository. Sign in, authorize that repository, submit a small bounded change, check the diff and truthful check results, and verify that a private checkpoint exists before the sandbox disappears. Restore it and run a follow-up task. Cancel another running task and verify compute deletion in Daytona. Finally approve a new branch/PR and check GitHub’s result. Keep provider spending caps enabled while validating.

The local suite does not prove cloud deployment, live OAuth, real model compatibility, or real sandbox resource limits. APNs background delivery is not configured. The app currently uses foreground Realtime and local completion notifications; it reloads jobs on return from the background.

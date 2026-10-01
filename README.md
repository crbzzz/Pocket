# Pocket

**Ship from anywhere.** A native iPhone control surface for an AI coding agent running in ephemeral cloud sandboxes.

Ask → Agent works → Review → Ship.

This repository contains a working local MVP, a native SwiftUI app, and real server adapters for Supabase, Daytona, GitHub Apps, OpenAI, Anthropic, and Google. Local tasks are explicitly simulated; production tasks use configured providers. The cloud integrations have not been exercised with live credentials.

## Run locally

Requires Node 22.12+ and npm. No API keys, Docker, or paid infrastructure required.

```sh
npm ci
npm run dev:demo
```

Open **http://127.0.0.1:4310**. The browser preview implements all six screens against the API: Projects, Chat, Changes, Saves, Agents, and Settings. Submit a task, see its progress, review the demo diff, restore a Save, and approve a simulated PR. Demo checks never represent actual repository execution.

Demo data persists in `apps/api/.data/pocket`. Local mode binds only to loopback and uses a clearly identified demo token. The API automatically loads the root `.env`; existing shell variables take precedence. Copy `.env.example` to `.env` if needed. Fill in service credentials and `MODEL_CATALOG` before switching to production. Keep production secrets in your hosting secret manager. `npm run dev:demo` always starts local simulated execution independently of cloud settings.

## Run on iPhone Simulator

1. Start the local API.
2. Open `Pocket.xcworkspace` at the repository root in Xcode 16 or newer.
3. Select the **Pocket** scheme and an iPhone simulator, then Run.

The app defaults to `http://127.0.0.1:4310`. It supports native repository/branch/model selection, delegation, progress, cancellation, diff review, approval, Saves, memory, and usage preferences. Six native tabs may use iOS’s **More** tab on compact devices; Settings is also accessible from the header.

For a physical iPhone, select your Apple development team under **Pocket → Signing & Capabilities** with automatic signing enabled. No signing certificate is bundled in this repository. A physical iPhone requires an HTTPS API endpoint; its localhost is not your Mac. Production GitHub sign-in uses Supabase PKCE and stores sessions in device-only Keychain. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the **app target build settings**, set the API URL in Settings, and disable Local demo.

## Verify

```sh
npm run check                 # strict TypeScript + API/runtime tests
npm run test:preview          # browser workflows; installed Chrome required
swift test --package-path apps/ios/PocketCore
xcodebuild -project apps/ios/Pocket.xcodeproj -scheme Pocket \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The browser tests capture desktop/mobile screenshots in `docs/images`. The Xcode project can be regenerated with `python3 scripts/generate-xcode-project.py` after adding Swift files; preserve custom signing and Supabase settings before regenerating.

## Cloud setup

See [deployment](docs/deployment.md), [architecture and cost controls](docs/architecture.md), and [API contract](docs/api.md).

Production uses Supabase PostgreSQL/Auth/private Storage and Realtime, a PostgreSQL queue, and Daytona sandboxes. GitHub uses a GitHub App with repository-scoped short-lived tokens. Model catalog and prices live on the server. Only providers with credentials appear in the catalog.

The API and browser run on **Cloudflare Workers**, with Hyperdrive connecting to Supabase. A minute schedule starts agents only when PostgreSQL has queued work. There is no permanent worker fleet, Redis, or environment per user. Production works with the Mac switched off.

## What is implemented

- Persistent jobs, resumable ordered events, branch-specific Git Saves, and compact project memory.
- Transactional queue claims, worker leases, idempotent submissions, tenant authorization, cancellation, and two active task slots per user.
- Intent routing through the cheapest configured model before sandbox allocation: analyses produce chat answers without checkpoints; implementation requests edit files and prepare reviewable changes.
- A bounded agent loop with list/search/read/write/run/check tools and a provider-neutral model router. The Anthropic adapter uses native tool calls rather than parsing freeform action prose; finish delivers the user-facing chat response.
- Ephemeral Daytona sandboxes, output-capped command execution, timeouts, and cleanup on completion, failure, or cancellation.
- Git bundles and file manifests persisted privately before sandbox deletion; subsequent tasks resume the branch’s latest Save.
- Approved GitHub branch/PR creation, base-branch conflict detection, audit entries, webhook revocation, and replay protection.
- Supabase GitHub sign-in, native Realtime updates, foreground local notifications, and active-task polling fallback.
- Structured logs and per-call token/cost accounting, including unsuccessful tasks with recorded model usage.

## Current boundaries

Background APNs delivery, artifact previews, persistent conversation summarization, scheduled artifact retention, and automatic reconciliation after ambiguous GitHub shipping failures are not implemented. Memory is a compact bounded recent-work summary, not a full chat archive. Personal repositories use the GitHub App installation matched to your verified GitHub account. Organization access uses a separate GitHub App user grant. The browser supports Supabase sign-in; initial repository enrollment is available in the native app.

The free cloud MVP limits an agent task to six steps, three minutes, and 18,000 model tokens.

Large repositories and artifacts are deliberately bounded: 200 changed files, 1 MB per changed file, 8 MB review manifest, 20 MB Git bundle, 28 MB stored checkpoint. Large files fail the task instead of silently dropping changes. Model prices must be configured correctly. Sandbox billing is separate from the model-cost cap.

The cloud API and preview are deployed at https://pocket-api.pocket-edouard.workers.dev. Real cloud session checks pass; repository changes require interactive GitHub authorization.

## Development on a physical iPhone

Run `npm run dev:iphone` to make the simulated API available on your local network. Keep the iPhone and Mac on the same Wi-Fi and allow Pocket’s Local Network permission. Debug builds use the target’s `POCKET_API_URL` build setting when no remote endpoint has been saved; set it to your Mac’s current address, for example `http://192.168.1.10:4310`. You can also change it under Settings → Development → API URL, then Apply & reconnect. Keep Local demo enabled. Release builds require HTTPS for remote endpoints.

## GitHub sign-in on iPhone

Run `npm run configure:ios` after filling `SUPABASE_URL` and the public `SUPABASE_PUBLISHABLE_KEY` in the root `.env`, then build in Xcode. Only these two public client values are copied into ignored `apps/ios/Config/Local.xcconfig`; server credentials stay on the server. GitHub OAuth must be enabled in Supabase, with `pocket://auth-callback` in the redirect allowlist. Tap Connect GitHub on Projects or Sign in with GitHub in Settings. Identity sign-in works even when the local API is offline. When `POCKET_PUBLIC_URL` contains the deployed HTTPS origin, the generated build uses production mode. Choose repositories in Settings; personal installations sync against your existing GitHub identity.

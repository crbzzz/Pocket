# Pocket

**Ship from anywhere.** A native iPhone control surface for an AI coding agent running in ephemeral cloud sandboxes.

Ask → Agent works → Review → Ship.

This repository contains a working local MVP, a native SwiftUI app, and real server adapters for Supabase, Daytona, GitHub Apps, OpenAI, Anthropic, and Google. Local tasks are explicitly simulated; production tasks use configured providers. The cloud integrations have not been exercised with live credentials.

## Run locally

Requires Node 22.12+ and npm. No API keys, Docker, or paid infrastructure required.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4310**. The browser preview implements all six screens against the API: Projects, Chat, Changes, Saves, Agents, and Settings. Submit a task, see its progress, review the demo diff, restore a Save, and approve a simulated PR. Demo checks never represent actual repository execution.

Demo data persists in `apps/api/.data/pocket`. Local mode binds only to loopback and uses a clearly identified demo token. `.env.example` documents configuration; the app does not automatically load `.env`. Set environment variables in your shell or hosting secret manager.

## Run on iPhone Simulator

1. Start the local API.
2. Open `apps/ios/Pocket.xcodeproj` in Xcode 16 or newer.
3. Select the **Pocket** scheme and an iPhone simulator, then Run.

The app defaults to `http://127.0.0.1:4310`. It supports native repository/branch/model selection, delegation, progress, cancellation, diff review, approval, Saves, memory, and usage preferences. Six native tabs may use iOS’s **More** tab on compact devices; Settings is also accessible from the header.

A physical iPhone requires an HTTPS API endpoint; its localhost is not your Mac. Production GitHub sign-in uses Supabase PKCE and stores sessions in device-only Keychain. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the **app target build settings**, set the API URL in Settings, and disable Local demo.

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

The initial Node API is packaged for **Cloud Run with zero minimum instances**. A small Cloudflare Worker dispatches queued jobs on demand. There is no permanent worker fleet, Redis, or environment per user. The Node SDK and long agent runs are kept out of the edge API; replacing them with compatible edge adapters is a future optimization.

## What is implemented

- Persistent jobs, resumable ordered events, branch-specific Git Saves, and compact project memory.
- Transactional queue claims, worker leases, idempotent submissions, tenant authorization, cancellation, and two active task slots per user.
- A bounded agent loop with search/read/write/run/check tools and a provider-neutral model router.
- Ephemeral Daytona sandboxes, output-capped command execution, timeouts, and cleanup on completion, failure, or cancellation.
- Git bundles and file manifests persisted privately before sandbox deletion; subsequent tasks resume the branch’s latest Save.
- Approved GitHub branch/PR creation, base-branch conflict detection, audit entries, webhook revocation, and replay protection.
- Supabase GitHub sign-in, native Realtime updates, foreground local notifications, and active-task polling fallback.
- Structured logs and per-call token/cost accounting, including unsuccessful tasks with recorded model usage.

## Current boundaries

Background APNs delivery, artifact previews, persistent conversation summarization, scheduled artifact retention, and automatic reconciliation after ambiguous GitHub shipping failures are not implemented. Memory is a compact bounded recent-work summary, not a full chat archive. Installation linking currently asks for separate GitHub App authorization and the installation ID after sign-in. The browser is a local demo preview; real authentication is in the native app.

Large repositories and artifacts are deliberately bounded: 200 changed files, 1 MB per changed file, 8 MB review manifest, 20 MB Git bundle, 28 MB stored checkpoint. Large files fail the task instead of silently dropping changes. Model prices must be configured correctly. Sandbox billing is separate from the model-cost cap.

No service has been deployed and no paid resources have been created.

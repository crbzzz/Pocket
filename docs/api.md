# Pocket API

All `/v1` requests require `Authorization: Bearer <Supabase access token>`. Local demo mode accepts only `pocket-local-demo` and binds to loopback. Responses use camelCase JSON except native Supabase Auth sessions.

| Method | Path                          | Behavior                                                          |
| ------ | ----------------------------- | ----------------------------------------------------------------- |
| GET    | `/health`                     | Liveness and mode                                                 |
| GET    | `/v1/config`                  | Demo flag, GitHub installation URL, hard limits                   |
| GET    | `/v1/models`                  | Server model catalog filtered by configured credentials           |
| GET    | `/v1/projects`                | Authorized repositories                                           |
| GET    | `/v1/projects/:id`            | Project metadata and compact memory                               |
| GET    | `/v1/jobs`                    | Your latest 100 authorized tasks (diff metadata, patches omitted) |
| POST   | `/v1/jobs`                    | Validate and enqueue a task; returns 202                          |
| GET    | `/v1/jobs/:id`                | Progress and persisted report                                     |
| GET    | `/v1/jobs/:id/events?after=0` | Ordered events, up to 200; resume using last sequence             |
| POST   | `/v1/jobs/:id/cancel`         | Fence completion and stop compute at next heartbeat               |
| GET    | `/v1/projects/:id/saves`      | Git checkpoints, newest first                                     |
| POST   | `/v1/projects/:id/restore`    | Select `{saveId, branch?}` for the next task                      |
| POST   | `/v1/jobs/:id/ship`           | Explicitly approved new branch or PR                              |
| POST   | `/v1/github/connect`          | Verify identity and sync accessible installation repositories     |
| GET    | `/v1/usage`                   | Recorded aggregate token cost and active tasks                    |
| POST   | `/github/webhook`             | HMAC-verified revocation events, delivery-idempotent              |
| POST   | `/internal/drain`             | Separate secret auth; claim and run one job                       |

Task creation and shipping require `Idempotency-Key`, 8–100 characters. Repeating the same key with different inputs returns 409. Never reuse a submission key for a different task.

```json
{
  "projectId": "00000000-0000-4000-8000-000000000010",
  "branch": "main",
  "prompt": "Make the dashboard responsive. Do not modify the backend.",
  "modelId": "auto",
  "maxCostCents": 300
}
```

Shipping requires `{ "kind": "pr", "title": "Mobile dashboard", "approved": true }`, or `kind: "push"` for a new branch without a PR. Missing approval is rejected. Failed checks block shipping; skipped checks remain visible for explicit review. The API checks the saved Git base SHA against GitHub and rejects a moved base. The result names the new branch and optionally returns the GitHub PR URL.

Every completed job creates a Save and updates that branch’s continuation reference automatically. Restoring a Save never resets or pushes a remote branch. Job detail returns full patches; list and progress polling omit patch bodies to reduce database egress and mobile traffic. Reports contain summary, authoritative file diffs, checks, private checkpoint reference, original base SHA, and recorded model cost. Demo reports are marked `demo: true` and contain simulated code/checks only.

Errors have `{ "error": "message" }` and appropriate 400/401/403/404/409/429/503 status. Unauthorized project/job IDs return 404. Model service errors and infrastructure details are not exposed to clients; structured server logs carry operational failures.

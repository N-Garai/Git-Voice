# REST API

All endpoints are served by the single backend on the deployment origin. JSON in/out unless
noted.

## Access model

Report data (transcripts, telemetry, audio, project inventory) is private. There are two
ways to reach it, and nothing else:

| Caller | How | Sees |
|---|---|---|
| **Operator** | `Authorization: Bearer <DASHBOARD_TOKEN>` | every project and report |
| **Owner** | GitHub login (HttpOnly session cookie) | only projects stamped with their own GitHub login, plus the bundled demo project |

Anonymous requests to any dashboard route return **401**. This is fail-closed: it holds even
when `DASHBOARD_TOKEN` is unset, because that variable only controls whether the *operator
override* exists. The bundled demo project cannot be served to anonymous callers either —
defense in depth in the route guards.

`POST /api/issue` (the widget) requires sign-in too, and additionally requires that the
caller owns the target project (or is submitting into the demo). Layered limits still apply
on top: per-IP rate limiting and an hourly hosted-model-capacity valve that degrades to the
offline engine rather than exhausting the operator's quota.

> **Cross-origin caveat.** The session cookie is `SameSite=Lax`, so a report filed from a
> *third-party* staging site will not carry it. In that deployment the widget's owner has to
> be signed in on that browser. Same-origin use (the dashboard, the demo storefront) works
> with the cookie as normal.

## Health

### `GET /health`

Liveness probe for platforms.

```json
{ "ok": true, "service": "git-voice", "version": "1.0.0", "time": "2026-10-15T12:00:00.000Z" }
```

## Issues

### `POST /api/issue`  *(operator, or a signed-in owner of that project)*

Files a report and runs the full seven-station pipeline synchronously. Accepts
`multipart/form-data` (widget submissions with audio) or `application/json`.
`401` when anonymous or not the project's owner; `400` on malformed payloads.

Form/JSON fields:

| Field | Type | Notes |
|---|---|---|
| `projectId` | string | required; must exist |
| `transcript` | string | optional |
| `transcriptSource` | `"browser-speech" \| "typed-report" \| "telemetry-only"` | optional |
| `telemetry` | JSON string | see schema below |
| `audio` | file (multipart only) | ≤ 10 MB, webm/ogg/mp4 |
| `repoFullName` | `owner/repo` (JSON field or multipart field) | optional one-off destination; see below |

Telemetry object (all fields trimmed server-side):

```json
{
  "url": "https://staging.example.com/checkout",
  "route": "/checkout",
  "title": "Checkout — staging",
  "viewport": { "w": 820, "h": 1180, "dpr": 2 },
  "userAgent": "Mozilla/5.0 …",
  "language": "en-US",
  "sessionMs": 48210,
  "consoleLogs": [ { "level": "error", "text": "ERR_COUPON_STATE_DESYNC: …" } ],
  "errors":     [ { "message": "TypeError: …", "source": "…", "line": 42 } ],
  "clicks":     [ { "selector": "[data-testid=apply-code]", "label": "Apply" } ]
}
```

Returns `201` with the finished record:

```json
{ "issue": { "id": "…", "status": "completed", "trace": [ … ], "result": { … } } }
```

Where `result` contains:

| Key | Contents |
|---|---|
| `draft` | `title`, `severity`, `labels`, `suspectedFile`, `summary`, `expected`, `actual`, `reproSteps`, `issueBody` |
| `matches` | top index matches with `vectorScore`, `keywordScore`, `score` |
| `consoleCorrelations` | captured console strings mapped to indexed error codes |
| `models` | which transcriber / drafter / embedder / store handled each station |
| `confirmation` | `spokenText`, `voiceBackend` (`elevenlabs` or `web-speech`), optional inline audio |
| `github` | `pushed`, `issueUrl`, `issueNumber`, or `reason` when kept as a draft |

Errors: `400` (missing/bad payload), `429` (rate limited, includes `Retry-After`), `500`.

### Choosing the destination repository

By default a report goes to the project's own `repoFullName`. Pass an optional
`repoFullName` (JSON body or multipart field) to retarget **that single report** to another
`owner/repo` without changing the project default. The report is still published with the
project owner's own token, so the GitHub author is unchanged; a repository they cannot
write to simply degrades to a draft with the API's reason recorded.

### `GET /api/issues?projectId=…`  *(operator or owner)*

Newest-first list of report records (audio payloads stripped), **scoped to the caller**.
`projectId` filters within the caller's visible projects.

### `GET /api/issues/:id`  *(operator or owner)*

Single record, same shape as list elements.

### `GET /api/issues/:id/audio`  *(operator or owner)*

Streams the attached report audio (`Content-Type`: recorded mime, `Cache-Control: private,
no-store`). The dashboard fetches it as a blob and plays it from an object URL. `404` when
the report has no audio or its audio was trimmed (only the most recent 50 in-memory reports
keep audio attached).

### `GET /api/issues/:id/body.md`  *(operator or owner)*

The drafted issue body as `text/markdown; charset=utf-8` — exactly what publishing sends.

## Projects

### `GET /api/projects`  *(operator or owner)*

Projects visible to the caller, with index status, count and embedder id.

### `GET /api/projects/:id`  *(operator or owner)*

Single project.

### `POST /api/projects`  *(operator or GitHub login)*

`{ "name": "Acme staging", "repoFullName": "owner/repo" }` → `201` + project. The repo may
be an `owner/repo` string or a GitHub URL; stored normalized. The creating user's GitHub
login is stored as the project's `ownerLogin` and becomes the identity used for every later
index/publish action on that project.

Plan gate: the signed-in account's tier limits how many projects it may own (Hobby 1,
Freelancer 1, Agency 10). Exceeding it returns `402` with `{ upgrade: true }` context.
Private repositories are a paid capability: when the tier doesn't include it and GitHub
confirms the repo is private, creation is rejected with `403` and the upgrade hint.

### `POST /api/projects/:id/index`  *(operator or that project's owner)*

Rebuilds the architecture index. Body `{ "repoFullName": "owner/repo" }` overrides the
stored repo; the bundled demo project always re-indexes from its built-in fixture. Public
repos are fetched as tarballs (no git binary, no API quota; 40 MB cap); private repos use
the owner's OAuth token and are additionally gated on the private-repos entitlement
(`402` otherwise). Returns `{ project, filesWalked, filesIndexed, embedder }`. `502` with the
reason on failure.

### `GET /api/projects/:id/search?q=…&route=…`  *(operator or owner)*

Runs a hybrid query against the project's index (useful for demos and debugging):

```json
{ "query": "coupon checkout", "backend": "…", "matches": [ { "filePath": "…", "score": 0.91 } ] }
```

### `DELETE /api/projects/:id`  *(operator or that project's owner)*

Permanently removes the project and everything belonging to it, in dependency order:

1. its index rows and embeddings (deleted from Postgres when configured, and from memory),
2. every stored report for that project plus any attached audio,
3. the project row itself (memory and Postgres).

Returns `{ ok: true, deleted: { project, reports, indexEntriesRemoved } }`. `400` for the
bundled demo project, which is re-seeded on boot. Issues already filed on GitHub are
unaffected — this only clears this service's own data.

## Plans and billing

A signed-in GitHub account owns one plan profile, and the tier is not cosmetic — it decides
which pipeline stages run in hosted mode and which are held back:

| Tier | Price | Projects | Entitlements |
|---|---|---|---|
| Hobby | $0 | 1 | public repos, offline drafting, browser voice |
| Freelancer | $15/mo | 1 | private repos, model drafting, premium voice, auto re-index on push |
| Agency | $60/mo | 10 | everything above, plus multiple client projects |

Gated responses use **402 Payment Required** with `{ upgrade: true, tier }`.

### `GET /api/billing/plans`

Public catalogue (no auth): tier, label, price in cents, project limit, entitlements, plus
`simulation: true` — checkout never contacts a payment processor.

### `GET /api/billing/me`  *(operator or owner)*

`{ profile, entitlements, invoices, projectLimit }`. A paid tier expires automatically at
its period end and falls back to Hobby.

### `POST /api/billing/checkout`  *(GitHub sign-in required)*

```json
{ "tier": "freelancer", "method": "card", "instrument": "4242 4242 4242 4242" }
```

**Simulated.** No processor is contacted and no money moves. Cards are validated with a
Luhn check; UPI handles are shape-checked; invalid instruments are rejected with `400`. On
success returns `201` with the new `profile` and a `paid` invoice. Only a masked instrument
label (`•••• 4242`, `na•••@okaxis`) is ever stored — never the raw value.

### `POST /api/billing/cancel`  *(GitHub sign-in required)*

Keeps the plan until the paid period ends, then falls back to Hobby.

## Settings and preferences

### `GET /api/settings`

Machine-readable deployment status for the Settings tab — one row per integration
(`llm`, `stt`, `embeddings`, `vector-store`, `tts`, `github`, `github-login`, `auth`)
with `configured`, `activeMode` and `fallbackMode`. Read-only operator configuration, not
user-editable.

### `GET /api/preferences`  *(GitHub sign-in required)*

The signed-in account's settings, with defaults filled in:

```json
{ "preferences": { "login": "octocat", "voiceConfirmation": true,
  "draftReview": false, "includeTelemetry": true,
  "transcriptPreference": "auto", "updatedAt": "…" } }
```

### `PATCH /api/preferences`  *(GitHub sign-in required)*

Updates any subset of the above. These are read back by the pipeline, not just the UI:
`voiceConfirmation: false` suppresses the spoken reply; `draftReview: true` keeps finished
reports in the dashboard instead of filing to GitHub; `includeTelemetry: false` keeps
captured console output, page errors and click breadcrumbs out of the drafted issue body;
`transcriptPreference: "voice"` re-transcribes the recording on the server instead of
trusting the browser text.

Unknown fields are discarded rather than stored, so a caller cannot grant itself a plan or
inject a value through this endpoint. An unrecognised `transcriptPreference` falls back to
`"auto"`.

## Auth (GitHub login)

Free GitHub OAuth App, scope `repo`. It serves two purposes: it unlocks the user's
**private** repos for indexing, and it is the **publishing identity** — every filed issue is
created with the project owner's own token, so the GitHub author of the issue is the
developer who owns the project.

Until `GITHUB_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_SECRET` are set, these endpoints
answer `404 not configured` (except `/api/auth/me`, which answers `{ "user": null }`).
Dashboard access is unaffected: it requires either the operator key (when configured) or a
login.

### `GET /api/auth/github`

Starts the login: `302` redirect to `github.com/login/oauth/authorize` (`repo` scope,
single-use `state` with a 10-minute TTL). Register the callback URL
`<APP_BASE_URL>/api/auth/github/callback` on the OAuth App.

### `GET /api/auth/github/callback?code=…&state=…`

Exchanges the one-time code server-side (the client secret never leaves the server),
creates a session, sets the HttpOnly `gv_session` cookie, and redirects to
`/dashboard/projects?github=connected` (or `?github=error`).

### `GET /api/auth/me`

`{ "user": { "login": "octocat", "id": 1, "avatarUrl": "…", "profileUrl": "…" } }` or
`{ "user": null }`.

### `POST /api/auth/logout`

Destroys the session and clears the cookie. `{ "ok": true }`.

### `GET /api/repos`  *(login required)*

The user's repos for the project picker, newest first (max 100):
`{ "repos": [ { "fullName": "owner/repo", "isPrivate": true, "defaultBranch": "main" } ],
"plan": "freelancer", "publicOnly": false }`. Without the private-repos entitlement the
dropdown lists only public repositories; a pasted private repository is still rejected by
the plan gate on create/index. `401` when logged out, `404` when OAuth is not configured,
`502` when GitHub is unreachable.

### Token precedence

Publishing and indexing use **only** the logged-in project owner's OAuth token, resolved
server-side from their session. Public repos still index without any token; publishing
without an owner sign-in degrades to a dashboard draft with the reason recorded. The
server-wide `GITHUB_TOKEN` is never used for either, so the operator's credentials cannot
be aimed at a repository by anyone else.

## Webhook

### `POST /api/webhook/gh-push`

GitHub `push` receiver. `404` unless `GITHUB_WEBHOOK_SECRET` is set; `401` unless the
`X-Hub-Signature-256` header is a valid HMAC-SHA256 of the raw body (constant-time
compare). Only pushes to the repository's default branch trigger re-indexing of the project
mapped to that `owner/repo`. Automatic re-indexing is a paid capability: without the
auto-reindex entitlement the push is acknowledged and the index is left empty with the
upgrade reason returned.

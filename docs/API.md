# REST API

All endpoints are served by the single backend on the deployment origin. JSON in/out
unless noted.

## Access model

Report data (transcripts, telemetry, audio, project inventory) is private. There are
two ways to reach it, and nothing else:

| Caller | How | Sees |
|---|---|---|
| **operator** | `Authorization: Bearer <DASHBOARD_TOKEN>` | every project and report |
| **owner** | GitHub login (HttpOnly session cookie) | only projects stamped with their own GitHub login, plus the bundled demo project |

Anonymous requests to any dashboard route return **401**. This is fail-closed: it
holds even when `DASHBOARD_TOKEN` is unset, because that variable only controls
whether the *operator override* exists.

`POST /api/issue` (the widget) requires sign-in too, and additionally requires that the
caller owns the target project. Layered limits still apply on top: per-IP rate limiting
and an hourly hosted-model-capacity guard that degrades to the offline engine rather
than exhausting the operator's quota.

> **Cross-origin caveat.** The session cookie is `SameSite=Lax`, so a report filed from a
> *third-party* staging site will not carry it. In that deployment the widget's owner has
> to be signed in on that browser. Same-origin use (your own dashboard, the demo
> storefront) works with the cookie as normal.

### `POST /api/projects`  *(operator or GitHub login)*

`{ "name": "Acme staging", "repoFullName": "owner/repo" }` → `201` + project. The repo
may be an `owner/repo` string or a GitHub URL; stored normalized. The creating user's
GitHub login is stored as the project's `ownerLogin` and becomes the identity used for
every later index/publish action on that project.

### `POST /api/projects/:id/index`  *(operator or that project's owner)*

Rebuilds the architecture index. Body `{ "repoFullName": "owner/repo" }` overrides the
stored repo; the bundled demo project always re-indexes from its built-in fixture.
Public repos are fetched as tarballs (no git binary, no API quota; 40 MB cap); private
repos use the owner's token. Returns `{ project, filesWalked, filesIndexed, embedder }`.
`502` with the reason on failure.

## Service

### `GET /health`

Liveness probe for platforms.

```json
{ "ok": true, "service": "git-voice", "version": "1.0.0", "time": "2026-10-15T12:00:00.000Z" }
```

## Issues

### `POST /api/issue`  *(operator, or a signed-in owner of that project)*

Files a report. Accepts `multipart/form-data` (widget submissions with audio) or
`application/json`. `401` when anonymous; `401` when signed in but not the owner of
`projectId`.

Form/JSON fields:

| Field | Type | Notes |
|---|---|---|
| `projectId` | string | required; must exist |
| `transcript` | string | optional |
| `transcriptSource` | `"browser-speech" \| "typed-report" \| "telemetry-only"` | optional |
| `telemetry` | JSON string | see schema below |
| `audio` | file (multipart only) | ≤ 10 MB, webm/ogg/mp4 |

Telemetry object (all trimmed server-side):

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

The request runs the full seven-station pipeline synchronously and returns `201`:

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

Errors: `400` (missing/bad payload), `429` (rate limited, includes `Retry-After`),
`500`.

### `GET /api/issues?projectId=…`  *(operator or owner)*

Newest-first list of issue records (audio payloads stripped), **scoped to the caller**.
`projectId` filters within the caller's visible projects.

### `GET /api/issues/:id`  *(operator or owner)*

Single record, same shape as list elements.

### `GET /api/issues/:id/audio`  *(operator or owner)*

Streams the attached report audio (`Content-Type`: recorded mime, `Cache-Control:
private, no-store`). Requires the `Authorization` header — the dashboard fetches it as
a blob and plays it from an object URL. `404` when the report has no audio or it was
trimmed.

### `GET /api/issues/:id/body.md`  *(operator or owner)*

The drafted issue body as `text/markdown` — exactly what publishing would send.

## Projects

### `GET /api/projects`  *(operator or owner)*

Projects visible to the caller, with index status, count, embedder id.

### `GET /api/projects/:id`  *(operator or owner)*

Single project.

### `GET /api/projects/:id/search?q=…&route=…`  *(operator or owner)*

Runs a hybrid query against the project's index (useful for demos and debugging):

```json
{ "query": "coupon checkout", "backend": "…", "matches": [ { "filePath": "…", "score": 0.91 } ] }
```

## Settings

### `GET /api/settings`

Machine-readable integration health for the dashboard's Settings tab:

```json
{ "baseUrl": "https://…", "integrations": [
  { "id": "llm", "label": "Issue drafting", "envKey": "GOOGLE_API_KEY",
    "configured": false, "activeMode": "…", "fallbackMode": "…" } ] }
```

The `github` row reports whether the OAuth env keys are set; the `auth` row reports
whether the operator key exists.

## Auth (GitHub login, optional)

Free GitHub OAuth App. It serves two purposes: it unlocks the user's **private** repos
for indexing, and it is the **publishing identity** — every filed issue is created with
the project owner's own token, so the GitHub author of the issue is the developer who
owns the project. The server-wide `GITHUB_TOKEN` is deliberately *not* used for
publishing; with no owner sign-in, the report stays a dashboard draft and the dashboard
shows why.

Until `GITHUB_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_SECRET` are set, these endpoints
answer `404 not configured` (except `/api/auth/me`, which answers `{ "user": null }`).
Dashboard access is unaffected: it requires either the operator key or a login.

### `GET /api/auth/github`

Starts the login: `302` redirect to `github.com/login/oauth/authorize`
(`repo` scope, single-use `state`). Register the callback URL
`<APP_BASE_URL>/api/auth/github/callback` on the OAuth App.

### `GET /api/auth/github/callback?code=…&state=…`

Exchanges the one-time code server-side (the secret never leaves the
server), creates a session, sets the HttpOnly `gv_session` cookie, and
redirects to `/dashboard/projects?github=connected` (or `?github=error`).

### `GET /api/auth/me`

`{ "user": { "login": "octocat", "id": 1 } }` or `{ "user": null }`.

### `POST /api/auth/logout`

Destroys the session and clears the cookie. `{ "ok": true }`.

### `GET /api/repos`  *(login required)*

The user's repos (private included), newest first (max 100):
`{ "repos": [ { "fullName": "owner/repo", "isPrivate": true,
"defaultBranch": "main" } ] }`. `401` when logged out.

Token precedence for publishing and indexing: **only** the logged-in project owner's
OAuth token. Public repos still index without any token; publishing without an owner
sign-in degrades to a dashboard draft. The server-wide `GITHUB_TOKEN` is never used for
either, so the operator's credentials cannot be aimed at a repository by anyone else.

## Webhook

### `POST /api/webhook/gh-push`

GitHub `push` receiver. `404` unless `GITHUB_WEBHOOK_SECRET` is set; `401` unless the
`X-Hub-Signature-256` header is a valid HMAC-SHA256 of the raw body (constant-time
compare). Only pushes to the repository's default branch trigger re-indexing of the
project mapped to that `owner/repo`.

# REST API

All endpoints are served by the single backend on the deployment origin. JSON in/out
unless noted. Mutating dashboard routes accept an optional
`Authorization: Bearer <DASHBOARD_TOKEN>` — required when `DASHBOARD_TOKEN` is set on
the server, open otherwise.

## Service

### `GET /health`

Liveness probe for platforms.

```json
{ "ok": true, "service": "git-voice", "version": "1.0.0", "time": "2026-10-15T12:00:00.000Z" }
```

## Issues

### `POST /api/issue`

Files a report. Accepts `multipart/form-data` (widget submissions with audio) or
`application/json`.

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

### `GET /api/issues?projectId=…`

Newest-first list of issue records (audio payloads stripped). `projectId` filters.

### `GET /api/issues/:id`

Single record, same shape as list elements.

### `GET /api/issues/:id/audio`

Streams the attached report audio (`Content-Type`: recorded mime). `404` when the
report has no audio or it was trimmed.

### `GET /api/issues/:id/body.md`

The drafted issue body as `text/markdown` — exactly what publishing would send.

## Projects

### `GET /api/projects`

All projects with index status, count, embedder id.

### `POST /api/projects`  *(token required when configured)*

`{ "name": "Acme staging", "repoFullName": "owner/repo" }` → `201` + project. The repo
may be an `owner/repo` string or a GitHub URL; stored normalized.

### `GET /api/projects/:id`

Single project.

### `POST /api/projects/:id/index`  *(token required when configured)*

Rebuilds the architecture index. Body `{ "repoFullName": "owner/repo" }` overrides the
stored repo; the bundled demo project always re-indexes from its built-in fixture.
Public repos are fetched as tarballs (no git binary, no API quota; 40 MB cap). Returns
`{ project, filesWalked, filesIndexed, embedder }`. `502` with the reason on failure.

### `GET /api/projects/:id/search?q=…&route=…`

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

The `github-login` row reports whether the OAuth env keys are set.

## Auth (GitHub login, optional)

Free GitHub OAuth App. Logged-out users keep full access to public repos;
logging in additionally unlocks the user's private repos for indexing and
issue filing. Until `GITHUB_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_SECRET`
are set, these endpoints answer `404 not configured` (except `/api/auth/me`,
which answers `{ "user": null }`) and the PAT flow keeps working unchanged.

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

Token precedence for publishing/indexing: the logged-in project owner's
OAuth token first, then the server `GITHUB_TOKEN`, then a dashboard draft
(public indexing needs no token at all).

## Webhook

### `POST /api/webhook/gh-push`

GitHub `push` receiver. `404` unless `GITHUB_WEBHOOK_SECRET` is set; `401` unless the
`X-Hub-Signature-256` header is a valid HMAC-SHA256 of the raw body (constant-time
compare). Only pushes to the repository's default branch trigger re-indexing of the
project mapped to that `owner/repo`.

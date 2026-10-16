# Deployment

Git-Voice ships as a single multi-stage Docker image: one Node process serves the SPA,
the widget bundle, and the API. It is sized to fit a 512 MB / 0.1 CPU free-tier web
service comfortably (audio processes streaming; embeddings batch 20/request).

## What runs where

| Stage | Output |
|---|---|
| 1. frontend build | `src/frontend/dist` (dashboard SPA) + `dist-widget/widget.js` (embeddable bundle) |
| 2. backend build | `src/backend/dist` (compiled TypeScript) |
| 3. runtime | prod dependencies + both dist trees; starts with `node src/backend/dist/index.js` |

The container listens on `PORT` (default `10000`). Health check: `GET /health`.
The server serves hashed SPA assets with immutable caching, the widget with a 1-hour
cache, and falls back to `index.html` for extension-less SPA routes.

## Render (blueprint included)

The repository ships `render.yaml`:

1. Push the repo and create a **New → Web Service → Blueprint** on your host account.
2. The blueprint marks secrets `sync: false` — fill them in the host dashboard, never
   in the file.
3. Deploy. `/health` is the health check path; the free tier sleeps after ~15 min idle
   and wakes on the next request.

### Required / optional environment

| Variable | Required? | Purpose |
|---|---|---|
| `GOOGLE_API_KEY` | optional | Server transcription, model drafting, hosted embeddings. Free tier from the provider's API key page — no credit card. Without it everything falls back offline. |
| `DATABASE_URL` | optional | PostgreSQL with the pgvector extension. Without it the index is in-process. |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | optional | Server-rendered confirmation audio. Unset = browser-native speech (always free, commercial-OK). |
| `GITHUB_TOKEN` | optional | Fine-grained PAT with **Issues: Read and write** on the target repo. Unset = issues stay dashboard drafts. |
| `GITHUB_DEFAULT_REPO` | optional | `owner/repo` fallback when a project has no repo set. |
| `GITHUB_WEBHOOK_SECRET` | optional | `openssl rand -hex 32`; enables push-triggered reindexing. |
| `DASHBOARD_TOKEN` | optional | Bearer token required for dashboard mutations. |
| `APP_BASE_URL` | optional | Public base URL, rendered in the widget snippet. |
| `DATA_DIR` | optional | Persists issue records + audio snapshots. |

Suggested free-tier database for the pgvector path: any Postgres host with the
`pgvector` extension available on a free plan. The schema (`git_voice_code_index`,
`git_voice_projects`) is created automatically at boot; no manual migration step.

## Enabling reindex-on-push

1. Set `GITHUB_WEBHOOK_SECRET` on the server (e.g. `openssl rand -hex 32`).
2. On the target repo: Settings → Webhooks → Add webhook.
   - URL: `https://your-deployment/api/webhook/gh-push`
   - Content type: `application/json`
   - Secret: the same value
   - Trigger: **push** events only
3. Every default-branch push re-downloads the tarball and rebuilds the project's index.

## Embedding the widget on a client's staging site

```html
<script src="https://your-deployment/api/widget.js" data-project-id="prj_xxxx"></script>
```

Create the project in the dashboard, copy the snippet shown on its card, and paste it
before `</body>` on the staging site. The widget exposes a single shadow-DOM
microphone button; it degrades to a typed-report box when no microphone is available.

## Operational notes

- **Cold starts:** free tiers sleep when idle; the widget allows ~75 s for wake-up and
  surfaces a retry message if it misses. A 5-minute uptime pinger on `/health` keeps
  the service warm for demos.
- **Rate limiting:** `/api/issue` is capped per IP (default 8 per 5 min) with
  `Retry-After` headers; tune via `config.limits` in `src/backend/src/config.ts`.
- **Secrets hygiene:** every key is read from the environment only; the Settings page
  shows which are present without revealing values. Never bake keys into images.

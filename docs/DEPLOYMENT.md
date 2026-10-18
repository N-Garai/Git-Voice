# Deployment

Git-Voice ships as a single multi-stage Docker image: one Node process serves the SPA,
the widget bundle, and the API. It is sized to fit a 512 MB / 0.1 CPU free-tier web
service comfortably (audio attaches in-memory after streaming upload; embeddings batch
20 texts per request).

## What runs where

| Stage | Output |
|---|---|
| 1. frontend build | `src/frontend/dist` (dashboard SPA) + `dist-widget/widget.js` (embeddable bundle) |
| 2. backend build | `src/backend/dist` (compiled TypeScript) |
| 3. runtime | prod dependencies + both dist trees; starts with `node src/backend/dist/index.js` |

The container listens on `PORT` (default `10000`). Health check: `GET /health`.
The server serves hashed SPA assets with immutable caching, the widget bundle with a
one-hour cache, and falls back to `index.html` for extension-less SPA routes.

## Hosting (blueprint included)

The repository ships `render.yaml` as a deploy blueprint:

1. Push the repository and create a **New → Web Service → Blueprint** on your hosting
   account.
2. The blueprint marks secrets `sync: false` — fill them in the hosting dashboard, never
   in the file.
3. Deploy. `/health` is the health check path; the free tier sleeps after ~15 min idle
   and wakes on the next request.

### Environment reference

| Variable | Required? | Purpose |
|---|---|---|
| `GOOGLE_API_KEY` | optional | Server transcription, model drafting, hosted embeddings. Free tier from the provider's API key page — no credit card. Without it everything falls back offline. |
| `GEMMA_MODEL_ID` | optional | Drafting model override (ships pinned to a current instruct model). |
| `TRANSCRIBE_MODEL_ID` | optional | Server audio-transcription model override (default `gemini-2.5-flash`). |
| `EMBEDDING_MODEL_ID` / `EMBEDDING_DIM` | optional | Embedding model and vector dimension for the index (default `gemini-embedding-001`, 768). |
| `DATABASE_URL` | optional | PostgreSQL with the pgvector extension. Without it the index, reports, sessions, billing and preferences run in-process (optionally backed by `DATA_DIR`). |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | optional | Server-rendered confirmation audio. Unset = browser-native speech (always free). |
| `GITHUB_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_SECRET` | strongly recommended | GitHub sign-in — required for dashboard access in a normal deployment and for filing issues at all. Free OAuth App. |
| `GITHUB_TOKEN` | optional | Server-wide automation token (raises the REST rate limit when set). Never used for publishing. |
| `GITHUB_DEFAULT_REPO` | optional | `owner/repo` fallback when a project has no repo set. |
| `GITHUB_WEBHOOK_SECRET` | optional | `openssl rand -hex 32`; enables push-triggered reindexing. |
| `DASHBOARD_TOKEN` | optional | Bearer key unlocking the operator view of every project. |
| `APP_BASE_URL` | optional | Public base URL, rendered in the widget snippet and used as the OAuth callback. Also the target of the production self-ping. |
| `KEEP_WARM` | optional | Set to `off` to disable the production self-ping (e.g. paid plan, dedicated box). |
| `SENTRY_DSN` | optional | Sentry project DSN — enables agent tracing of the triage pipeline (station spans, model calls with token usage + cost). Unset = tracing disabled, zero overhead. |
| `SENTRY_CONTENT` | optional | Set to `off` to keep transcripts and prompts off span attributes (latency/token data still recorded). |
| `SENTRY_TRACES_SAMPLE_RATE` | optional | Trace sample rate (default `1`). |
| `DATA_DIR` | optional | Persists report records + audio snapshots to disk. |

A suggested free-tier database for the pgvector path: any Postgres host with the
`pgvector` extension available on a free plan. The schema (`git_voice_code_index`,
`git_voice_projects`, `git_voice_sessions`, `git_voice_issues`, `git_voice_profiles`,
`git_voice_invoices`, `git_voice_preferences`) is created automatically at boot; no manual
migration step.

## Enabling reindex-on-push

1. Set `GITHUB_WEBHOOK_SECRET` on the server (e.g. `openssl rand -hex 32`).
2. On the target repo: Settings → Webhooks → Add webhook.
   - URL: `https://your-deployment/api/webhook/gh-push`
   - Content type: `application/json`
   - Secret: the same value
   - Trigger: **push** events only
3. Every default-branch push re-downloads the tarball and rebuilds the project's index.
   Automatic re-indexing is a paid capability (Freelancer plan and above).

## Embedding the widget on a client's staging site

```html
<script src="https://your-deployment/api/widget.js" data-project-id="prj_xxxx"></script>
```

Create the project in the dashboard, copy the snippet shown on its card, and paste it
before `</body>` on the staging site. The widget renders a single shadow-DOM microphone
button; it degrades to a typed-report box when no microphone is available. Note the
sign-in requirement in `docs/API.md`: the staging browser must be signed in, because the
session cookie is `SameSite=Lax`.

## Observability (agent tracing)

Set `SENTRY_DSN` (a Sentry project DSN) and every pipeline run reports as an agent trace:

- `invoke_agent voice-triage` — the whole run: latency, the incoming report, the drafted
  outcome, and whether the issue was published.
- `execute_tool <station>` — one tool span per engine station (ingest, transcribe, locate,
  correlate, draft, confirm, publish). Failed stations carry an error status and land in
  Sentry's tool-error views.
- `chat <model>` / `embeddings <model>` — every hosted model call with the provider,
  requested and responding model, finish reason, and token usage (input/output/total/cached
  tokens) straight from the provider's response — that is what drives the latency/tokens/
  cost breakdowns.
- Outbound HTTP calls (voice synthesis, GitHub publishing) appear as regular HTTP spans
  under the tool that made them.

All of it is a no-op without `SENTRY_DSN`: no SDK init, no spans, no behavior change.
`SENTRY_CONTENT=off` strips transcripts and prompts from attributes while keeping latency,
token and cost data.

## Operational notes

- **Keep-warm / cold starts:** free-tier web services sleep after ~15 minutes without
  inbound traffic and then need ~50 s to wake. The server handles this in production by
  pinging its own public `/health` every **13.5 minutes** (inside the idle window; disable
  with `KEEP_WARM=off`). The scheduled `keep-warm` GitHub Actions workflow
  (`*/14 * * * *`) pings the deployment as an outer safety net and also wakes a deployment
  that already fell asleep — fork hosts can point it elsewhere with the `KEEPALIVE_URL`
  repository variable. The widget additionally allows ~75 s for wake-up and surfaces a
  retry message if the server still misses.
- **Rate limiting:** `/api/issue` is capped per IP (8 reports per 5 minutes) with
  `Retry-After` headers; tune via `config.limits` in `src/backend/src/config.ts`.
- **Secrets hygiene:** every key is read from the environment only; the Settings page shows
  which are present without revealing values. Never bake keys into images.

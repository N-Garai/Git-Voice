# Architecture

Git-Voice is one Node process serving four things from a single origin:

| Surface | Path | Built by |
|---|---|---|
| Landing page + dashboard + demo storefront (SPA) | `/*` | `src/frontend` (Vite build → `src/frontend/dist`) |
| Embeddable widget bundle | `/api/widget.js` | `src/frontend/src/widget` (separate IIFE build → `dist-widget/widget.js`) |
| Triage REST API | `/api/*` | `src/backend` (Hono) |
| Liveness probe | `/health` | `src/backend` |

Boot order: observability init → env config → vector index (Postgres+pgvector or
in-process) → hydration of reports, sessions, billing profiles and preferences → demo
project seed + indexed → HTTP listener. `src/backend/src/index.ts` is the entrypoint.

## The seven-station pipeline

`src/backend/src/workflow/issueWorkflow.ts` — every station runs in order, writes a live
trace into the report record (visible in the dashboard), and **degrades instead of
aborting**. A failed model call falls back to the deterministic engine; a missing owner
token leaves the issue as a dashboard draft with the reason recorded. The pipeline
therefore completes end-to-end with zero configuration.

| Station | What runs | Without keys |
|---|---|---|
| 1. Ingest | Normalize telemetry (cap console/errors/clicks buffers), create record | full |
| 2. Transcribe | Browser-captured transcript, else hosted audio STT | transcript comes from the browser's speech recognition or a typed report |
| 3. Locate | Hybrid search (vector cosine + BM25 + route/error boosts, RRF-fused) over the project's index | works fully offline with the hashed vectorizer |
| 4. Correlate | Scan captured console/error text against indexed error codes and symbols | pure TypeScript, no external calls |
| 5. Draft | Hosted instruct model with a strict JSON contract, else deterministic synthesizer | deterministic engine emits a structured, evidence-traceable report |
| 6. Confirm | Server-rendered TTS mp3, else `spokenText` for browser speech synthesis | browser-native Web Speech (always free) |
| 7. Publish | `POST /repos/{owner}/{repo}/issues` with labels, using the project owner's OAuth token | issue remains a dashboard draft with the reason recorded |

Station order notes: confirm runs **last** (after publish) so the spoken confirmation can
name the real issue number when one was filed. Draft runs the offline synthesizer first and
keeps its output as the constraint envelope — the model's JSON is validated field-by-field
against it (`coerceDraft`), so malformed model output downgrades cleanly instead of
corrupting the report.

## Gate layers around the hosted model

Three independent checks decide whether station 2/5/6 use hosted calls or the offline
fallbacks:

1. **Configuration** — `GOOGLE_API_KEY` set or not (`llmConfigured()`).
2. **Capacity** — the hourly hosted-budget valve (`routes/quota.ts`): 120 hosted calls per
   hour process-wide, at most 25% claimable by anonymous traffic. Exhausted capacity
   degrades to the offline engine rather than erroring.
3. **Entitlements** — the owner's plan tier gates hosted drafting and premium voice per
   report (`billing/billing.ts` entitlements read at submit time).

On top of these, per-IP rate limiting (`routes/rateLimit.ts`: 8 reports per 5 minutes,
`Retry-After` on breach) protects the endpoint itself.

## Key modules

| Module | Role |
|---|---|
| `src/backend/src/indexer/` | Tarball fetch (`tar.ts` — minimal ustar reader, no git binary), signature extraction (`chunk.ts`), indexing orchestration (`indexProject.ts`), the bundled demo storefront (`fixtures.ts`) |
| `src/backend/src/store/` | Vector index with two interchangeable backends (`vectorIndex.ts`), project registry (`projects.ts`), report records + audio attach (`issues.ts`), GitHub-login sessions (`sessions.ts`), authorisation + tenant scoping (`access.ts`), account preferences (`preferences.ts`) |
| `src/backend/src/billing/` | Plans, entitlements, simulated checkout, invoices, plan expiry (`billing.ts`) |
| `src/backend/src/services/` | Hosted model REST client (`gemini.ts`), embedding layer with offline fallback (`embeddings.ts`), deterministic triage engine (`heuristic.ts`), issue-body + spoken-text assembly (`spoken.ts`), TTS (`elevenlabs.ts`), GitHub REST/OAuth/webhook HMAC (`github.ts`), Sentry agent tracing (`sentry.ts`) |
| `src/backend/src/workflow/` | Minimal typed step engine (`engine.ts`) + the seven-station pipeline (`issueWorkflow.ts`) |
| `src/backend/src/routes/` | REST surface (`api.ts`), per-IP rate limiter (`rateLimit.ts`), hosted-capacity valve (`quota.ts`), telemetry schema (`schemas.ts`) |
| `src/frontend/src/widget/` | The dependency-free IIFE widget: shadow DOM, MediaRecorder + analyser waveform, browser speech recognition, typed-report fallback, 30 s cap, confirmation player |

## Degradation matrix

| Layer | Primary | Fallback | Switch |
|---|---|---|---|
| Transcription | hosted audio STT | browser speech / typed report | unset `GOOGLE_API_KEY`, or browser transcript available |
| Drafting | hosted instruct model | deterministic offline engine | unset `GOOGLE_API_KEY`, quota exhausted, or Hobby tier |
| Embeddings | hosted embedding API | deterministic hashed vectors | unset `GOOGLE_API_KEY`, or API failure at index time |
| Vector store | PostgreSQL + pgvector | in-process hybrid index | unset `DATABASE_URL`, or any DB error |
| Voice confirmation | server-rendered mp3 | browser speech synthesis | unset `ELEVENLABS_API_KEY`, Hobby tier, or synthesis failure |
| Publishing | GitHub Issues API with the owner's OAuth token | dashboard draft with reason | no `owner/repo` set, owner not signed in, draft review on, or API rejection |

No layer is load-bearing on a single vendor. Every fallback runs the same pipeline shape, so
behavior (and the issue body) stays identical regardless of configuration.

## Data model

- **projects** — id (`prj_*`), name, optional `owner/repo`, the owning GitHub login, index
  status, embedder id.
- **code index entries** — per file: path, component name, route, exported symbols, error
  enums, class names, textual signature, embedding vector, embedder id.
- **issues** — one record per report: telemetry, transcript + source, per-station trace,
  audio attachment (capped to the most recent reports), and the final result (draft, index
  matches, correlations, models used per station, spoken confirmation, publish result).
- **sessions** — opaque 256-bit ids; the OAuth token lives server-side only.
- **billing profiles + invoices** — tier per login, current period, decline-at-period-end
  flag, and masked-instrument receipts.
- **preferences** — per-login report behaviour (voice on/off, draft review, telemetry
  inclusion, transcript preference).

Runtime store is in-process with optional persistence: Postgres mirrors for reports, index,
sessions, billing and preferences when `DATABASE_URL` is set; an additional
`DATA_DIR` snapshot (records + audio on disk) for deployments without a database. Keeps the
reports directory from emptying across free-tier restarts in both cases.

# Architecture

Git-Voice is one Node process serving four things from a single origin:

| Surface | Path | Built by |
|---|---|---|
| Landing page + dashboard + demo storefront (SPA) | `/*` | `src/frontend` (Vite build → `src/frontend/dist`) |
| Embeddable widget bundle | `/api/widget.js` | `src/frontend/src/widget` (separate IIFE build → `dist-widget/widget.js`) |
| Triage REST API | `/api/*` | `src/backend` (Hono) |
| Liveness probe | `/health` | `src/backend` |

Boot order: env config → vector index (Postgres+pgvector or in-process) → demo project
seed + indexed → HTTP listener. `src/backend/src/index.ts` is the entrypoint.

## The seven-station pipeline

`src/backend/src/workflow/issueWorkflow.ts` — every station runs in order, writes a live
trace into the issue record (visible in the dashboard), and **degrades instead of
aborting**. A failed model call falls back to the deterministic engine; a missing token
leaves the issue as a dashboard draft. The pipeline therefore completes end-to-end with
zero configuration.

| Station | What runs | Without keys |
|---|---|---|
| 1. Ingest | Normalize telemetry (cap console/errors/clicks buffers), create record | full |
| 2. Transcribe | Browser-captured transcript, else hosted audio STT | transcript comes from the browser's speech recognition or a typed report |
| 3. Locate | Hybrid search (vector cosine + BM25 + route/error boosts, RRF-fused) over the project's index | works fully offline with the hashed vectorizer |
| 4. Correlate | Regex-scan captured console/error text against indexed error codes and symbols | pure TypeScript, no external calls |
| 5. Draft | Hosted instruct model with strict JSON contract, else deterministic synthesizer | deterministic engine emits a structured, evidence-traceable report |
| 6. Confirm | Server-rendered TTS mp3, else `spokenText` for browser speech synthesis | browser-native Web Speech (always free) |
| 7. Publish | `POST /repos/{owner}/{repo}/issues` with labels | issue remains a dashboard draft with the reason recorded |

## Key modules

| Module | Role |
|---|---|
| `src/backend/src/indexer/` | Tarball fetch (`tar.ts` — minimal ustar reader, no git binary), signature extraction (`chunk.ts`), indexing orchestration (`indexProject.ts`), the bundled demo storefront (`fixtures.ts`) |
| `src/backend/src/store/` | Vector index with two interchangeable backends (`vectorIndex.ts`), project registry (`projects.ts`), issue records + audio attach (`issues.ts`) |
| `src/backend/src/services/` | Hosted model REST client (`gemini.ts`), embedding layer with offline fallback (`embeddings.ts`), deterministic triage engine (`heuristic.ts`), issue-body + spoken-text assembly (`spoken.ts`), TTS (`elevenlabs.ts`), GitHub issues + webhook HMAC (`github.ts`) |
| `src/backend/src/workflow/` | Minimal typed step engine (`engine.ts`) + the seven-station pipeline (`issueWorkflow.ts`) |
| `src/backend/src/routes/` | REST surface (`api.ts`), per-IP rate limiter (`rateLimit.ts`), telemetry schema (`schemas.ts`) |
| `src/frontend/src/widget/` | The dependency-free IIFE widget: shadow DOM, MediaRecorder + analyser waveform, browser speech recognition, typed-report fallback, 30 s cap, confirmation player |

## Degradation matrix

| Layer | Primary | Fallback | Switch |
|---|---|---|---|
| Transcription | hosted audio STT | browser speech / typed report | unset `GOOGLE_API_KEY` |
| Drafting | hosted instruct model | deterministic offline engine | unset `GOOGLE_API_KEY` |
| Embeddings | hosted embedding API | deterministic hashed vectors | unset `GOOGLE_API_KEY` |
| Vector store | PostgreSQL + pgvector | in-process hybrid index | unset `DATABASE_URL` |
| Voice confirmation | server-rendered mp3 | browser speech synthesis | unset `ELEVENLABS_API_KEY` |
| Publishing | GitHub Issues API | dashboard draft | unset `GITHUB_TOKEN` |

No layer is load-bearing on a single vendor. Every fallback runs the same pipeline shape,
so behavior (and the issue body) stays identical regardless of configuration.

## Data model

- **projects** — id (`prj_*`), name, optional `owner/repo`, index status, embedder id.
- **code index entries** — per file: path, component name, route, exported symbols,
  error enums, class names, textual signature, embedding vector, embedder id.
- **issues** — one record per report: telemetry, transcript + source, per-station trace,
  audio attachment (capped to the most recent reports), and the final result (draft,
  index matches, correlations, models used per station, spoken confirmation, publish
  result).

Runtime store is in-process with optional persistence (`DATA_DIR` snapshot; Postgres
mirror when `DATABASE_URL` is set).

# Git-Voice

> Turn non-technical client complaints into reproducible GitHub issues — voice in, engineering out.

Git-Voice is a self-hostable triage service for freelance developers. A client clicks one
floating button on a staging site, speaks for up to 30 seconds about what is broken, and an
engineering-grade GitHub issue lands in the repository — title, severity, expected vs. actual
behavior, numbered reproduction steps, the suspected file, and the client's console errors
attached. The client hears a spoken confirmation before closing the widget. The developer
opens their dashboard with zero follow-up questions.

**No forms. No severity pickers. No "which browser are you using?"**

## Why it exists

Every freelancer knows the email:

> "The site is broken, fix it asap."

That sentence costs two unpaid hours of detective work: which browser, which route, what was
clicked, what the console said. Git-Voice removes the round trips by capturing the real
evidence at the moment of frustration — the client's own voice, the browser's console output,
the click breadcrumbs, the viewport, the user agent — and synthesizing it into the issue a
maintainer would have written anyway.

## How it works

```
 client speaks on the staging site
        │  (floating widget, one <script> tag)
        ▼
 ┌─────────────────────────────────────────────┐
 │  INGEST    record audio + capture telemetry │
 │  TRANSCRIBE browser or server speech-to-text│
 │  LOCATE    hybrid search of the repo index  │  ← Smart Architecture Index
 │  CORRELATE console errors ↔ error codes     │
 │  DRAFT     structured issue synthesis       │
 │  CONFIRM   spoken reply to the client       │
 │  PUBLISH   GitHub API (or dashboard draft)  │
 └─────────────────────────────────────────────┘
        ▼
 github.com/your-org/your-repo/issues  +  the dashboard issue log
```

Every external integration **degrades instead of aborting**. The server boots and runs the
entire pipeline with **zero API keys** — the widget captures browser-native speech, a
deterministic offline engine drafts the issue, and reports are kept as dashboard drafts
instead of being pushed to GitHub. Adding a key upgrades exactly one station of the pipeline.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The Smart Architecture Index

Git-Voice does **not** embed raw source code. Indexing extracts a compact signature per file —
component names, exported symbols, thrown error codes, route literals, UI class names — and
embeds that with either a hosted embedding API or a deterministic offline vectorizer.
Retrieval is hybrid: vector cosine + BM25 keyword, fused with Reciprocal Rank Fusion
(following the standard RRF formulation introduced by Cormack, Clarke and Buettcher at
SIGIR 2009), in-process or on PostgreSQL + pgvector. Details in [docs/INDEXING.md](docs/INDEXING.md).

## Quickstart

```bash
npm install
npm run build
npm start          # serves everything on http://localhost:10000
```

Or for development with hot reload:

```bash
npm run dev        # backend :10000 + frontend :5173, run concurrently
```

| URL | What it is |
|---|---|
| `/` | Product landing page |
| `/demo` | A deliberately-broken demo storefront with the widget installed — the fastest way to experience the whole flow |
| `/dashboard` | Issue log, projects, and integration health |
| `/api/widget.js` | The embeddable widget bundle |
| `/health` | Liveness probe |

**Note on access:** dashboard reads and report filing both require a GitHub sign-in (or the
operator key, if configured). See [docs/API.md](docs/API.md) for the full access model.

### Try the demo

1. Open `/demo` — a staging storefront with a planted coupon bug.
2. Click the floating microphone, tap **"Prefer typing?"** on the report card, and submit the
   suggested complaint (or speak it).
3. Watch the confirmation card: issue title, suspected file, spoken confirmation.
4. Open `/dashboard`: the report is there with the full seven-step trace, index matches,
   transcript, and raw markdown body.

## Embed the widget on a real staging site

```html
<script src="https://your-git-voice-host/api/widget.js" data-project-id="prj_xxxx"></script>
```

Create the project (and get its id) in the dashboard's **Projects** tab. Add an optional
`owner/repo` to the project to enable GitHub publishing and push-triggered re-indexing.

## Configuration

The server runs with zero configuration. Every key is optional (see [.env.example](.env.example)):

| Variable | Upgrades |
|---|---|
| `GOOGLE_API_KEY` | Server-side transcription + model drafting + hosted embeddings. Free tier, no credit card. |
| `DATABASE_URL` | PostgreSQL + pgvector persistence for the architecture index, reports, sessions and billing profiles. |
| `ELEVENLABS_API_KEY` | Server-rendered speech audio for the client confirmation (unset = browser speech, always free). |
| `GITHUB_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_SECRET` | GitHub sign-in. Required to use the app: it unlocks private repos per user and makes each developer the publishing identity of their own issues. |
| `GITHUB_TOKEN` | Optional server-side automation path (raises the REST rate limit when set). Never used to file issues — publishing always uses the project owner's own OAuth token. |
| `GITHUB_WEBHOOK_SECRET` | Push webhook that re-indexes a project on every default-branch commit. |
| `DASHBOARD_TOKEN` | Adds an operator key that sees every project. Generate with `openssl rand -hex 32`. |
| `DATA_DIR` | Persists issue records + audio to disk. |
| `SENTRY_DSN` | Agent-tracing of every pipeline run (spans, token usage, cost). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). |

Reports, transcripts, telemetry and audio are private: only the project owner (or the
operator key) can read them, and every filed issue is created with the owner's own GitHub
identity — never with a server-wide credential.

Health of every integration is visible in the dashboard's **Settings** tab and via
`GET /api/settings`.

## Deploy (single container, free-tier friendly)

One Node process serves the landing page, the dashboard, the widget bundle, and the API —
built for platforms that run a Dockerfile (512 MB / 0.1 CPU fits comfortably):

```bash
docker build -t git-voice .
```

A [render.yaml](render.yaml) blueprint is included: create a **Web Service** from the repo,
review the `sync: false` secrets (set them in the hosting dashboard, never in the file), and
deploy. Health check: `/health`. Details in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Development

```bash
npm run dev        # backend :10000 + frontend :5173 concurrently
npm run typecheck  # strict TypeScript across both workspaces
npm test           # vitest unit tests (tar reader, signature extractor, embeddings, indexer coverage)
npm run build      # frontend + widget + backend production builds
```

CI runs typecheck, tests and build on every push and pull request
([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The seven-station pipeline, every module, degradation paths |
| [docs/API.md](docs/API.md) | The full REST contract for `/api/*`, access model, billing and auth |
| [docs/INDEXING.md](docs/INDEXING.md) | How the Smart Architecture Index is built, embedded and queried |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hosting walkthrough, env vars, keep-warm, webhook setup, observability |

## Security notes

- The widget renders inside a scoped shadow DOM; host page styles never collide.
- **Authentication is required.** Every dashboard read and every report filing needs a
  GitHub sign-in (or the operator key, when configured); anonymous callers get `401`. Reads
  are scoped to the caller's own projects, so one developer can never see another's
  transcripts, telemetry or audio — except the bundled demo, which is shared showcase
  content for signed-in visitors.
- **Publishing identity is per-owner.** Issues are created with the project owner's own
  OAuth token, so the GitHub author is the developer who owns the project. The server-wide
  `GITHUB_TOKEN` is deliberately not consulted for publishing or indexing, and no one can
  point the operator's credentials at a repository by typing its name into a form.
- The operator key is compared in constant time; session ids are 256-bit random values held
  in `HttpOnly; SameSite=Lax` (`Secure` on HTTPS origins) cookies; OAuth states and codes
  are single-use with a 10-minute TTL.
- The hosted-model quota is protected by layered guards: per-IP rate limiting (8 reports per
  5 minutes, `Retry-After` included) plus an hourly capacity valve that degrades to the
  offline engine instead of exhausting the quota.
- A report is capped at 30 s of audio (10 MB upload ceiling); console, error and click
  buffers are capped as well.
- Telemetry shown in the GitHub body is exactly what was captured — nothing is invented, no
  secrets ride along.
- Webhook verification uses constant-time HMAC-SHA256 comparison.
- Known limitation: because the session cookie is `SameSite=Lax`, a report filed from a
  third-party staging site does not carry a session. In that deployment the widget's owner
  must be signed in on that browser.
- Payments are simulated end to end: checkout validates instruments (Luhn for cards, shape
  for UPI handles) and issues receipts, but no processor is contacted and no card data is
  ever stored — only a masked label survives.

## License

Apache-2.0 — see [LICENSE](LICENSE).

### `WindowState`

`WindowState` — Documents WindowState (interface) — e.g. under the API or configuration section.


### `windows`

`windows` — Documents windows (const) — e.g. under the API or configuration section.


### `TarEntry`

`TarEntry` — Documents TarEntry (interface) — e.g. under the API or configuration section.


### `checkRateLimit`

`checkRateLimit` — Documents checkRateLimit (function) — e.g. under the API or configuration section.


### `FileSignature`

`FileSignature` — Documents FileSignature (interface) — e.g. under the API or configuration section.


### `IndexRunResult`

`IndexRunResult` — Documents IndexRunResult (interface) — e.g. under the API or configuration section.


### `Tier`

`Tier` — Documents Tier (type) — e.g. under the API or configuration section.


### `BLOCK`

`BLOCK` — Documents BLOCK (const) — e.g. under the API or configuration section.


### `QuotaClass`

`QuotaClass` — Documents QuotaClass (type) — e.g. under the API or configuration section.


### `Entitlement`

`Entitlement` — Documents Entitlement (type) — e.g. under the API or configuration section.


### `parseOctal`

`parseOctal` — Documents parseOctal (function) — e.g. under the API or configuration section.


### `MAX_FILES_PER_RUN`

`MAX_FILES_PER_RUN` — Documents MAX_FILES_PER_RUN (const) — e.g. under the API or configuration section.


### `QuotaDecision`

`QuotaDecision` — Documents QuotaDecision (interface) — e.g. under the API or configuration section.


### `buildEntries`

`buildEntries` — Documents buildEntries (function) — e.g. under the API or configuration section.


### `PlanSpec`

`PlanSpec` — Documents PlanSpec (interface) — e.g. under the API or configuration section.


### `readString`

`readString` — Documents readString (function) — e.g. under the API or configuration section.


### `Window`

`Window` — Documents Window (interface) — e.g. under the API or configuration section.


### `EXTENSIONLESS_FILES`

`EXTENSIONLESS_FILES` — Documents EXTENSIONLESS_FILES (const) — e.g. under the API or configuration section.


### `main`

`main` — Documents main (function) — e.g. under the API or configuration section.


### `gunzipTar`

`gunzipTar` — Documents gunzipTar (function) — e.g. under the API or configuration section.


### `WINDOW_MS`

`WINDOW_MS` — Documents WINDOW_MS (const) — e.g. under the API or configuration section.


### `clientIp`

`clientIp` — Documents clientIp (function) — e.g. under the API or configuration section.


### `DOTFILE_PATTERNS`

`DOTFILE_PATTERNS` — Documents DOTFILE_PATTERNS (const) — e.g. under the API or configuration section.


### `readTar`

`readTar` — Documents readTar (function) — e.g. under the API or configuration section.


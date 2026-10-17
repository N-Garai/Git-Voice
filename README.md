# Git-Voice

> Turn non-technical client complaints into reproducible GitHub issues — voice in, engineering out.

Git-Voice is a small, deployable service for freelance developers. A client clicks one
floating button on a staging site, speaks for up to 30 seconds about what's broken, and
an engineering-grade GitHub issue lands in the repository — title, severity, expected vs.
actual behavior, numbered reproduction steps, the suspected file, and the client's
console errors attached. The client hears a spoken confirmation before they close the
widget. The developer opens their dashboard with zero follow-up questions.

**No forms. No severity pickers. No "which browser are you using?"**

## Why

Every freelancer knows the email:

> "The site is broken, fix it asap."

That sentence costs two unpaid hours of detective work: which browser, which route, what
was clicked, what the console said. Git-Voice removes the round trips by capturing the
real evidence at the moment of frustration — the client's own voice, the browser's
console output, the click breadcrumbs, the viewport, the user agent — and synthesizing
it into the issue a maintainer would have written anyway.

## How it works

```
 client speaks on the staging site
        │  (floating widget, one <script> tag)
        ▼
 ┌─────────────────────────────────────────────┐
 │  INGEST    record audio + capture telemetry │
 │  TRANSCRIBE browser or server speech-to-text│
 │  LOCATE    hybrid search of your repo index │  ← Smart Architecture Index
 │  CORRELATE console errors ↔ error codes     │
 │  DRAFT     structured issue synthesis       │
 │  CONFIRM   spoken reply to the client       │
 │  PUBLISH   GitHub API (or dashboard draft)  │
 └─────────────────────────────────────────────┘
        ▼
 github.com/your-org/your-repo/issues  +  the dashboard issue log
```

Every external integration **degrades instead of aborting**. The server boots and runs
the entire pipeline with **zero API keys** — the widget captures browser-native speech,
a deterministic offline engine drafts the issue, and reports are kept as dashboard
drafts instead of being pushed to GitHub. Adding a key upgrades exactly one station of
the pipeline. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The Smart Architecture Index

Git-Voice does **not** embed your raw source code. Indexing extracts a compact signature
per file — component names, exported symbols, thrown error codes, route literals, UI
class names — and embeds that with either a hosted embedding API or a deterministic
offline vectorizer. Retrieval is hybrid: vector cosine + BM25 keyword, fused with
Reciprocal Rank Fusion, in-process or on PostgreSQL + pgvector. Read
[docs/INDEXING.md](docs/INDEXING.md).

## Quickstart (local)

```bash
npm install
npm run build
npm start          # serves everything on http://localhost:10000
```

Or for development with hot reload:

```bash
npm run dev        # backend :10000 + frontend :5173 concurrently
```

Then:

| URL | What it is |
|---|---|
| `/` | Product landing page |
| `/demo` | A deliberately-broken demo storefront with the widget installed — the fastest way to experience the whole flow |
| `/dashboard` | Issue log, projects, and integration health |
| `/api/widget.js` | The embeddable widget bundle |
| `/health` | Liveness probe |

### Try the demo

1. Open `/demo` — a staging storefront with a planted coupon bug.
2. Click the floating microphone, tap **"Prefer typing?"** on the report card, and
   submit the suggested complaint (or speak it).
3. Watch the confirmation card: issue title, suspected file, spoken confirmation.
4. Open `/dashboard`: the issue is there with the full 7-step trace, index matches,
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
| `GOOGLE_API_KEY` | Server-side transcription + LLM issue drafting + hosted embeddings. Free tier, no credit card. |
| `DATABASE_URL` | PostgreSQL + pgvector persistence for the architecture index. |
| `ELEVENLABS_API_KEY` | Server-rendered speech audio for the client confirmation (unset = browser speech, always free). |
| `GITHUB_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_SECRET` | GitHub sign-in. Required to use the app at all: it unlocks private repos and makes each developer the publishing identity of their own issues. |
| `GITHUB_TOKEN` + `GITHUB_DEFAULT_REPO` | Optional server-side automation + higher REST rate limit. Not used to file issues. |
| `GITHUB_WEBHOOK_SECRET` | Push webhook that re-indexes a project on every commit. |
| `DASHBOARD_TOKEN` | Adds an operator key that sees every project. Generate with `openssl rand -hex 32`. |
| `DATA_DIR` | Persists issue records + audio to disk. |

Reports, transcripts, telemetry and audio are private: only the project owner (or the
operator key) can read them, and every filed issue is created with the owner's own
GitHub identity — never with a server-wide credential.

Health of every integration is visible in the dashboard's **Settings** tab and via
`GET /api/settings`.

## Deploy (single container, free tier friendly)

One Node process serves the landing page, the dashboard, the widget bundle, and the API —
built for platforms that run a Dockerfile (512 MB / 0.1 CPU fits comfortably):

```bash
docker build -t git-voice .    # never needs to run locally — CI/host builds it
```

A [render.yaml](render.yaml) blueprint is included: create a **Web Service** from the
repo, review the `sync: false` secrets (set them in the dashboard, never commit them),
and deploy. Health check: `/health`. Details in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Development

```bash
npm run dev        # backend :10000 + frontend :5173 concurrently
npm run typecheck  # strict TS across both workspaces
npm test           # vitest unit tests (tar reader, signature extractor, embeddings)
npm run build      # frontend + widget + backend production builds
```

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The seven-station pipeline, every component, degradation paths |
| [docs/API.md](docs/API.md) | The full REST contract for `/api/*` |
| [docs/INDEXING.md](docs/INDEXING.md) | How the Smart Architecture Index is built and queried |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hosting walkthrough, env vars, webhook setup |
| [docs/DEMO_CHECKLIST.md](docs/DEMO_CHECKLIST.md) | The exact click-path for a live demonstration |

## Security notes

- The widget is served with a scoped shadow-DOM bundle; host page styles never collide.
- **Authentication is required.** Every dashboard read and every report filing needs a
  GitHub sign-in (or the operator key); anonymous callers get `401`. Reads are scoped to
  the caller's own projects, so one developer can never see another's transcripts,
  telemetry or audio — including the bundled demo, which is shared only as a fixture.
- **Publishing identity is per-owner.** Issues are created with the project owner's own
  OAuth token, so the GitHub author is the developer who owns the project. No
  server-wide credential is ever used to file, and no one can point the operator's
  credentials at a repository by typing its name into a form.
- The operator key is compared in constant time; session ids are 256-bit random values
  held in `HttpOnly; SameSite=Lax; Secure` cookies, and OAuth codes are single-use.
- The operator's hosted-model quota is protected: per-IP rate limiting plus an hourly
  capacity guard that degrades to the offline engine instead of being exhausted.
- The first report is capped at 30 s audio; console/error/click buffers are capped too.
- Telemetry shown in the GitHub body is exactly what's captured — no secrets ride along.
- Webhook verification uses constant-time HMAC comparison.
- Known limitation: because the session cookie is `SameSite=Lax`, a report filed from a
  third-party staging site does not carry a session. In that deployment the widget's
  owner must be signed in on that browser.

## License

Apache-2.0 — see [LICENSE](LICENSE).

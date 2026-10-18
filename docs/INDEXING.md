# The Smart Architecture Index

The retriever that makes "the coupon box turned red" resolve to
`src/components/checkout/CouponInput.tsx` — without ever embedding raw source code.

## Why signatures, not code

Indexing raw code is expensive, brittle at the 512 MB free-tier memory envelope, and
needlessly invasive: it would ship a client's source to a third-party embedding API.
Instead the indexer extracts a compact **signature** per file — exactly the vocabulary a
non-technical voice complaint tends to hit:

| Indexed entity | Example | Why it helps |
|---|---|---|
| Route paths | `/checkout`, `/settings/billing` | The page URL is the first triage signal |
| Component names | `CouponInput.tsx`, `CartDrawer.tsx` | "the coupon box" → component name |
| Exported symbols | `applyCoupon()`, `validatePromoCode()` | Maps to reproduction-step verbs |
| Error enums | `ERR_COUPON_STATE_DESYNC`, `PROMO_EXPIRED_422` | Pairs with captured console text |
| UI class names | `coupon-input`, `complete-order-button` | Click breadcrumb correlation |
| Leading doc comment | "Coupon entry field for the checkout route" | Free human-intent context |

A 200-file project produces ~200 vectors of `EMBEDDING_DIM` (768 by default) floats — well
under a megabyte. Indexing runs once per project and refreshes on every default-branch push
(webhook) or manually from the dashboard.

## Extraction (`src/backend/src/indexer/chunk.ts`)

Per file, regex-based extractors pull:

- exported `function` / `class` / `const` names, `export {}` lists (excluding styles/markup)
- thrown or declared error identifiers (`throw`, `new *Error(...)`, and
  SCREAMING_SNAKE_CASE constants — the common error-code convention)
- UI `className` literals and top-level CSS selectors for style files
- route literals (`path=`, `href=`, `to=`, backend router registrations, and common app-path
  literals)
- the first doc comment line
- build/tooling directives for container and Make-style files (base images, stage names,
  `EXPOSE` ports, `CMD`/`ENTRYPOINT`, common package-manager `RUN` commands), and Makefile
  targets

Anything the extractor cannot parse is skipped, never fatal. Binary files (by extension),
lockfiles, build directories, and files over 200 KB are filtered before extraction.

A signature looks like:

```
path:src/components/checkout/CouponInput.tsx | component:CouponInput
| route:/checkout | exports:CouponInput,ERR_COUPON_STATE_DESYNC
| errors:ERR_COUPON_STATE_DESYNC | classNames:coupon-input,coupon-field
| desc:CouponInput in src/components/checkout/CouponInput.tsx; exposes …
```

## Embedding (`src/backend/src/services/embeddings.ts`)

Two interchangeable embedders; every stored entry records which produced it:

- **hosted** — the Gemini embedding API (free tier, batched 20/request, exponential backoff
  on 429/5xx with up to four attempts), `EMBEDDING_DIM` dims (768 by default).
- **offline** — a deterministic feature-hashing vectorizer over unigrams + bigrams. Same
  dimensionality, same cosine math, weaker semantics. Runs with zero configuration, never
  touches a network, and is the automatic fallback if a hosted batch fails at index time.

## Which files get indexed

The index covers **web front end and back end**, not just JavaScript:

| Group | Extensions |
|---|---|
| Front end | `.ts .tsx .js .jsx .mjs .cjs .vue .svelte .astro .html .htm .css .scss .sass .less` |
| Back end | `.py .java .go .rs .rb .php .cs .kt .swift .scala .ex .exs .hs .lua .dart .sql .graphql .proto` |
| Config / prose | `.sh .bash .zsh .yml .yaml .toml .json .md .mdx .env.example` |
| Build / tooling | `Dockerfile`, `Containerfile`, `Makefile`, `Procfile`, `CMakeLists.txt`, `Jenkinsfile`, `Rakefile`, `.nvmrc`, `.python-version`, `.tool-versions`, `.editorconfig`, `.gitignore`, `.dockerignore`, and related dotfiles |

Prose and config files are indexed for **intent** (a `README` describing the coupon flow is
useful evidence) but contribute no symbols.

Container and build files are understood too: a `Dockerfile` contributes its base images and
stage names (`node:22-alpine AS runtime`), exposed ports, `CMD`/`ENTRYPOINT`, and the
package-manager commands it runs. That is what lets a report like *"the deploy fails on the
hosting platform"* point at the right file instead of guessing at application code.

Symbol extraction is language-aware — `def`/`class` in Python, `func`/`type` in Go,
`fn`/`struct` in Rust, `class`/`interface`/`record` in JVM and .NET languages, `def`/`class`
in Ruby and PHP, `defmodule` in Elixir. Route detection also covers backend routers
(Express, Flask, FastAPI, Spring mapping annotations, Go `HandleFunc`, Rails-style verb
routes), so "the checkout endpoint" can match `/api/checkout` as readily as a JSX `<Route>`.

## Limits

| Limit | Value | Reason |
|---|---|---|
| Files indexed per run | 800 | Embedding cost against the free-tier quota |
| Downloaded tarball | 40 MB | Memory safety on a 512 MB container |
| Single file | 200 KB | Skips minified bundles and generated code |
| Skipped directories | `node_modules`, `dist`, `build`, `out`, `coverage`, `target`, `vendor`, `venv`, `__pycache__`, `bin`, `obj`, `migrations`, `fixtures`, `__snapshots__`, `.next`, `.git`, and more | Generated or vendored code is noise |
| Skipped files | every lockfile, `go.sum`, `tsconfig.json`, `jsconfig.json`, `poetry.lock`, `composer.lock`, `cargo.lock` | Machine-generated |

A 5,000-file monorepo therefore indexes its first 800 eligible files per run. That is a
deliberate tradeoff: embedding every file would exhaust the free embedding quota and slow
indexing past usefulness. The 1,200-file walk of the extractor is covered by a regression
test (`src/backend/src/indexer/coverage.test.ts`).

## Retrieval (`src/backend/src/store/vectorIndex.ts`)

Hybrid search, fused with Reciprocal Rank Fusion (the RRF scoring rule, `k = 60`, after
Cormack, Clarke and Buettcher, SIGIR 2009) — the same semantics on two backends:

1. **Vector leg** — cosine similarity (or pgvector HNSW `<=>`).
2. **Keyword leg** — BM25 over the serialized signatures (or a `tsvector` column with a GIN
   index), plus hard boosts for exact route and error-code hits from the captured telemetry.
3. **Fusion** — RRF over both ranked lists; the final score blends the fused rank with
   normalized vector/keyword scores (0.45 vector / 0.55 keyword) so the issue body's match
   table stays interpretable.

Backends:

| Backend | When | Details |
|---|---|---|
| PostgreSQL + pgvector | `DATABASE_URL` set and schema creation succeeds | `vector(768)` + HNSW + tsvector columns; single-SQL RRF query |
| In-process | everything else (and automatic fallback on any DB error) | cosine + Okapi BM25 (k1 = 1.4, b = 0.72), identical boosts and fusion |

The pgvector backend mirrors writes to memory, so a mid-run database outage degrades a
request to the in-process path instead of failing the pipeline. Entries shipped with a
different embedder still contribute through the keyword leg — cross-embedder corpora do not
fake vector similarity.

## Querying

Dashboards and integrations can query an index directly:

```
GET /api/projects/:id/search?q=coupon%20checkout&route=/checkout
```

During filing, the pipeline builds the query from the transcript, captured error and
console texts, and click labels; the report's own route is passed as a hard hint. When a
first pass returns nothing, a route-only retry keeps the draft supplied with candidate
files.

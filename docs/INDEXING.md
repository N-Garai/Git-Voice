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

A 200-file project produces ~200 vectors × 768 dims of embedding data — well under a
megabyte. Indexing runs once per project and refreshes on every default-branch push
(webhook) or manually from the dashboard.

## Extraction (`src/backend/src/indexer/chunk.ts`)

Per file, regex-based extractors pull:

- exported `function` / `class` / `const` names, `export {}` lists (excluding styles/markup)
- thrown or declared error identifiers (`throw`, `new *Error(...)`, and
  SCREAMING_SNAKE_CASE constants — the common error-code convention)
- UI `className` literals and top-level CSS selectors
- route literals (`path=`, `href=`, `to=` and heuristic URL paths)
- the first doc comment line

Anything the extractor can't parse is skipped, never fatal. Binary files, lockfiles,
build outputs, and files > 200 KB are filtered before extraction. Repository tarballs
cap at 800 indexable files per run for memory safety.

A signature looks like:

```
path:src/components/checkout/CouponInput.tsx | component:CouponInput
| route:/checkout | exports:CouponInput,ERR_COUPON_STATE_DESYNC
| errors:ERR_COUPON_STATE_DESYNC | classNames:coupon-input,coupon-field
| desc:CouponInput in src/components/checkout/CouponInput.tsx; exposes …
```

## Embedding (`src/backend/src/services/embeddings.ts`)

Two interchangeable embedders; every stored entry records which produced it:

- **hosted** — the Gemini embedding API (free tier, batched 20/request, exponential
  backoff on 429/5xx), 768 dims by default (`EMBEDDING_DIM`).
- **offline** — a deterministic feature-hashing vectorizer over unigrams + bigrams.
  Same dimensionality, same cosine math, weaker semantics. Runs with zero
  configuration, is fast enough for the largest supported repo, and never touches a
  network.

## Retrieval (`src/backend/src/store/vectorIndex.ts`)

Hybrid search, fused with Reciprocal Rank Fusion — the same semantics on two backends:

1. **Vector leg** — cosine similarity (or pgvector HNSW `<=>`).
2. **Keyword leg** — BM25 over the serialized signatures (or a generated `tsvector`
   with GIN index), plus hard boosts for exact route and error-code hits from the
   captured telemetry.
3. **Fusion** — RRF (k = 60) over both ranked lists; the final score blends the fused
   rank with normalized vector/keyword scores so the issue body's match table stays
   interpretable.

Backends:

| Backend | When | Details |
|---|---|---|
| PostgreSQL + pgvector | `DATABASE_URL` set and schema creation succeeds | `vector(768)` + HNSW + tsvector columns; single-SQL RRF query |
| In-process | everything else (and automatic fallback on any DB error) | cosine + Okapi BM25, identical boosts and fuse |

The pgvector backend mirrors writes to memory, so a mid-run database outage degrades a
request to the in-process path instead of failing the pipeline.

## Querying

Dashboards and integrations can query an index directly:

```
GET /api/projects/:id/search?q=coupon%20checkout&route=/checkout
```

During filing, the pipeline builds the query from the transcript, captured error and
console texts, and click labels; the report's own route is passed as a hard hint.

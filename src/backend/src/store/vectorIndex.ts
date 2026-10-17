/**
 * Smart Architecture Index storage + hybrid retrieval.
 *
 * Two interchangeable backends with identical ranking semantics:
 *  - MemoryIndex:  in-process cosine + BM25, fused with Reciprocal Rank Fusion.
 *  - PgVectorIndex: PostgreSQL + pgvector (HNSW) + generated tsvector (GIN),
 *    fused with the same RRF weighting in a single SQL statement.
 *
 * The backend is chosen at boot from the environment; any database error
 * degrades a request to the in-memory path rather than failing the pipeline.
 */
import pg from "pg";
import { config } from "../config.js";
import type { IndexEntry, IndexMatch } from "../types.js";
import { cosineSimilarity, embedQuery } from "../services/embeddings.js";

export interface SearchOutcome {
  matches: IndexMatch[];
  backend: string;
}

export interface VectorIndex {
  readonly backendName: string;
  add(entries: IndexEntry[]): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  count(projectId?: string): Promise<number>;
  entriesFor(projectId: string): Promise<IndexEntry[]>;
  search(projectId: string, queryText: string, routeHint: string, topK?: number): Promise<SearchOutcome>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared text utilities
// ---------------------------------------------------------------------------

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z0-9])(?=[A-Z])/g, "$1 ")
    .replace(/[^a-z0-9_/.-]+/g, " ")
    .split(/[\s/]+/)
    .flatMap((t) => (t.includes("-") ? [t, ...t.split("-")] : [t]))
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((t) => t.length > 1);
}

/** Standard Okapi BM25 over a fixed corpus snapshot. */
export function bm25Scores(corpus: string[], queryTokens: string[]): number[] {
  const k1 = 1.4;
  const b = 0.72;
  const N = corpus.length || 1;
  const docs = corpus.map(tokenize);
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N || 1;

  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const qTokens = Array.from(new Set(queryTokens));
  return docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of qTokens) {
      const f = tf.get(q);
      if (!f) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (doc.length / avgLen))));
    }
    return score;
  });
}

/** Reciprocal Rank Fusion over two ranked lists (k = 60). */
export function rrf(rankA: number[], rankB: number[], k = 60): number[] {
  const n = rankA.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    out[i] = 1 / (k + rankA[i] + 1) + 1 / (k + rankB[i] + 1);
  }
  return out;
}

function entryToMatch(entry: IndexEntry, vectorScore: number, keywordScore: number): IndexMatch {
  const score = 0.45 * vectorScore + 0.55 * keywordScore;
  return {
    filePath: entry.filePath,
    componentName: entry.componentName,
    routePath: entry.routePath || undefined,
    exportedSymbols: entry.exportedSymbols,
    errorEnums: entry.errorEnums,
    description: entry.description,
    score,
    vectorScore,
    keywordScore
  };
}

function normalizeQuery(queryText: string, routeHint: string, extra: string[] = []): string {
  return [queryText, routeHint, ...extra].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

export class MemoryIndex implements VectorIndex {
  readonly backendName = "In-process hybrid index (cosine + BM25, RRF-fused)";
  private entries = new Map<string, IndexEntry>();

  async add(entries: IndexEntry[]): Promise<void> {
    for (const e of entries) this.entries.set(e.id, e);
  }

  async removeProject(projectId: string): Promise<void> {
    for (const [id, e] of this.entries) if (e.projectId === projectId) this.entries.delete(id);
  }

  async count(projectId?: string): Promise<number> {
    if (!projectId) return this.entries.size;
    let n = 0;
    for (const e of this.entries.values()) if (e.projectId === projectId) n++;
    return n;
  }

  async entriesFor(projectId: string): Promise<IndexEntry[]> {
    return [...this.entries.values()].filter((e) => e.projectId === projectId);
  }

  async search(
    projectId: string,
    queryText: string,
    routeHint: string,
    topK = 5,
    extraSignals: string[] = []
  ): Promise<SearchOutcome> {
    const corpus = [...this.entries.values()].filter((e) => e.projectId === projectId);
    if (!corpus.length) return { matches: [], backend: this.backendName };

    const fullQuery = normalizeQuery(queryText, routeHint, extraSignals);
    const { vector, embedderId } = await embedQuery(fullQuery);

    // Vector leg: same-embedder entries rank reliably; foreign-embedder entries
    // still contribute through the keyword leg.
    const vectorScores = corpus.map((e) =>
      e.embedderId === embedderId ? Math.max(0, cosineSimilarity(vector, e.embedding)) : 0
    );

    // Keyword leg: BM25 over serialized signatures + hard boosts for exact
    // route and error-code hits from the captured telemetry.
    const serialized = corpus.map((e) => `${e.filePath} ${e.signature}`);
    let keywordScores = bm25Scores(serialized, tokenize(fullQuery));
    const maxKw = Math.max(...keywordScores, 1);
    keywordScores = keywordScores.map((s) => s / maxKw);

    const lowerQuery = fullQuery.toLowerCase();
    corpus.forEach((e, i) => {
      if (routeHint && e.routePath && e.routePath.toLowerCase() === routeHint.toLowerCase()) {
        keywordScores[i] = Math.min(1, keywordScores[i] + 0.45);
      }
      for (const err of e.errorEnums) {
        if (err.length > 4 && lowerQuery.includes(err.toLowerCase())) {
          keywordScores[i] = Math.min(1, keywordScores[i] + 0.35);
        }
      }
    });

    const vecRank = [...vectorScores.keys()].sort((a, b) => vectorScores[b] - vectorScores[a]);
    const kwRank = [...keywordScores.keys()].sort((a, b) => keywordScores[b] - keywordScores[a]);
    const fused = rrf(
      vecRank.map((idx) => vecRank.indexOf(idx)),
      kwRank.map((idx) => kwRank.indexOf(idx))
    );

    const scored = corpus.map((e, i) =>
      entryToMatch(
        e,
        vectorScores[i],
        keywordScores[i]
      )
    );
    scored.forEach((_, i) => {
      scored[i] = { ...scored[i], score: scored[i].score + fused[i] };
    });

    const matches = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter((m) => m.score > 0.001);
    return { matches, backend: this.backendName };
  }

  async close(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// pgvector backend
// ---------------------------------------------------------------------------

const INDEX_SCHEMA_SQL = (dim: number) => `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS git_voice_code_index (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  component_name TEXT NOT NULL,
  route_path TEXT NOT NULL DEFAULT '',
  exported_symbols TEXT[] NOT NULL DEFAULT '{}',
  error_enums TEXT[] NOT NULL DEFAULT '{}',
  class_names TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL,
  embedding vector(${dim}) NOT NULL,
  embedder_id TEXT NOT NULL,
  search_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(file_path, '') || ' ' ||
      coalesce(component_name, '') || ' ' ||
      coalesce(route_path, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      array_to_string(exported_symbols, ' ') || ' ' ||
      array_to_string(error_enums, ' ')
    )
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_gv_code_index_project ON git_voice_code_index (project_id);
CREATE INDEX IF NOT EXISTS idx_gv_code_index_hnsw ON git_voice_code_index USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_gv_code_index_tsv ON git_voice_code_index USING gin (search_tsv);

CREATE TABLE IF NOT EXISTS git_voice_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_full_name TEXT,
  owner_login TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  indexed_at TIMESTAMPTZ,
  index_count INTEGER NOT NULL DEFAULT 0,
  embedder_id TEXT NOT NULL DEFAULT 'hashed',
  index_status TEXT NOT NULL DEFAULT 'empty'
);

-- Added after initial deploy: owner_login for GitHub-login projects.
ALTER TABLE git_voice_projects ADD COLUMN IF NOT EXISTS owner_login TEXT;

-- GitHub-login sessions: opaque ids, tokens server-side only. Mirrors the
-- in-memory session store so logins survive free-tier sleeps/restarts.
CREATE TABLE IF NOT EXISTS git_voice_sessions (
  id TEXT PRIMARY KEY,
  github_user_id BIGINT NOT NULL,
  github_login TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gv_sessions_login ON git_voice_sessions (github_login);
`;

export class PgVectorIndex implements VectorIndex {
  readonly backendName = "PostgreSQL + pgvector (HNSW) + tsvector, RRF-fused";
  private pool: pg.Pool;
  private memoryFallback: MemoryIndex;
  private schemaReady = false;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 3 });
    this.memoryFallback = new MemoryIndex();
  }

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    try {
      await this.pool.query(INDEX_SCHEMA_SQL(config.gemini.embeddingDim));
      this.schemaReady = true;
    } catch (err) {
      console.warn(
        "[index] pgvector schema unavailable, staying on the in-process index:",
        err instanceof Error ? err.message : err
      );
      throw err;
    }
  }

  async add(entries: IndexEntry[]): Promise<void> {
    try {
      await this.ensureSchema();
      for (const e of entries) {
        await this.pool.query(
          `INSERT INTO git_voice_code_index
           (id, project_id, file_path, component_name, route_path, exported_symbols, error_enums, class_names, description, signature, embedding, embedder_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector,$12)
           ON CONFLICT (id) DO UPDATE SET
             file_path = EXCLUDED.file_path, component_name = EXCLUDED.component_name,
             route_path = EXCLUDED.route_path, exported_symbols = EXCLUDED.exported_symbols,
             error_enums = EXCLUDED.error_enums, class_names = EXCLUDED.class_names,
             description = EXCLUDED.description, signature = EXCLUDED.signature,
             embedding = EXCLUDED.embedding, embedder_id = EXCLUDED.embedder_id`,
          [
            e.id,
            e.projectId,
            e.filePath,
            e.componentName,
            e.routePath,
            e.exportedSymbols,
            e.errorEnums,
            e.classNames,
            e.description,
            e.signature,
            `[${e.embedding.join(",")}]`,
            e.embedderId
          ]
        );
      }
    } catch (err) {
      console.warn("[index] pg write failed; mirroring to memory:", err instanceof Error ? err.message : err);
      await this.memoryFallback.add(entries);
    }
  }

  async removeProject(projectId: string): Promise<void> {
    try {
      await this.ensureSchema();
      await this.pool.query("DELETE FROM git_voice_code_index WHERE project_id = $1", [projectId]);
    } catch (err) {
      console.warn("[index] pg delete failed:", err instanceof Error ? err.message : err);
    }
    await this.memoryFallback.removeProject(projectId);
  }

  async count(projectId?: string): Promise<number> {
    try {
      await this.ensureSchema();
      const res = projectId
        ? await this.pool.query("SELECT count(*)::int AS n FROM git_voice_code_index WHERE project_id = $1", [projectId])
        : await this.pool.query("SELECT count(*)::int AS n FROM git_voice_code_index");
      return res.rows[0].n as number;
    } catch {
      return this.memoryFallback.count(projectId);
    }
  }

  async entriesFor(projectId: string): Promise<IndexEntry[]> {
    try {
      await this.ensureSchema();
      const res = await this.pool.query(
        `SELECT id, project_id, file_path, component_name, route_path, exported_symbols,
                error_enums, class_names, description, signature, embedder_id,
                embedding::text AS embedding_text
         FROM git_voice_code_index WHERE project_id = $1`,
        [projectId]
      );
      return res.rows.map((r: Record<string, unknown>) => ({
        ...r,
        embedding: parsePgVector(r.embedding_text as string),
        embedding_text: undefined
      })) as unknown as IndexEntry[];
    } catch {
      return this.memoryFallback.entriesFor(projectId);
    }
  }

  async search(
    projectId: string,
    queryText: string,
    routeHint: string,
    topK = 5,
    extraSignals: string[] = []
  ): Promise<SearchOutcome> {
    try {
      await this.ensureSchema();
      const fullQuery = normalizeQuery(queryText, routeHint, extraSignals);
      const { vector } = await embedQuery(fullQuery);
      const vectorLiteral = `[${vector.join(",")}]`;

      // Same RRF shape as the in-memory implementation, executed server-side.
      const sql = `
        WITH vector_rank AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS r
          FROM git_voice_code_index WHERE project_id = $2
          ORDER BY embedding <=> $1::vector
          LIMIT 40
        ),
        keyword_rank AS (
          SELECT id, ROW_NUMBER() OVER (
            ORDER BY ts_rank_cd(search_tsv, plainto_tsquery('english', $3)) DESC
          ) AS r
          FROM git_voice_code_index
          WHERE project_id = $2 AND (
            search_tsv @@ plainto_tsquery('english', $3)
            OR ($4 <> '' AND route_path = $4)
          )
          LIMIT 40
        ),
        fused AS (
          SELECT i.id,
                 COALESCE(1.0 / (60 + v.r), 0) + COALESCE(1.0 / (60 + k.r), 0) AS rrf
          FROM git_voice_code_index i
          LEFT JOIN vector_rank v ON v.id = i.id
          LEFT JOIN keyword_rank k ON k.id = i.id
          WHERE i.project_id = $2 AND (v.id IS NOT NULL OR k.id IS NOT NULL)
        )
        SELECT i.file_path, i.component_name, i.route_path, i.exported_symbols,
               i.error_enums, i.description, f.rrf,
               (1 - (i.embedding <=> $1::vector)) AS vector_score
        FROM git_voice_code_index i
        JOIN fused f ON f.id = i.id
        ORDER BY f.rrf DESC
        LIMIT $5`;

      const res = await this.pool.query(sql, [vectorLiteral, projectId, fullQuery, routeHint, topK]);
      const rows = res.rows as Array<Record<string, unknown>>;
      if (!rows.length) return { matches: [], backend: this.backendName };

      const maxRrf = Math.max(...rows.map((r) => Number(r.rrf)), 0.0001);
      const matches: IndexMatch[] = rows.map((r) => {
        const rrfNorm = Number(r.rrf) / maxRrf;
        return {
          filePath: r.file_path as string,
          componentName: r.component_name as string,
          routePath: (r.route_path as string) || undefined,
          exportedSymbols: (r.exported_symbols as string[]) ?? [],
          errorEnums: (r.error_enums as string[]) ?? [],
          description: r.description as string,
          vectorScore: Math.max(0, Number(r.vector_score)),
          keywordScore: rrfNorm,
          score: 0.45 * Math.max(0, Number(r.vector_score)) + 0.55 * rrfNorm
        };
      });
      return { matches, backend: this.backendName };
    } catch (err) {
      console.warn("[index] pg search failed; using in-process index:", err instanceof Error ? err.message : err);
      return this.memoryFallback.search(projectId, queryText, routeHint, topK, extraSignals);
    }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => {});
  }
}

function parsePgVector(text: string): number[] {
  return text
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map(Number);
}

/** Boot-time selection: pgvector when DATABASE_URL is set, memory otherwise. */
export async function createVectorIndex(): Promise<VectorIndex> {
  if (config.databaseUrl) {
    const pgIndex = new PgVectorIndex(config.databaseUrl);
    try {
      await pgIndex.ensureSchema();
      console.log("[index] Using PostgreSQL + pgvector backend");
      return pgIndex;
    } catch {
      console.log("[index] Falling back to the in-process hybrid index");
    }
  }
  return new MemoryIndex();
}

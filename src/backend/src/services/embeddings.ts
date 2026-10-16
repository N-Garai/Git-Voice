/**
 * Embedding layer for the architecture index.
 *
 * Two interchangeable embedders:
 *  1. "gemini"  — hosted embedding API (free tier, no credit card).
 *  2. "hashed"  — deterministic feature-hashing vectorizer that runs offline
 *                 with zero configuration. Same dimensionality, same cosine
 *                 math, weaker semantics — used until an API key is set.
 *
 * Every stored entry records which embedder produced it, so mixed corpora
 * remain explainable (keyword leg still ranks cross-embedder entries fine).
 */
import { config } from "../config.js";

export interface EmbeddingResult {
  vector: number[];
  embedderId: string;
  modelLabel: string;
}

export interface EmbedderInfo {
  id: string;
  label: string;
  configured: boolean;
}

const GEMINI_EMBED_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

export function activeEmbedder(): EmbedderInfo {
  if (config.gemini.apiKey) {
    return {
      id: "gemini",
      label: `${config.gemini.embeddingModelId} (${config.gemini.embeddingDim}-d)`,
      configured: true
    };
  }
  return {
    id: "hashed",
    label: `Deterministic hashed vectors (${config.gemini.embeddingDim}-d, offline)`,
    configured: false
  };
}

/** Deterministic feature-hashing vectorizer over unigrams + bigrams. */
export function hashedEmbed(text: string, dim = config.gemini.embeddingDim): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_/.-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  const grams: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) grams.push(`${tokens[i]}_${tokens[i + 1]}`);

  for (const gram of grams) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < gram.length; i++) {
      const c = gram.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 + c * (i + 7), 2246822519);
    }
    const weight = gram.includes("_") ? 1.4 : 1.0;
    for (let d = 0; d < 6; d++) {
      const idx = Math.abs((h1 ^ Math.imul(d + 1, h2)) >>> 0) % dim;
      const sign = ((h2 >>> d) & 1) === 0 ? 1 : -1;
      vec[idx] += sign * weight;
    }
  }

  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function geminiEmbedBatch(texts: string[], taskType: string): Promise<number[][]> {
  const key = config.gemini.apiKey;
  if (!key) throw new Error("No embedding API key configured");

  const out: number[][] = [];
  const BATCH = 20;
  for (let start = 0; start < texts.length; start += BATCH) {
    const batch = texts.slice(start, start + BATCH);
    let lastError: unknown = null;
    let success = false;

    for (let attempt = 0; attempt < 4 && !success; attempt++) {
      if (attempt > 0) await sleep(800 * 2 ** attempt);
      try {
        const res = await fetch(
          `${GEMINI_EMBED_ENDPOINT}/${config.gemini.embeddingModelId}:batchEmbedContents?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: batch.map((text) => ({
                model: `models/${config.gemini.embeddingModelId}`,
                content: { parts: [{ text: text.slice(0, 6000) }] },
                taskType,
                outputDimensionality: config.gemini.embeddingDim
              }))
            }),
            signal: AbortSignal.timeout(30_000)
          }
        );
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`Embedding API responded ${res.status}`);
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Embedding API error ${res.status}: ${body.slice(0, 200)}`);
        }
        const data = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
        const values = data.embeddings?.map((e) => e.values ?? []) ?? [];
        if (values.length !== batch.length) {
          throw new Error("Embedding API returned an unexpected shape");
        }
        out.push(...values);
        success = true;
      } catch (err) {
        lastError = err;
      }
    }
    if (!success) throw lastError instanceof Error ? lastError : new Error("Embedding failed");
  }
  return out;
}

export async function embedTexts(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"
): Promise<EmbeddingResult[]> {
  const info = activeEmbedder();
  if (info.configured) {
    try {
      const vectors = await geminiEmbedBatch(texts, taskType);
      return vectors.map((vector) => ({
        vector,
        embedderId: "gemini",
        modelLabel: info.label
      }));
    } catch (err) {
      console.warn(
        "[embeddings] Hosted embeddings unavailable, falling back to hashed vectors:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return texts.map((text) => ({
    vector: hashedEmbed(text),
    embedderId: "hashed",
    modelLabel: info.label
  }));
}

export async function embedQuery(text: string): Promise<EmbeddingResult> {
  const [result] = await embedTexts([text], "RETRIEVAL_QUERY");
  return result;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

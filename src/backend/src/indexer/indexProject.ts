/**
 * Index orchestration: sources (bundled fixture or a GitHub tarball) ->
 * FileSignature[] -> Smart Architecture Index entries (embedded + stored).
 */
import crypto from "node:crypto";
import type { IndexEntry, Project } from "../types.js";
import { extractSignature, isIndexableFile, type FileSignature } from "./chunk.js";
import { embedTexts, activeEmbedder } from "../services/embeddings.js";
import type { VectorIndex } from "../store/vectorIndex.js";
import { gunzipTar, readTar, stripCommonPrefix, type TarEntry } from "./tar.js";
import { DEMO_FIXTURE } from "./fixtures.js";

export interface IndexRunResult {
  project: Project;
  filesWalked: number;
  filesIndexed: number;
  embedderId: string;
}

const MAX_FILES_PER_RUN = 800;

async function buildEntries(
  project: Project,
  files: Array<{ path: string; source: string }>,
  index: VectorIndex
): Promise<IndexRunResult> {
  const signatures: FileSignature[] = [];
  let filesWalked = 0;

  for (const file of files) {
    filesWalked++;
    if (signatures.length >= MAX_FILES_PER_RUN) break;
    if (!isIndexableFile(file.path, Buffer.byteLength(file.source, "utf8"))) continue;
    try {
      signatures.push(extractSignature(file.path, file.source));
    } catch {
      // A file the extractor cannot parse is skipped, never fatal.
    }
  }

  const embedder = activeEmbedder();
  const embedResults = await embedTexts(
    signatures.map((s) => s.signature),
    "RETRIEVAL_DOCUMENT"
  );

  const entries: IndexEntry[] = signatures.map((sig, i) => ({
    id: `idx_${crypto.createHash("sha1").update(`${project.id}:${sig.filePath}`).digest("hex").slice(0, 20)}`,
    projectId: project.id,
    filePath: sig.filePath,
    componentName: sig.componentName,
    routePath: sig.routePath,
    exportedSymbols: sig.exportedSymbols,
    errorEnums: sig.errorEnums,
    classNames: sig.classNames,
    description: sig.description,
    signature: sig.signature,
    embedding: embedResults[i].vector,
    embedderId: embedResults[i].embedderId
  }));

  await index.removeProject(project.id);
  await index.add(entries);

  const updated: Project = {
    ...project,
    indexedAt: new Date().toISOString(),
    indexCount: entries.length,
    embedderId: embedResults[0]?.embedderId ?? embedder.id,
    indexStatus: "ready",
    indexError: undefined
  };
  return { project: updated, filesWalked, filesIndexed: entries.length, embedderId: updated.embedderId };
}

/** Index the bundled demo storefront into a project. */
export async function indexFixtureProject(project: Project, index: VectorIndex): Promise<IndexRunResult> {
  return buildEntries(project, DEMO_FIXTURE.map((f) => ({ path: f.path, source: f.source })), index);
}

/** Index an arbitrary list of in-memory files (used by the tarball path). */
export async function indexFileList(
  project: Project,
  files: Array<{ path: string; source: string }>,
  index: VectorIndex
): Promise<IndexRunResult> {
  return buildEntries(project, files, index);
}

/**
 * Download and index a public GitHub repository tarball. Uses the codeload
 * endpoint (no git binary, no API quota), capped for memory safety.
 */
export async function indexGitHubRepo(
  project: Project,
  repoFullName: string,
  index: VectorIndex
): Promise<IndexRunResult & { branch: string }> {
  const { owner, repo } = parseRepo(repoFullName);
  let branch = "main";
  let gz: Buffer | null = null;

  for (const candidate of ["main", "master"]) {
    try {
      const res = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${candidate}`, {
        headers: { "User-Agent": "git-voice-indexer" },
        signal: AbortSignal.timeout(60_000)
      });
      if (!res.ok) continue;
      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength > 40 * 1024 * 1024) {
        throw new Error("Repository tarball exceeds the 40 MB indexing limit");
      }
      gz = Buffer.from(arrayBuf);
      branch = candidate;
      break;
    } catch (err) {
      if (err instanceof Error && err.message.includes("40 MB")) throw err;
      // try the next branch
    }
  }
  if (!gz) throw new Error(`Could not download a tarball for ${owner}/${repo} (is it public?)`);

  const tar = gunzipTar(gz);
  const entries: TarEntry[] = stripCommonPrefix(readTar(tar));

  const files: Array<{ path: string; source: string }> = [];
  for (const entry of entries) {
    if (files.length >= MAX_FILES_PER_RUN) break;
    if (entry.type !== "file" || !entry.content) continue;
    if (!isIndexableFile(entry.path, entry.size)) continue;
    files.push({ path: entry.path, source: entry.content.toString("utf8") });
  }
  if (!files.length) throw new Error("No indexable source files found in the repository");

  const result = await buildEntries(project, files, index);
  return { ...result, branch };
}

export function parseRepo(input: string): { owner: string; repo: string } {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const m = cleaned.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new Error(`"${input}" is not an owner/repo reference`);
  return { owner: m[1], repo: m[2] };
}

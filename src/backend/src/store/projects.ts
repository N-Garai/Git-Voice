/** Project registry (in-process; mirrors to Postgres when configured). */
import type { Project } from "../types.js";
import { config } from "../config.js";
import pg from "pg";

export class ProjectStore {
  private projects = new Map<string, Project>();
  private pool: pg.Pool | null = null;

  constructor() {
    if (config.databaseUrl) {
      try {
        this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3 });
      } catch {
        this.pool = null;
      }
    }
  }

  async hydrate(): Promise<void> {
    if (!this.pool) return;
    try {
      const res = await this.pool.query(
        `SELECT id, name, repo_full_name, created_at, indexed_at, index_count, embedder_id, index_status
         FROM git_voice_projects`
      );
      for (const r of res.rows as Array<Record<string, unknown>>) {
        const project: Project = {
          id: r.id as string,
          name: r.name as string,
          repoFullName: (r.repo_full_name as string) ?? undefined,
          createdAt: (r.created_at as Date).toISOString(),
          indexedAt: r.indexed_at ? (r.indexed_at as Date).toISOString() : undefined,
          indexCount: r.index_count as number,
          embedderId: r.embedder_id as string,
          indexStatus: r.index_status as Project["indexStatus"]
        };
        this.projects.set(project.id, project);
      }
    } catch {
      // Fresh database — nothing to hydrate.
    }
  }

  list(): Project[] {
    return [...this.projects.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): Project | undefined {
    return this.projects.get(id);
  }

  async upsert(project: Project): Promise<void> {
    this.projects.set(project.id, project);
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO git_voice_projects (id, name, repo_full_name, created_at, indexed_at, index_count, embedder_id, index_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, repo_full_name = EXCLUDED.repo_full_name,
           indexed_at = EXCLUDED.indexed_at, index_count = EXCLUDED.index_count,
           embedder_id = EXCLUDED.embedder_id, index_status = EXCLUDED.index_status`,
        [
          project.id,
          project.name,
          project.repoFullName ?? null,
          new Date(project.createdAt),
          project.indexedAt ? new Date(project.indexedAt) : null,
          project.indexCount,
          project.embedderId,
          project.indexStatus
        ]
      );
    } catch {
      // Memory remains the source of truth when the mirror fails.
    }
  }

  async close(): Promise<void> {
    await this.pool?.end().catch(() => {});
  }
}

export const projectStore = new ProjectStore();

export function makeProject(partial: Partial<Project> & { id: string; name: string }): Project {
  return {
    repoFullName: undefined,
    createdAt: new Date().toISOString(),
    indexCount: 0,
    embedderId: "hashed",
    indexStatus: "empty",
    ...partial
  };
}

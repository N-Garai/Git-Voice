/**
 * Regression guard for silent report loss.
 *
 * Reports used to live only in process memory, so every Render restart or
 * free-tier sleep emptied the dashboard with no error anywhere. The store now
 * mirrors records to Postgres and hydrates them at boot; these tests assert the
 * wiring exists (schema table, hydrate call, persist on the write paths) using
 * a fake pool, so they run without a database.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

describe("report persistence wiring", () => {
  it("creates the reports table in the pgvector schema", () => {
    const schema = read("src/backend/src/store/vectorIndex.ts");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS git_voice_issues");
    expect(schema).toContain("idx_gv_issues_project");
  });

  it("hydrates records at boot so a restart does not empty the dashboard", () => {
    const entry = read("src/backend/src/index.ts");
    expect(entry).toContain("await issueStore.hydrate()");
    // Hydration must happen before the server starts listening.
    expect(entry.indexOf("issueStore.hydrate()")).toBeLessThan(entry.indexOf("serve("));
  });

  it("opens a Postgres pool and mirrors writes in the issue store", () => {
    const store = read("src/backend/src/store/issues.ts");
    expect(store).toContain("new pg.Pool({ connectionString: config.databaseUrl");
    expect(store).toContain("INSERT INTO git_voice_issues");
    expect(store).toContain("DELETE FROM git_voice_issues WHERE id = $1");
  });

  it("does not leak audio into the database", () => {
    const store = read("src/backend/src/store/issues.ts");
    // audioBase64 is stripped before persisting and has no column.
    expect(store).toMatch(/const \{ audioBase64, \.\.\.rest \} = record;/);
    const schema = read("src/backend/src/store/vectorIndex.ts");
    const table = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS git_voice_issues"));
    const columns = table.slice(0, table.indexOf(");"));
    expect(columns).not.toContain("audio_base64");
    expect(columns).not.toContain("audio_data");
  });
});

describe("issue store mirrors without a database configured", () => {
  it("still serves records when DATABASE_URL is empty", async () => {
    const prevKey = process.env.DATABASE_URL;
    const prevDir = process.env.DATA_DIR;
    delete process.env.DATABASE_URL;
    delete process.env.DATA_DIR;
    vi.resetModules();
    const { IssueStore } = await import("./issues.js");
    const store = new IssueStore();

    store.create({
      id: "r1",
      projectId: "p1",
      status: "completed",
      createdAt: new Date().toISOString(),
      telemetry: {
        url: "u",
        route: "/",
        viewport: { w: 1, h: 1 },
        userAgent: "ua",
        consoleLogs: [],
        errors: [],
        clicks: []
      },
      trace: []
    });

    expect(store.list()).toHaveLength(1);
    expect(store.get("r1")?.projectId).toBe("p1");
    store.update("r1", { status: "failed" });
    expect(store.get("r1")?.status).toBe("failed");
    expect(store.remove("r1")).toBe(true);
    expect(store.list()).toHaveLength(0);

    if (prevKey !== undefined) process.env.DATABASE_URL = prevKey;
    if (prevDir !== undefined) process.env.DATA_DIR = prevDir;
  });
});
/**
 * Git-Voice server entrypoint.
 *
 * One process serves everything from a single origin:
 *   /health              liveness probe
 *   /api/*               triage REST API (see docs/API.md)
 *   /api/widget.js       embeddable widget bundle (compiled at build time)
 *   /*                   dashboard SPA (src/frontend/dist)
 *
 * Boot sequence: env config → vector index (pgvector or in-process) →
 * demo project seeded → listen.
 */
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import { createVectorIndex } from "./store/vectorIndex.js";
import { projectStore, makeProject } from "./store/projects.js";
import { issueStore } from "./store/issues.js";
import { apiRoutes } from "./routes/api.js";
import { widgetJsRoute, spaStatic } from "./static.js";
import { indexFixtureProject } from "./indexer/indexProject.js";
import { DEMO_PROJECT_ID, DEMO_PROJECT_NAME } from "./indexer/fixtures.js";
import { activeEmbedder } from "./services/embeddings.js";
import { llmConfigured } from "./services/gemini.js";
import { sessionStore } from "./store/sessions.js";
import { billingStore } from "./billing/billing.js";
import { preferenceStore } from "./store/preferences.js";

async function main(): Promise<void> {
  const index = await createVectorIndex();
  await projectStore.hydrate();
  // Restore report records before serving, so a restart or free-tier sleep
  // never empties the dashboard.
  await issueStore.hydrate();
  // Plan profiles + receipts, so a purchased tier survives a restart.
  await billingStore.hydrate();
  // Per-account preferences edited from the dashboard.
  await preferenceStore.hydrate();

  // Seed the demo storefront so the machine is explorable immediately.
  let demo = projectStore.get(DEMO_PROJECT_ID);
  if (!demo) {
    demo = makeProject({ id: DEMO_PROJECT_ID, name: DEMO_PROJECT_NAME });
    await projectStore.upsert(demo);
  }
  if (demo.indexStatus === "empty" || (await index.count(DEMO_PROJECT_ID)) === 0) {
    console.log("[boot] Indexing the bundled demo storefront…");
    try {
      const result = await indexFixtureProject(demo, index);
      await projectStore.upsert(result.project);
      console.log(`[boot] Demo index ready: ${result.filesIndexed} files (${result.embedderId})`);
    } catch (err) {
      console.warn("[boot] Demo indexing failed:", err instanceof Error ? err.message : err);
      await projectStore.upsert({ ...demo, indexStatus: "failed", indexError: err instanceof Error ? err.message : String(err) });
    }
  }

  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  });

  app.route("/", apiRoutes(index));
  app.use("*", widgetJsRoute());
  app.use("*", spaStatic());

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
    return c.text("Not found", 404);
  });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[git-voice] listening on http://localhost:${info.port}`);
    console.log(
      `[git-voice] integrations — model: ${llmConfigured() ? "hosted" : "offline fallback"} · ` +
        `embeddings: ${activeEmbedder().configured ? "hosted" : "hashed (offline)"} · ` +
        `index: ${index.backendName}`
    );
  });

  const shutdown = async () => {
    console.log("[git-voice] shutting down…");
    await index.close().catch(() => {});
    await projectStore.close().catch(() => {});
    await issueStore.close().catch(() => {});
    await sessionStore.close().catch(() => {});
    await billingStore.close().catch(() => {});
    await preferenceStore.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[git-voice] fatal boot error:", err);
  process.exit(1);
});

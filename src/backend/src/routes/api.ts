/**
 * REST API surface (all JSON under /api, plus /health and /api/widget.js).
 *
 * Mutations optionally require `Authorization: Bearer <DASHBOARD_TOKEN>` when
 * that env var is set — issue filing from the widget stays open (it is the
 * product's front door) but is rate-limited per IP.
 */
import { Hono } from "hono";
import crypto from "node:crypto";
import { config, integrationStatuses } from "../config.js";
import type { IssueRecord, Project } from "../types.js";
import { issueStore } from "../store/issues.js";
import { projectStore, makeProject } from "../store/projects.js";
import type { VectorIndex } from "../store/vectorIndex.js";
import { runIssuePipeline } from "../workflow/issueWorkflow.js";
import { parseTelemetry } from "./schemas.js";
import { checkRateLimit, clientIp } from "./rateLimit.js";
import { indexFixtureProject, indexGitHubRepo, parseRepo } from "../indexer/indexProject.js";
import { DEMO_PROJECT_ID, DEMO_PROJECT_NAME } from "../indexer/fixtures.js";
import { verifyWebhookSignature } from "../services/github.js";

export interface ApiEnv {
  Variables: {
    index: VectorIndex;
  };
}

/** Strip heavyweight fields for list responses. */
function issueSummary(r: IssueRecord) {
  const { audioBase64, ...rest } = r;
  void audioBase64;
  return rest;
}

async function requireAuth(headers: Record<string, string>): Promise<boolean> {
  if (!config.dashboardToken) return true;
  const header = headers["authorization"] ?? "";
  return header === `Bearer ${config.dashboardToken}`;
}

export function apiRoutes(index: VectorIndex): Hono {
  const app = new Hono();

  // ---------------------------------------------------------------- health
  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "git-voice",
      version: "1.0.0",
      time: new Date().toISOString()
    })
  );

  // ---------------------------------------------------------------- issues
  app.get("/api/issues", (c) => {
    const projectId = c.req.query("projectId") ?? undefined;
    return c.json({ issues: issueStore.list(projectId).map(issueSummary) });
  });

  app.get("/api/issues/:id", (c) => {
    const record = issueStore.get(c.req.param("id"));
    if (!record) return c.json({ error: "Issue not found" }, 404);
    return c.json({ issue: issueSummary(record) });
  });

  app.get("/api/issues/:id/audio", (c) => {
    const audio = issueStore.getAudio(c.req.param("id"));
    if (!audio) return c.json({ error: "No audio attached to this report" }, 404);
    return c.body(Buffer.from(audio.base64, "base64"), 200, {
      "Content-Type": audio.mime,
      "Cache-Control": "private, max-age=3600"
    });
  });

  app.get("/api/issues/:id/body.md", (c) => {
    const record = issueStore.get(c.req.param("id"));
    if (!record?.result) return c.json({ error: "No draft for this report" }, 404);
    return c.body(record.result.draft.issueBody, 200, {
      "Content-Type": "text/markdown; charset=utf-8"
    });
  });

  app.post("/api/issue", async (c) => {
    const limit = checkRateLimit(clientIp(c.req.header()));
    if (!limit.allowed) {
      return c.json(
        { error: "Too many reports from this address — try again in a few minutes." },
        429,
        { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) }
      );
    }

    let projectId = "";
    let transcript = "";
    let transcriptSource: "browser-speech" | "typed-report" | "telemetry-only" = "browser-speech";
    let telemetryRaw: unknown = {};
    let audio: { base64: string; mime: string } | undefined;

    const contentType = c.req.header("content-type") ?? "";

    try {
      if (contentType.includes("multipart/form-data")) {
        const form = await c.req.formData();
        projectId = String(form.get("projectId") ?? "");
        transcript = String(form.get("transcript") ?? "");
        const sourceField = String(form.get("transcriptSource") ?? "browser-speech");
        if (sourceField === "typed-report" || sourceField === "telemetry-only" || sourceField === "browser-speech") {
          transcriptSource = sourceField;
        }
        const telemetryField = form.get("telemetry");
        telemetryRaw = telemetryField ? JSON.parse(String(telemetryField)) : {};
        const file = form.get("audio");
        if (file instanceof File && file.size > 0 && file.size <= config.limits.maxAudioBytes) {
          audio = {
            base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
            mime: file.type || "audio/webm"
          };
        }
      } else {
        const body = (await c.req.json()) as Record<string, unknown>;
        projectId = String(body.projectId ?? "");
        transcript = typeof body.transcript === "string" ? body.transcript : "";
        const sourceField = body.transcriptSource;
        if (sourceField === "typed-report" || sourceField === "telemetry-only" || sourceField === "browser-speech") {
          transcriptSource = sourceField;
        }
        telemetryRaw = body.telemetry ?? {};
      }
    } catch {
      return c.json({ error: "Malformed request body" }, 400);
    }

    if (!projectId || !projectStore.get(projectId)) {
      return c.json({ error: "Unknown projectId — create the project first" }, 400);
    }

    let telemetry;
    try {
      telemetry = parseTelemetry(telemetryRaw);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Invalid telemetry" }, 400);
    }

    if (!transcript && !audio && telemetry.consoleLogs.length === 0 && telemetry.errors.length === 0) {
      return c.json({ error: "A report needs a transcript, audio, or captured telemetry" }, 400);
    }

    const record = await runIssuePipeline(
      {
        projectId,
        telemetry,
        audio,
        transcript: transcript || undefined,
        transcriptSource
      },
      index
    );

    if (!record) return c.json({ error: "Pipeline failed before producing a record" }, 500);
    return c.json({ issue: issueSummary(record) }, 201);
  });

  // ---------------------------------------------------------------- projects
  app.get("/api/projects", (c) => c.json({ projects: projectStore.list() }));

  app.get("/api/projects/:id", (c) => {
    const project = projectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    return c.json({ project });
  });

  app.post("/api/projects", async (c) => {
    if (!(await requireAuth(c.req.header()))) return c.json({ error: "Unauthorized" }, 401);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Expected JSON body" }, 400);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return c.json({ error: "A project name (1-80 chars) is required" }, 400);

    let repoFullName: string | undefined;
    if (typeof body.repoFullName === "string" && body.repoFullName.trim()) {
      try {
        repoFullName = `${parseRepo(body.repoFullName).owner}/${parseRepo(body.repoFullName).repo}`;
      } catch {
        return c.json({ error: "repoFullName must look like owner/repo" }, 400);
      }
    }

    const id = `prj_${crypto.randomUUID().slice(0, 12)}`;
    const project = makeProject({ id, name, repoFullName });
    await projectStore.upsert(project);
    return c.json({ project }, 201);
  });

  app.post("/api/projects/:id/index", async (c) => {
    if (!(await requireAuth(c.req.header()))) return c.json({ error: "Unauthorized" }, 401);

    const project = projectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);

    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      body = {};
    }

    // Re-indexing the bundled demo always uses the fixture source.
    const isDemo = project.id === DEMO_PROJECT_ID;
    const repoInput =
      typeof body.repoFullName === "string" && body.repoFullName.trim()
        ? body.repoFullName.trim()
        : project.repoFullName;

    if (!isDemo && !repoInput) {
      return c.json({ error: "This project has no repository to index — set repoFullName first" }, 400);
    }

    projectStore.upsert({ ...project, indexStatus: "indexing", indexError: undefined });

    try {
      const result = isDemo || !repoInput
        ? await indexFixtureProject(project, index)
        : await indexGitHubRepo(project, repoInput, index);
      await projectStore.upsert(result.project);
      return c.json({
        project: result.project,
        filesWalked: result.filesWalked,
        filesIndexed: result.filesIndexed,
        embedder: result.embedderId
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed: Project = { ...project, indexStatus: "failed", indexError: message };
      await projectStore.upsert(failed);
      return c.json({ error: `Indexing failed: ${message}` }, 502);
    }
  });

  app.get("/api/projects/:id/search", async (c) => {
    const project = projectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ error: "Missing ?q= query parameter" }, 400);

    const outcome = await index.search(project.id, q, c.req.query("route") ?? "", 5);
    return c.json({ query: q, backend: outcome.backend, matches: outcome.matches });
  });

  // ---------------------------------------------------------------- settings
  app.get("/api/settings", (c) =>
    c.json({ baseUrl: config.baseUrl, integrations: integrationStatuses() })
  );

  // ---------------------------------------------------------------- webhook
  app.post("/api/webhook/gh-push", async (c) => {
    if (!config.github.webhookSecret) return c.json({ error: "Webhook disabled" }, 404);

    const raw = await c.req.text();
    if (!verifyWebhookSignature(raw, c.req.header("x-hub-signature-256"))) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (eventZen(event) || event.ref === undefined) return c.json({ ok: true, ignored: true });

    const pushed = String(event.ref ?? "");
    const repoFullName = String(
      (event.repository as Record<string, unknown> | undefined)?.full_name ?? ""
    );
    const defaultBranch = String(
      (event.repository as Record<string, unknown> | undefined)?.default_branch ?? "main"
    );
    if (pushed !== `refs/heads/${defaultBranch}`) return c.json({ ok: true, ignored: "non-default branch" });

    const target = projectStore
      .list()
      .find((p) => p.repoFullName?.toLowerCase() === repoFullName.toLowerCase());
    if (!target) return c.json({ ok: true, ignored: "no project maps to this repository" });

    projectStore.upsert({ ...target, indexStatus: "indexing" });
    try {
      const result = await indexGitHubRepo(target, repoFullName, index);
      await projectStore.upsert(result.project);
      return c.json({ ok: true, reindexed: result.filesIndexed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await projectStore.upsert({ ...target, indexStatus: "failed", indexError: message });
      return c.json({ error: `Reindex failed: ${message}` }, 502);
    }
  });

  return app;
}

function eventZen(event: Record<string, unknown>): boolean {
  return event.zen !== undefined;
}

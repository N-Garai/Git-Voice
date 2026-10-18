/**
 * REST API surface (all JSON under /api, plus /health and /api/widget.js).
 *
 * Access model:
 *  - Dashboard READS and MUTATIONS are closed by default. A caller must be
 *    either the operator (`Authorization: Bearer <DASHBOARD_TOKEN>`) or a
 *    logged-in GitHub user whose session matches the project's owner. Report
 *    data (transcripts, telemetry, audio) is never served to anonymous users.
 *  - `POST /api/issue` is the widget's front door and stays open, protected by
 *    per-IP + hourly hosted-capacity limits instead.
 *  - GitHub publishing uses only the *project owner's own* OAuth token, so a
 *    report is always filed under the identity of the developer who owns the
 *    project — never under the server operator's credentials.
 */
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import crypto from "node:crypto";
import { config, integrationStatuses } from "../config.js";
import type { IssueRecord, Project } from "../types.js";
import { issueStore } from "../store/issues.js";
import { projectStore, makeProject } from "../store/projects.js";
import { preferenceStore } from "../store/preferences.js";
import type { VectorIndex } from "../store/vectorIndex.js";
import { runIssuePipeline } from "../workflow/issueWorkflow.js";
import { parseTelemetry } from "./schemas.js";
import { checkRateLimit, clientIp } from "./rateLimit.js";
import { claimHostedQuota } from "./quota.js";
import { indexFixtureProject, indexGitHubRepo, parseRepo } from "../indexer/indexProject.js";
import { DEMO_PROJECT_ID, DEMO_PROJECT_NAME } from "../indexer/fixtures.js";
import {
  verifyWebhookSignature,
  oauthAuthorizeUrl,
  exchangeOAuthCode,
  listUserRepos
} from "../services/github.js";
import {
  sessionStore,
  oauthConfigured,
  sessionIdFromCookie,
  sessionCookie,
  clearSessionCookie
} from "../store/sessions.js";
import {
  callerFrom,
  canReadProject,
  visibleProjects,
  visibleIssues,
  type Caller
} from "../store/access.js";
import {
  billingStore,
  describeEntitlements,
  PLANS as BILLING_PLANS,
  hasEntitlement,
  type Tier
} from "../billing/billing.js";

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

/** Resolve the pipeline's plan-gated capabilities for a project's owner. */
function entitlementsFor(project: Project): { hostedDrafting: boolean; premiumVoice: boolean } {
  if (!project.ownerLogin) return { hostedDrafting: true, premiumVoice: true };
  const profile = billingStore.profile(project.ownerLogin);
  return {
    hostedDrafting: hasEntitlement(profile.tier, "hosted-drafting"),
    premiumVoice: hasEntitlement(profile.tier, "premium-voice")
  };
}

/** Owner preferences that change what a filed report contains and where it goes. */
function preferencesFor(project: Project): {
  voiceConfirmation: boolean;
  draftReview: boolean;
  includeTelemetry: boolean;
  transcriptPreference: "auto" | "voice" | "typed";
} {
  if (!project.ownerLogin) {
    return { voiceConfirmation: true, draftReview: false, includeTelemetry: true, transcriptPreference: "auto" };
  }
  const prefs = preferenceStore.get(project.ownerLogin);
  return {
    voiceConfirmation: prefs.voiceConfirmation,
    draftReview: prefs.draftReview,
    includeTelemetry: prefs.includeTelemetry,
    transcriptPreference: prefs.transcriptPreference
  };
}

const UNAUTHORIZED = { error: "Unauthorized — log in with GitHub or provide the dashboard token." };

/**
 * Widget submissions must come from an authenticated caller.
 *
 * Rationale: without a session, anyone could burn the operator's hosted-model
 * quota and write into projects they do not own. Trade-off to be aware of: the
 * session cookie is SameSite=Lax, so a report filed from a *third-party*
 * staging site (the widget's normal deployment) will not carry it. In that
 * setup the widget's owner has to be signed in on that browser.
 */
const REPORTS_REQUIRE_SIGN_IN = true;

/** Logged-in GitHub session from the HttpOnly cookie (undefined when logged out). */
async function sessionFromCookie(cookieHeader: string | undefined) {
  return sessionStore.get(sessionIdFromCookie(cookieHeader));
}

/** Resolve the caller identity for this request. */
async function caller(c: { req: { header: (n: string) => string | undefined } }): Promise<Caller> {
  const session = await sessionFromCookie(c.req.header("cookie"));
  return callerFrom(session, { authorization: c.req.header("authorization") ?? "" });
}

/** Hono context narrowed to the bare surface these guards need. */
type GuardContext = {
  req: { header: (name: string) => string | undefined };
};

/**
 * Dashboard guards. These resolve the caller and report whether the request may
 * proceed — they never write a response, because a Hono handler that returns
 * `undefined` falls through to the 404 handler. Callers must branch on the
 * result and return `c.json(UNAUTHORIZED, 401)` themselves.
 */
type Guard<T = void> = (c: GuardContext, arg: T) => Promise<Caller | null>;

const allowRead = (async (c: GuardContext): Promise<Caller | null> => {
  const who = await caller(c);
  return !who.operator && !who.session ? null : who;
}) satisfies Guard<undefined>;

/** Guard for mutations on an existing project: operator or that project's owner. */
const allowWriteProject = (async (
  c: GuardContext,
  project: Project | undefined
): Promise<Caller | null> => {
  const who = await caller(c);
  if (who.operator) return who;
  return project && canReadProject(who, project, DEMO_PROJECT_ID) ? who : null;
}) satisfies Guard<Project | undefined>;

/** Guard for creating new projects — no project exists yet to scope against. */
const allowCreateProject = (async (c: GuardContext): Promise<Caller | null> => {
  const who = await caller(c);
  return !who.operator && !who.session ? null : who;
}) satisfies Guard<undefined>;

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
  // Every read below is tenant-scoped: a logged-in developer sees only reports
  // for projects stamped with their GitHub login; the operator sees all.
  app.get("/api/issues", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    const all = projectStore.list();
    const projectId = c.req.query("projectId") ?? undefined;
    if (projectId) {
      const project = projectStore.get(projectId);
      if (!canReadProject(who, project, DEMO_PROJECT_ID)) return c.json(UNAUTHORIZED, 401);
      return c.json({ issues: issueStore.list(projectId).map(issueSummary) });
    }
    return c.json({ issues: visibleIssues(who, issueStore.list(), all, DEMO_PROJECT_ID).map(issueSummary) });
  });

  app.get("/api/issues/:id", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    const record = issueStore.get(c.req.param("id"));
    if (!record) return c.json({ error: "Issue not found" }, 404);
    if (!canReadProject(who, projectStore.get(record.projectId), DEMO_PROJECT_ID)) {
      return c.json(UNAUTHORIZED, 401);
    }
    return c.json({ issue: issueSummary(record) });
  });

  app.get("/api/issues/:id/audio", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    const id = c.req.param("id");
    const record = issueStore.get(id);
    if (!record) return c.json({ error: "Issue not found" }, 404);
    if (!canReadProject(who, projectStore.get(record.projectId), DEMO_PROJECT_ID)) {
      return c.json(UNAUTHORIZED, 401);
    }
    const audio = issueStore.getAudio(id);
    if (!audio) return c.json({ error: "No audio attached to this report" }, 404);
    return c.body(Buffer.from(audio.base64, "base64"), 200, {
      "Content-Type": audio.mime,
      "Cache-Control": "private, no-store"
    });
  });

  app.get("/api/issues/:id/body.md", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    const record = issueStore.get(c.req.param("id"));
    if (!record) return c.json({ error: "Issue not found" }, 404);
    if (!canReadProject(who, projectStore.get(record.projectId), DEMO_PROJECT_ID)) {
      return c.json(UNAUTHORIZED, 401);
    }
    if (!record.result) return c.json({ error: "No draft for this report" }, 404);
    return c.body(record.result.draft.issueBody, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "private, no-store"
    });
  });

  app.post("/api/issue", async (c) => {
const submittingCaller = await caller(c);

    // Sign-in is required: an anonymous submission could otherwise spend the
    // operator's hosted quota and write into a project they do not own.
    if (REPORTS_REQUIRE_SIGN_IN && !submittingCaller.operator && !submittingCaller.session) {
      return c.json(
        { error: "Sign in with GitHub to file a report — anonymous submissions are disabled." },
        401
      );
    }

    // Layered limits on top of auth, so one signed-in user still cannot flood.
    const limit = checkRateLimit(clientIp(c.req.header()));
    if (!limit.allowed) {
      return c.json(
        { error: "Too many reports from this address — try again in a few minutes." },
        429,
        { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) }
      );
    }

    const quota = claimHostedQuota("authenticated");

let projectId = "";
    let transcript = "";
    let transcriptSource: "browser-speech" | "typed-report" | "telemetry-only" = "browser-speech";
    let telemetryRaw: unknown = {};
    let audio: { base64: string; mime: string } | undefined;
    let requestedRepo = "";

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
        requestedRepo = String(form.get("repoFullName") ?? "");
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
        requestedRepo = typeof body.repoFullName === "string" ? body.repoFullName.trim() : "";
      }
    } catch {
      return c.json({ error: "Malformed request body" }, 400);
    }

const targetProject = projectId ? projectStore.get(projectId) : undefined;
    if (!projectId || !targetProject) {
      return c.json({ error: "Unknown projectId — create the project first" }, 400);
    }

    // A report may only be filed into a project the caller owns (or the demo).
    // Otherwise any signed-in user could inject noise into someone else's log.
    if (!canReadProject(submittingCaller, targetProject, DEMO_PROJECT_ID)) {
      return c.json(UNAUTHORIZED, 401);
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

// Optional one-off destination: the developer can retarget this single report
    // to any repo they can access, without changing the project default.
    let repoOverride: string | undefined;
    const rawOverride = requestedRepo || targetProject.repoFullName;
    if (rawOverride) {
      try {
        const parsed = parseRepo(rawOverride);
        repoOverride = `${parsed.owner}/${parsed.repo}`;
      } catch {
        return c.json({ error: "repoFullName must look like owner/repo" }, 400);
      }
    }

    const record = await runIssuePipeline(
      {
        projectId,
        telemetry,
        audio,
        transcript: transcript || undefined,
        transcriptSource
      },
      index,
      { hostedQuota: quota, repoFullNameOverride: repoOverride, entitlements: entitlementsFor(targetProject), preferences: preferencesFor(targetProject) }
    );

    if (!record) return c.json({ error: "Pipeline failed before producing a record" }, 500);
    return c.json({ issue: issueSummary(record) }, 201);
  });

  // ---------------------------------------------------------------- projects
  app.get("/api/projects", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    return c.json({ projects: visibleProjects(who, projectStore.list(), DEMO_PROJECT_ID) });
  });

  app.get("/api/projects/:id", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    const project = projectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    if (!canReadProject(who, project, DEMO_PROJECT_ID)) return c.json(UNAUTHORIZED, 401);
    return c.json({ project });
  });

  app.post("/api/projects", async (c) => {
    const who = await allowCreateProject(c);
    if (!who) return c.json(UNAUTHORIZED, 401);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Expected JSON body" }, 400);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return c.json({ error: "A project name (1-80 chars) is required", }, 400);

    let repoFullName: string | undefined;
    if (typeof body.repoFullName === "string" && body.repoFullName.trim()) {
      try {
        repoFullName = `${parseRepo(body.repoFullName).owner}/${parseRepo(body.repoFullName).repo}`;
      } catch {
        return c.json({ error: "repoFullName must look like owner/repo" }, 400);
      }
    }

    const id = `prj_${crypto.randomUUID().slice(0, 12)}`;
    // Plan gate: how many projects the tier allows.
    const ownerLogin = who.session?.githubLogin;
    if (ownerLogin) {
      const profile = billingStore.profile(ownerLogin);
      const limit = BILLING_PLANS[profile.tier]?.projectLimit ?? 1;
      const owned = projectStore.list().filter((p) => p.ownerLogin?.toLowerCase() === ownerLogin.toLowerCase());
      if (owned.length >= limit) {
        return c.json(
          {
            error: `The ${profile.tier} plan includes ${limit} project${limit === 1 ? "" : "s"}. Upgrade to add another.`,
            tier: profile.tier,
            limit
          },
          402
        );
      }
    }

    // The creator's GitHub login becomes the project's owner. Every later
    // action on this project (index, publish) uses *their* token — the
    // server operator's credentials are never involved.
    const project = makeProject({
      id,
      name,
      repoFullName,
      ownerLogin
    });
    await projectStore.upsert(project);
    return c.json({ project }, 201);
  });

  app.post("/api/projects/:id/index", async (c) => {
    const project = projectStore.get(c.req.param("id"));
    const who = await allowWriteProject(c, project);
    if (!who) return c.json(UNAUTHORIZED, 401);
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

// Only ever the project owner's own credential: the operator's token is
    // never used, so indexing can never touch a repo the owner cannot read.
    // Private repositories are a paid capability.
    const ownerProfile = project.ownerLogin ? billingStore.profile(project.ownerLogin) : undefined;
    const privateAllowed = ownerProfile
      ? hasEntitlement(ownerProfile.tier, "private-repos")
      : true; // operator-triggered indexing on a repo they configured
    const ownerToken =
      project.ownerLogin && privateAllowed
        ? await sessionStore.tokenForLogin(project.ownerLogin)
        : undefined;
    if (project.ownerLogin && !privateAllowed) {
      await projectStore.upsert({
        ...project,
        indexStatus: "failed",
        indexError: "Private repository indexing requires the Freelancer plan or above."
      });
      return c.json(
        {
          error: "Private repository indexing is available on the Freelancer plan and above.",
          tier: ownerProfile?.tier,
          upgrade: true
        },
        402
      );
    }

    try {
      const result = isDemo || !repoInput
        ? await indexFixtureProject(project, index)
        : await indexGitHubRepo(project, repoInput, index, ownerToken);
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

  app.delete("/api/projects/:id", async (c) => {
    const id = c.req.param("id");
    const project = projectStore.get(id);
    const who = await allowWriteProject(c, project);
    if (!who) return c.json(UNAUTHORIZED, 401);
    if (!project) return c.json({ error: "Project not found" }, 404);

    // The bundled demo is part of the landing experience and is re-seeded on
    // boot, so it is never deletable.
    if (id === DEMO_PROJECT_ID) {
      return c.json({ error: "The bundled demo project cannot be deleted" }, 400);
    }

    // Purge in dependency order: index rows (incl. embeddings in Postgres),
    // stored reports + their audio, then the project row itself.
    await index.removeProject(id);
    const reports = issueStore.removeProject(id);
    const removed = await projectStore.remove(id);

    return c.json({ ok: true, deleted: { project: removed, reports, indexEntriesRemoved: true } });
  });

  app.get("/api/projects/:id/search", async (c) => {
    const project = projectStore.get(c.req.param("id"));
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    if (!project) return c.json({ error: "Project not found" }, 404);
    if (!canReadProject(who, project, DEMO_PROJECT_ID)) return c.json(UNAUTHORIZED, 401);
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ error: "Missing ?q= query parameter" }, 400);

    const outcome = await index.search(project.id, q, c.req.query("route") ?? "", 5);
    return c.json({ query: q, backend: outcome.backend, matches: outcome.matches });
  });

  // ---------------------------------------------------------------- settings
app.get("/api/settings", (c) =>
    c.json({ baseUrl: config.baseUrl, integrations: integrationStatuses() })
  );

  // ---------------------------------------------------------- preferences
  // Real, editable account settings. Everything the dashboard Settings tab
  // changes is stored here and read back by the pipeline.
  app.get("/api/preferences", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    const login = who.session?.githubLogin;
    if (!login) return c.json(UNAUTHORIZED, 401);
    return c.json({ preferences: preferenceStore.get(login) });
  });

  app.patch("/api/preferences", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    const login = who.session?.githubLogin;
    if (!login) return c.json(UNAUTHORIZED, 401);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Expected JSON body" }, 400);
    }
    return c.json({ preferences: preferenceStore.update(login, body) });
  });

  // ---------------------------------------------------------------- auth
  // GitHub OAuth login (free OAuth App). Logged-out users keep full access to
  // public repos; logging in additionally unlocks the user's private repos.
  // Disabled with a clear error until GITHUB_OAUTH_CLIENT_ID/SECRET are set.
  app.get("/api/auth/github", (c) => {
    if (!oauthConfigured()) return c.json({ error: "GitHub login not configured" }, 404);
    const state = sessionStore.createState();
    return c.redirect(oauthAuthorizeUrl(state), 302);
  });

  app.get("/api/auth/github/callback", async (c) => {
    if (!oauthConfigured()) return c.json({ error: "GitHub login not configured" }, 404);
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !sessionStore.consumeState(state)) {
      return c.redirect("/dashboard/projects?github=error", 302);
    }
    try {
      const account = await exchangeOAuthCode(code);
const session = await sessionStore.create(
        account.githubUserId,
        account.githubLogin,
        account.accessToken,
        account.avatarUrl
      );
      c.header("Set-Cookie", sessionCookie(session.id));
      return c.redirect("/dashboard/projects?github=connected", 302);
    } catch {
      return c.redirect("/dashboard/projects?github=error", 302);
    }
  });

  app.get("/api/auth/me", async (c) => {
    const session = await sessionFromCookie(c.req.header("cookie"));
    if (!session) return c.json({ user: null });
    return c.json({
      user: {
        login: session.githubLogin,
        id: session.githubUserId,
        avatarUrl: session.avatarUrl,
        profileUrl: `https://github.com/${session.githubLogin}`
      }
    });
  });

  // ---------------------------------------------------------------- billing
  // Plans, entitlements, simulated checkout and receipts. The tier stored here
  // is what the pipeline actually gates on, so the pricing page describes real
  // behaviour rather than marketing copy.
  app.get("/api/billing/plans", (c) =>
    c.json({
      plans: Object.values(BILLING_PLANS).map((p) => ({
        tier: p.tier,
        label: p.label,
        amountCents: p.amountCents,
        currency: p.currency,
        projectLimit: p.projectLimit,
        entitlements: p.entitlements
      })),
      simulation: true
    })
  );

  /** Current plan + entitlements + receipts for the signed-in account. */
  app.get("/api/billing/me", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    const login = who.operator ? "" : who.session?.githubLogin ?? "";
    if (!login) return c.json(UNAUTHORIZED, 401);

    const profile = billingStore.profile(login);
    return c.json({
      profile,
      entitlements: describeEntitlements(profile),
      invoices: billingStore.invoicesFor(login),
      projectLimit: BILLING_PLANS[profile.tier]?.projectLimit ?? 1
    });
  });

  app.post("/api/billing/checkout", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    const login = who.session?.githubLogin;
    if (!login) {
      return c.json({ error: "Sign in with GitHub to purchase a plan" }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Expected JSON body" }, 400);
    }

    const tier = body.tier as Tier;
    const method = body.method as "card" | "upi";
    if (!BILLING_PLANS[tier]) return c.json({ error: "Unknown plan" }, 400);
    if (method !== "card" && method !== "upi") {
      return c.json({ error: "Unsupported payment method" }, 400);
    }
    const instrument = typeof body.instrument === "string" ? body.instrument : "";
    if (!instrument.trim()) return c.json({ error: "Payment details are required" }, 400);

    const result = billingStore.checkout({ login, tier, method, instrument });
    if (!result.ok) {
      return c.json({ error: result.error }, (result.status ?? 400) as ContentfulStatusCode);
    }
    return c.json({ profile: result.profile, invoice: result.invoice }, 201);
  });

  app.post("/api/billing/cancel", async (c) => {
    const who = await allowRead(c);
    if (!who) return c.json(UNAUTHORIZED, 401);
    const login = who.session?.githubLogin;
    if (!login) return c.json(UNAUTHORIZED, 401);
    return c.json({ profile: billingStore.cancel(login) });
  });

  app.post("/api/auth/logout", async (c) => {
    const id = sessionIdFromCookie(c.req.header("cookie"));
    if (id) await sessionStore.destroy(id);
    c.header("Set-Cookie", clearSessionCookie());
    return c.json({ ok: true });
  });

  app.get("/api/repos", async (c) => {
    if (!oauthConfigured()) return c.json({ error: "GitHub login not configured" }, 404);
    const session = await sessionFromCookie(c.req.header("cookie"));
    if (!session) return c.json({ error: "Login with GitHub first" }, 401);
    try {
      return c.json({ repos: await listUserRepos(session.token) });
    } catch {
      return c.json({ error: "Could not list repositories — try logging in again" }, 502);
    }
  });

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
    // Webhooks carry no user session — use the owner's stored token so
    // private-repo projects still reindex; public repos work without one.
    // Automatic re-indexing is a paid capability.
    const ownerProfile = target.ownerLogin ? billingStore.profile(target.ownerLogin) : undefined;
    const autoReindexAllowed = ownerProfile
      ? hasEntitlement(ownerProfile.tier, "auto-reindex")
      : true; // operator-configured deployment
    if (!autoReindexAllowed) {
      await projectStore.upsert({
        ...target,
        indexStatus: "empty",
        indexError: undefined
      });
      return c.json({
        ok: true,
        ignored: "automatic re-index on push requires the Freelancer plan or above",
        tier: ownerProfile?.tier,
        upgrade: true
      });
    }
    const ownerToken = target.ownerLogin
      ? await sessionStore.tokenForLogin(target.ownerLogin)
      : undefined;
    try {
      const result = await indexGitHubRepo(target, repoFullName, index, ownerToken);
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

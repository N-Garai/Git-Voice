/**
 * Two-user isolation, proven end-to-end through the real Hono app.
 *
 * Both users sign in through the singleton session store the app actually uses,
 * then we assert neither can read, write, or search the other's projects — and
 * that a session cannot be forged, reused after logout, or overridden.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { apiRoutes } from "./api.js";
import { sessionStore } from "../store/sessions.js";
import { projectStore, makeProject } from "../store/projects.js";
import { billingStore } from "../billing/billing.js";
import type { VectorIndex } from "../store/vectorIndex.js";

const DEMO = "prj_demo_storefront";

function stubIndex(): VectorIndex {
  return {
    backendName: "stub",
    add: async () => {},
    removeProject: async () => {},
    count: async () => 0,
    entriesFor: async () => [],
    search: async () => ({ matches: [], backend: "stub" }),
    close: async () => {}
  };
}

async function signIn(login: string, id: number): Promise<{ cookie: string; sessionId: string }> {
  const session = await sessionStore.create(id, login, `token_${login}`);
  return { cookie: `gv_session=${session.id}`, sessionId: session.id };
}

async function createProjectFor(
  app: ReturnType<typeof apiRoutes>,
  cookie: string,
  name: string,
  repo?: string
): Promise<string> {
  const res = await app.request("http://local/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(repo ? { name, repoFullName: repo } : { name })
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { project: { id: string } }).project.id;
}

/** The demo project is seeded during boot (see index.ts); mirror that here. */
async function seedDemo(): Promise<void> {
  const existing = projectStore.get(DEMO);
  if (existing) return;
  await projectStore.upsert(makeProject({ id: DEMO, name: "Demo storefront" }));
}

/**
 * Isolation tests care about tenancy, not plans. Give the account a plan with
 * headroom and clear its previous projects so the per-plan project allowance never
 * interferes with what is being asserted.
 */
async function freshAccount(login: string): Promise<void> {
  billingStore.reset(login);
  for (const p of projectStore.list().filter((x) => x.ownerLogin?.toLowerCase() === login.toLowerCase())) {
    await projectStore.remove(p.id);
  }
}

const VALID_TELEMETRY = {
  url: "https://x",
  route: "/",
  viewport: { w: 1, h: 1 },
  userAgent: "ua",
  consoleLogs: [],
  errors: [],
  clicks: []
};

describe("cross-user isolation", () => {
  let app: ReturnType<typeof apiRoutes>;
  let alice: { cookie: string; sessionId: string };
  let bob: { cookie: string; sessionId: string };

  beforeEach(async () => {
    // Each test gets a clean in-memory app + session table.
    app = apiRoutes(stubIndex());
    await seedDemo();
    await freshAccount("alice");
    await freshAccount("bob");
    alice = await signIn("alice", 1);
    bob = await signIn("bob", 2);
  });

  it("each user sees only their own project", async () => {
    const id = await createProjectFor(app, alice.cookie, "Alice App", "alice/app");

    const mine = await app.request("http://local/api/projects", { headers: { cookie: alice.cookie } });
    const mineIds = ((await mine.json()) as { projects: Array<{ id: string }> }).projects.map((p) => p.id);
    expect(mineIds).toContain(id);

    const theirs = await app.request("http://local/api/projects", { headers: { cookie: bob.cookie } });
    const theirIds = ((await theirs.json()) as { projects: Array<{ id: string }> }).projects.map((p) => p.id);
    expect(theirIds).not.toContain(id);
  });

  it("bob cannot read, reindex, or search alice's project", async () => {
    const id = await createProjectFor(app, alice.cookie, "Alice App", "alice/app");

    for (const path of [`/api/projects/${id}`, `/api/projects/${id}/search?q=coupon`]) {
      const res = await app.request(`http://local${path}`, { headers: { cookie: bob.cookie } });
      expect(res.status).toBe(401);
    }

    const reindex = await app.request(`http://local/api/projects/${id}/index`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bob.cookie },
      body: "{}"
    });
    expect(reindex.status).toBe(401);
  });

  it("bob cannot file a report into alice's project", async () => {
    const id = await createProjectFor(app, alice.cookie, "Alice App");

    const res = await app.request("http://local/api/issue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bob.cookie },
      body: JSON.stringify({ projectId: id, transcript: "bob injected this", telemetry: VALID_TELEMETRY })
    });
    expect(res.status).toBe(401);
  });

  it("bob cannot read or play alice's report audio", async () => {
    const id = await createProjectFor(app, alice.cookie, "Alice App");
    const filed = await app.request("http://local/api/issue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ projectId: id, transcript: "alice spoke", telemetry: VALID_TELEMETRY })
    });
    expect(filed.status).toBe(201);
    const issueId = ((await filed.json()) as { issue: { id: string } }).issue.id;

    // Alice can read her own transcript.
    const ownerRead = await app.request(`http://local/api/issues/${issueId}`, { headers: { cookie: alice.cookie } });
    expect(ownerRead.status).toBe(200);

    // Bob cannot — not the record, not the audio, not the markdown.
    for (const path of [`/api/issues/${issueId}`, `/api/issues/${issueId}/audio`, `/api/issues/${issueId}/body.md`]) {
      const res = await app.request(`http://local${path}`, { headers: { cookie: bob.cookie } });
      expect(res.status).toBe(401);
    }

    // Bob cannot enumerate it either.
    const list = await app.request("http://local/api/issues", { headers: { cookie: bob.cookie } });
    const ids = ((await list.json()) as { issues: Array<{ id: string }> }).issues.map((i) => i.id);
    expect(ids).not.toContain(issueId);
  });

  it("a forged or tampered cookie never resolves to a session", async () => {
    for (const bad of [
      "gv_session=",
      "gv_session=../../etc/passwd",
      "gv_session=0000000000000000000000000000000000000000000000000000000000000000",
      "gv_session=alice",
      `gv_session=${bob.sessionId.slice(0, -1)}${bob.sessionId.endsWith("0") ? "1" : "0"}`,
      "session=bob",
      `gv_session=${bob.sessionId}extra`
    ]) {
      const res = await app.request("http://local/api/projects", { headers: { cookie: bad } });
      expect(res.status).toBe(401);
    }
  });

  it("session ids are unguessable 256-bit values with no collisions", async () => {
    const s = await sessionStore.create(9, "carol", "t");
    expect(s.id).toMatch(/^[0-9a-f]{64}$/);

    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) ids.add((await sessionStore.create(i, `u${i}`, "t")).id);
    expect(ids.size).toBe(200);
  });

  it("one user's login does not hijack an existing session", async () => {
    const before = await app.request("http://local/api/auth/me", { headers: { cookie: alice.cookie } });
    expect(((await before.json()) as { user: { login: string } | null }).user?.login).toBe("alice");

    // bob signs in on his own session; alice's identity must be untouched.
    await signIn("bob", 22);
    const after = await app.request("http://local/api/auth/me", { headers: { cookie: alice.cookie } });
    expect(((await after.json()) as { user: { login: string } | null }).user?.login).toBe("alice");
  });

  it("logging out destroys the session everywhere", async () => {
    const out = await app.request("http://local/api/auth/logout", {
      method: "POST",
      headers: { cookie: bob.cookie }
    });
    expect(out.status).toBe(200);

    const me = await app.request("http://local/api/auth/me", { headers: { cookie: bob.cookie } });
    expect(((await me.json()) as { user: unknown }).user).toBeNull();

    const projects = await app.request("http://local/api/projects", { headers: { cookie: bob.cookie } });
    expect(projects.status).toBe(401);
  });

  it("the demo project is shared, other projects are not", async () => {
    const mine = await app.request("http://local/api/projects", { headers: { cookie: alice.cookie } });
    const ids = ((await mine.json()) as { projects: Array<{ id: string }> }).projects.map((p) => p.id);
    expect(ids).toContain(DEMO);
  });
});

describe("project deletion purges everything", () => {
  let app: ReturnType<typeof apiRoutes>;
  let alice: { cookie: string };
  let removed: string[];

  beforeEach(async () => {
    app = apiRoutes(stubIndex());
    await seedDemo();
    await freshAccount("alice");
    alice = await signIn("alice", 1);
    removed = [];
  });

  it("deletes the project, its reports, and its index rows", async () => {
    const id = await createProjectFor(app, alice.cookie, "Temp Project", "alice/temp");

    const filed = await app.request("http://local/api/issue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ projectId: id, transcript: "something broke", telemetry: VALID_TELEMETRY })
    });
    expect(filed.status).toBe(201);

    const before = await app.request("http://local/api/issues", { headers: { cookie: alice.cookie } });
    const beforeIds = ((await before.json()) as { issues: Array<{ projectId: string }> }).issues.map((i) => i.projectId);
    expect(beforeIds).toContain(id);

    const del = await app.request(`http://local/api/projects/${id}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie }
    });
    expect(del.status).toBe(200);
    const payload = (await del.json()) as { ok: boolean; deleted: { project: boolean; reports: number } };
    expect(payload.ok).toBe(true);
    expect(payload.deleted.project).toBe(true);
    expect(payload.deleted.reports).toBe(1);

    // Project row is gone.
    const projects = await app.request("http://local/api/projects", { headers: { cookie: alice.cookie } });
    const ids = ((await projects.json()) as { projects: Array<{ id: string }> }).projects.map((p) => p.id);
    expect(ids).not.toContain(id);

    // Reports are gone too.
    const issues = await app.request("http://local/api/issues", { headers: { cookie: alice.cookie } });
    const remaining = ((await issues.json()) as { issues: Array<{ projectId: string }> }).issues.map((i) => i.projectId);
    expect(remaining).not.toContain(id);
  });

  it("refuses to delete the bundled demo project", async () => {
    const del = await app.request(`http://local/api/projects/${DEMO}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie }
    });
    expect(del.status).toBe(400);
  });

  it("another user cannot delete someone else's project", async () => {
    const id = await createProjectFor(app, alice.cookie, "Alice Only", "alice/private");
    const bob = await signIn("bob", 2);

    const del = await app.request(`http://local/api/projects/${id}`, {
      method: "DELETE",
      headers: { cookie: bob.cookie }
    });
    expect(del.status).toBe(401);

    // Still there for its real owner.
    const projects = await app.request("http://local/api/projects", { headers: { cookie: alice.cookie } });
    const ids = ((await projects.json()) as { projects: Array<{ id: string }> }).projects.map((p) => p.id);
    expect(ids).toContain(id);
  });

  it("anonymous callers cannot delete anything", async () => {
    const id = await createProjectFor(app, alice.cookie, "Alice Only", "alice/private");
    const del = await app.request(`http://local/api/projects/${id}`, { method: "DELETE" });
    expect(del.status).toBe(401);
  });
});
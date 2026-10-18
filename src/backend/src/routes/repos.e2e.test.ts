/**
 * Repository availability per plan.
 *
 * The pricing matrix puts "Private repositories" behind Freelancer and above,
 * so every route that can reveal or index a repo must agree: the picker hides
 * private listings on Hobby, and create/index reject a private owner/repo
 * with an upgrade message instead of a later cryptic failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VectorIndex } from "../store/vectorIndex.js";

process.env.GITHUB_OAUTH_CLIENT_ID = "test-client";
process.env.GITHUB_OAUTH_CLIENT_SECRET = "test-secret";

const { apiRoutes } = await import("./api.js");
const { sessionStore } = await import("../store/sessions.js");
const { projectStore, makeProject } = await import("../store/projects.js");
const { billingStore } = await import("../billing/billing.js");

const HOBBY = "superhobby";
const PAID = "paidone";

const GH_LIST = [
  { full_name: "nayana/public-one", private: false, default_branch: "main" },
  { full_name: "nayana/secret-repo", private: true, default_branch: "main" },
  { full_name: "nayana/public-two", private: false, default_branch: "main" }
];

function fakeGitHub(): unknown {
  return (async (input: unknown) => {
    const url = String(input);
    if (url.includes("api.github.com/user/repos")) {
      return new Response(JSON.stringify(GH_LIST), { status: 200 });
    }
    if (url.includes("api.github.com/repos/")) {
      const name = url.replace(/^https:\/\/api\.github\.com\/repos\//, "");
      return new Response(JSON.stringify({ private: name.includes("secret") }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }) as typeof fetch;
}

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

async function signIn(login: string, id: number): Promise<string> {
  const s = await sessionStore.create(id, login, "gh-token");
  return `gv_session=${s.id}`;
}

describe("repo availability per plan", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fakeGitHub());
    billingStore.reset(HOBBY);
    billingStore.reset(PAID);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists public repositories only on Hobby", async () => {
    const app = apiRoutes(stubIndex());
    const cookie = await signIn(HOBBY, 701);
    const res = await app.request("http://local/api/repos", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      repos: Array<{ fullName: string }>; plan: string; publicOnly: boolean;
    };
    expect(body.plan).toBe("hobby");
    expect(body.publicOnly).toBe(true);
    expect(body.repos.map((r) => r.fullName)).toEqual(["nayana/public-one", "nayana/public-two"]);
  });

  it("includes private repositories once the plan allows them", async () => {
    const app = apiRoutes(stubIndex());
    await billingStore.checkout({ login: PAID, tier: "freelancer", method: "card", instrument: "4242424242424242" });
    const cookie = await signIn(PAID, 702);
    const res = await app.request("http://local/api/repos", { headers: { cookie } });
    const body = (await res.json()) as { repos: Array<{ fullName: string; isPrivate: boolean }>; publicOnly: boolean };
    expect(body.publicOnly).toBe(false);
    const secret = body.repos.find((r) => r.fullName === "nayana/secret-repo");
    expect(secret?.isPrivate).toBe(true);
  });

  it("rejects a private repo at create time on Hobby with an upgrade message", async () => {
    const app = apiRoutes(stubIndex());
    const cookie = await signIn(HOBBY, 703);
    const res = await app.request("http://local/api/projects", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Client site", repoFullName: "nayana/secret-repo" })
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; tier: string; upgrade: boolean };
    expect(body.tier).toBe("hobby");
    expect(body.upgrade).toBe(true);
    expect(body.error).toContain("Freelancer");
    expect(projectStore.list().filter((p) => p.ownerLogin === HOBBY)).toHaveLength(0);
  });

  it("keeps public repos available on Hobby", async () => {
    const app = apiRoutes(stubIndex());
    const cookie = await signIn(HOBBY, 704);
    const res = await app.request("http://local/api/projects", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Client site", repoFullName: "nayana/public-one" })
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { id: string; repoFullName?: string } };
    expect(body.project.repoFullName).toBe("nayana/public-one");
    await projectStore.remove(body.project.id);
  });

  it("lets a paid plan create a project on a private repo", async () => {
    const app = apiRoutes(stubIndex());
    await billingStore.checkout({ login: PAID, tier: "freelancer", method: "card", instrument: "4242424242424242" });
    const cookie = await signIn(PAID, 705);
    const res = await app.request("http://local/api/projects", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Client site", repoFullName: "nayana/secret-repo" })
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { id: string } };
    await projectStore.remove(body.project.id);
  });

  it("refuses to index a private repo for a Hobby owner", async () => {
    const app = apiRoutes(stubIndex());
    const cookie = await signIn(HOBBY, 706);
    await projectStore.upsert(
      makeProject({ id: "prj_secretidx", name: "Secret", repoFullName: "nayana/secret-repo", ownerLogin: HOBBY })
    );
    try {
      const res = await app.request("http://local/api/projects/prj_secretidx/index", { method: "POST", headers: { cookie } });
      expect(res.status).toBe(402);
      const body = (await res.json()) as { error: string; tier: string };
      expect(body.error).toContain("Freelancer");
      expect(body.tier).toBe("hobby");
      expect(projectStore.get("prj_secretidx")?.indexStatus).toBe("failed");
    } finally {
      await projectStore.remove("prj_secretidx");
    }
  });

  it("indexes a public repo for a Hobby owner without plan friction", async () => {
    const app = apiRoutes(stubIndex());
    const cookie = await signIn(HOBBY, 707);
    await projectStore.upsert(
      makeProject({ id: "prj_pubidx", name: "Open", repoFullName: "nayana/public-one", ownerLogin: HOBBY })
    );
    try {
      const res = await app.request("http://local/api/projects/prj_pubidx/index", { method: "POST", headers: { cookie } });
      // Indexing itself hits the network beyond this stub; the plan gate must
      // not be what stops it — a plan refusal would be 402, not 502.
      expect(res.status).not.toBe(402);
    } finally {
      await projectStore.remove("prj_pubidx");
    }
  });
});

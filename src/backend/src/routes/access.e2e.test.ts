import { describe, expect, it } from "vitest";
import { apiRoutes } from "./api.js";
import type { VectorIndex } from "../store/vectorIndex.js";

/**
 * Verifies the *routing-level* guarantee: with no operator key and no login,
 * every dashboard data route must answer 401 — no transcripts, no telemetry,
 * no audio, no project inventory leaking to anonymous visitors.
 */
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

const app = () => apiRoutes(stubIndex());

const PROTECTED: Array<[string, string]> = [
  ["GET", "/api/issues"],
  ["GET", "/api/issues/abc"],
  ["GET", "/api/issues/abc/audio"],
  ["GET", "/api/issues/abc/body.md"],
  ["GET", "/api/projects"],
  ["GET", "/api/projects/abc"],
  ["GET", "/api/projects/abc/search?q=coupon"],
  ["POST", "/api/projects"],
  ["POST", "/api/projects/abc/index"]
];

describe("anonymous dashboard access", () => {
  for (const [method, path] of PROTECTED) {
    it(`${method} ${path} is closed`, async () => {
      const res = await app().request(`http://local${path}`, { method });
      expect(res.status).toBe(401);
    });
  }
});

describe("sign-in covers report filing", () => {
  const PROTECTED_REPORTS: Array<[string, string]> = [
    ["POST", "/api/issue"]
  ];

  for (const [method, path] of PROTECTED_REPORTS) {
    it(`${method} ${path} rejects anonymous callers`, async () => {
      const res = await app().request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "prj_demo_storefront", telemetry: {} })
      });
      expect(res.status).toBe(401);
    });
  }
});

describe("public surface stays reachable", () => {
  it("serves the health probe", async () => {
    const res = await app().request("http://local/health");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("rejects anonymous report filing", async () => {
    const res = await app().request("http://local/api/issue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "prj_demo_storefront", telemetry: {} })
    });
    expect(res.status).toBe(401);
  });

  it("reports who you are without leaking anything", async () => {
    const res = await app().request("http://local/api/auth/me");
    expect(res.status).toBe(200);
    expect((await res.json()).user).toBeNull();
  });
});
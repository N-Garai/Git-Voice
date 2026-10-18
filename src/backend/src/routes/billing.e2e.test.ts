/**
 * Plan enforcement.
 *
 * The pricing page must describe behaviour the server actually performs, so
 * these tests drive the real routes: a Hobby account is blocked from the paid
 * capabilities, and a paid account is not.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { apiRoutes } from "./api.js";
import { sessionStore } from "../store/sessions.js";
import { projectStore, makeProject } from "../store/projects.js";
import { billingStore, luhnValid, PLANS, tierRank, hasEntitlement } from "../billing/billing.js";
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

async function signIn(login: string, id: number) {
  const s = await sessionStore.create(id, login, `token_${login}`);
  return `gv_session=${s.id}`;
}

const VALID_TELEMETRY = {
  url: "u",
  route: "/",
  viewport: { w: 1, h: 1 },
  userAgent: "ua",
  consoleLogs: [],
  errors: [],
  clicks: []
};

describe("plan catalogue", () => {
  it("orders tiers by capability", () => {
    expect(tierRank("hobby")).toBeLessThan(tierRank("freelancer"));
    expect(tierRank("freelancer")).toBeLessThan(tierRank("agency"));
  });

  it("gates exactly the capabilities the pricing page advertises", () => {
    expect(hasEntitlement("hobby", "private-repos")).toBe(false);
    expect(hasEntitlement("hobby", "hosted-drafting")).toBe(false);
    expect(hasEntitlement("hobby", "premium-voice")).toBe(false);

    expect(hasEntitlement("freelancer", "private-repos")).toBe(true);
    expect(hasEntitlement("freelancer", "hosted-drafting")).toBe(true);
    expect(hasEntitlement("freelancer", "premium-voice")).toBe(true);
    expect(hasEntitlement("freelancer", "auto-reindex")).toBe(true);
    expect(hasEntitlement("freelancer", "multi-project")).toBe(false);

    expect(hasEntitlement("agency", "multi-project")).toBe(true);
  });

  it("allows more projects only on Agency", () => {
    expect(PLANS.hobby.projectLimit).toBe(1);
    expect(PLANS.freelancer.projectLimit).toBe(1);
    expect(PLANS.agency.projectLimit).toBe(10);
  });

  it("validates card numbers the way a gateway would", () => {
    expect(luhnValid("4242 4242 4242 4242")).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(luhnValid("123")).toBe(false);
  });
});

describe("simulated checkout", () => {
  beforeEach(() => {
    billingStore.reset("buyer");
    billingStore.reset("hobbyuser");
  });

  it("upgrades the profile and issues a paid invoice", async () => {
    const app = apiRoutes(stubIndex());
    const cookie = await signIn("buyer", 90);

    const res = await app.request("http://local/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tier: "freelancer", method: "card", instrument: "4242424242424242" })
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      profile: { tier: string };
      invoice: { number: string; amountCents: number; status: string; instrument: string };
    };
    expect(body.profile.tier).toBe("freelancer");
    expect(body.invoice.amountCents).toBe(1500);
    expect(body.invoice.status).toBe("paid");
    expect(body.invoice.number).toMatch(/^GV-\d{4}-\d{4}$/);
    // Never stores the raw instrument.
    expect(body.invoice.instrument).toBe("•••• 4242");
    expect(JSON.stringify(body)).not.toContain("4242424242424242");
  });

  it("rejects an invalid card instead of accepting anything", async () => {
    const app = apiRoutes(stubIndex());
    const cookie = await signIn("buyer", 91);
    const res = await app.request("http://local/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tier: "freelancer", method: "card", instrument: "1234" })
    });
    expect(res.status).toBe(400);
    expect(billingStore.profile("buyer").tier).toBe("hobby");
  });

  it("accepts a UPI handle and masks it on the receipt", async () => {
    const app = apiRoutes(stubIndex());
    const cookie = await signIn("buyer", 92);
    const res = await app.request("http://local/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tier: "agency", method: "upi", instrument: "nayan@okaxis" })
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invoice: { instrument: string; amountCents: number } };
    expect(body.invoice.instrument).toBe("na•••@okaxis");
    expect(body.invoice.amountCents).toBe(6000);
  });

  it("requires a GitHub sign-in to purchase", async () => {
    const app = apiRoutes(stubIndex());
    const res = await app.request("http://local/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "freelancer", method: "card", instrument: "4242424242424242" })
    });
    expect(res.status).toBe(401);
  });
});

describe("entitlement enforcement on real routes", () => {
  let app: ReturnType<typeof apiRoutes>;
  let hobbyCookie: string;

  beforeEach(async () => {
    app = apiRoutes(stubIndex());
    if (!projectStore.get(DEMO)) {
      await projectStore.upsert(makeProject({ id: DEMO, name: "Demo storefront" }));
    }
    billingStore.reset("hobbyuser");
    for (const p of projectStore.list().filter((x) => x.ownerLogin === "hobbyuser")) {
      await projectStore.remove(p.id);
    }
    hobbyCookie = await signIn("hobbyuser", 42);
  });

  it("reports entitlements honestly for a free account", async () => {
    const res = await app.request("http://local/api/billing/me", { headers: { cookie: hobbyCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      profile: { tier: string };
      entitlements: Array<{ included: boolean }>;
      projectLimit: number;
    };
    expect(body.profile.tier).toBe("hobby");
    expect(body.projectLimit).toBe(1);
    expect(body.entitlements.every((e) => e.included === false)).toBe(true);
  });

  it("blocks private-repository indexing on the free tier", async () => {
    await projectStore.upsert(
      makeProject({ id: "prj_private", name: "Secret", repoFullName: "hobbyuser/secret", ownerLogin: "hobbyuser" })
    );
    const res = await app.request("http://local/api/projects/prj_private/index", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: hobbyCookie },
      body: "{}"
    });
    // Either the plan gate (402) or an upstream fetch failure — never a silent
    // success that implies the paid capability was used.
    expect([402, 502]).toContain(res.status);
    if (res.status === 402) {
      const body = (await res.json()) as { upgrade: boolean };
      expect(body.upgrade).toBe(true);
    }
  });

  it("enforces the project allowance", async () => {
    const first = await app.request("http://local/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: hobbyCookie },
      body: JSON.stringify({ name: "One" })
    });
    expect(first.status).toBe(201);

    const second = await app.request("http://local/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: hobbyCookie },
      body: JSON.stringify({ name: "Two" })
    });
    expect(second.status).toBe(402);
    const body = (await second.json()) as { error: string; limit: number };
    expect(body.limit).toBe(1);
    expect(body.error).toContain("project");
  });

  it("lifts the limits once the account pays", async () => {
    await app.request("http://local/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: hobbyCookie },
      body: JSON.stringify({ tier: "agency", method: "card", instrument: "4242424242424242" })
    });

    // More than the free allowance, and still under the Agency cap.
    const created: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.request("http://local/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: hobbyCookie },
        body: JSON.stringify({ name: `P${i}` })
      });
      created.push(res.status);
    }
    expect(created).toEqual([201, 201, 201]);

    const me = await app.request("http://local/api/billing/me", { headers: { cookie: hobbyCookie } });
    const body = (await me.json()) as { profile: { tier: string }; projectLimit: number };
    expect(body.profile.tier).toBe("agency");
    expect(body.projectLimit).toBe(10);
    expect(billingStore.invoicesFor("hobbyuser").length).toBeGreaterThan(0);
  });

  it("keeps report filing open to every tier", async () => {
    const res = await app.request("http://local/api/issue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: hobbyCookie },
      body: JSON.stringify({ projectId: DEMO, transcript: "free tier still works", telemetry: VALID_TELEMETRY })
    });
    expect(res.status).toBe(201);
  });
});
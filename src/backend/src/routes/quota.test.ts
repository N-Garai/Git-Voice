import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimHostedQuota, hostedQuotaSnapshot, resetHostedQuota } from "./quota.js";

const ORIGINAL_KEY = process.env.GOOGLE_API_KEY;

beforeEach(() => {
  resetHostedQuota();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = ORIGINAL_KEY;
});

describe("hosted quota", () => {
  it("is unlimited when no hosted key is configured", () => {
    delete process.env.GOOGLE_API_KEY;
    for (let i = 0; i < 500; i++) {
      expect(claimHostedQuota("anonymous").allowed).toBe(true);
    }
  });

  it("caps anonymous traffic at a reserved slice", () => {
    process.env.GOOGLE_API_KEY = "test-key";
    let anonAllowed = 0;
    for (let i = 0; i < 500; i++) {
      if (claimHostedQuota("anonymous").allowed) anonAllowed++;
    }
    expect(anonAllowed).toBeGreaterThan(0);
    expect(anonAllowed).toBeLessThanOrEqual(30);
  });

  it("keeps authenticated traffic working after anonymous is exhausted", () => {
    process.env.GOOGLE_API_KEY = "test-key";
    for (let i = 0; i < 500; i++) claimHostedQuota("anonymous");
    expect(claimHostedQuota("authenticated").allowed).toBe(true);
  });

  it("degrades instead of throwing when the whole budget is spent", () => {
    process.env.GOOGLE_API_KEY = "test-key";
    let blocked = 0;
    for (let i = 0; i < 1000; i++) {
      if (!claimHostedQuota("authenticated").allowed) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
    expect(hostedQuotaSnapshot().anonymous + hostedQuotaSnapshot().authenticated).toBeLessThanOrEqual(120);
  });

  it("reports a retry hint when blocked", () => {
    process.env.GOOGLE_API_KEY = "test-key";
    for (let i = 0; i < 500; i++) claimHostedQuota("anonymous");
    const decision = claimHostedQuota("anonymous");
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBeGreaterThan(0);
    expect(decision.reason).toContain("offline engine");
  });
});
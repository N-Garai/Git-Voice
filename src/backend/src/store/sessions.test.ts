import { describe, expect, it } from "vitest";
import {
  SessionStore,
  sessionIdFromCookie,
  sessionCookie,
  clearSessionCookie
} from "./sessions.js";

describe("oauth state", () => {
  it("is single-use", () => {
    const store = new SessionStore();
    const state = store.createState();
    expect(store.consumeState(state)).toBe(true);
    expect(store.consumeState(state)).toBe(false);
  });

  it("rejects missing states", () => {
    const store = new SessionStore();
    expect(store.consumeState(undefined)).toBe(false);
    expect(store.consumeState("nope")).toBe(false);
  });
});

describe("session cookies", () => {
  it("round-trips the session id", () => {
    const id = "a".repeat(64);
    const header = sessionCookie(id);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(sessionIdFromCookie(`other=1; gv_session=${id}; x=y`)).toBe(id);
  });

  it("rejects malformed ids", () => {
    expect(sessionIdFromCookie("gv_session=short")).toBeUndefined();
    expect(sessionIdFromCookie("gv_session=not-hex-!!!!")).toBeUndefined();
    expect(sessionIdFromCookie(undefined)).toBeUndefined();
  });

  it("clears on logout", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});

describe("token resolution", () => {
  it("returns the live token for a login (case-insensitive)", async () => {
    const store = new SessionStore();
    await store.create(123, "OctoCat", "tok_abc");
    await expect(store.tokenForLogin("octocat")).resolves.toBe("tok_abc");
    await expect(store.tokenForLogin("someone-else")).resolves.toBeUndefined();
  });
});

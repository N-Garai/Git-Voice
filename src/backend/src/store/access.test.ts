import { describe, expect, it } from "vitest";
import { isOperator, canReadProject, visibleIssues, visibleProjects, type Caller } from "./access.js";
import type { IssueRecord, Project } from "../types.js";

const DEMO = "prj_demo_storefront";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "prj_a",
    name: "A",
    createdAt: "2026-01-01T00:00:00.000Z",
    indexCount: 0,
    embedderId: "hashed",
    indexStatus: "empty",
    ...over
  };
}

function issue(id: string, projectId: string): IssueRecord {
  return {
    id,
    projectId,
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    telemetry: {
      url: "https://x",
      route: "/",
      viewport: { w: 1, h: 1 },
      userAgent: "ua",
      consoleLogs: [],
      errors: [],
      clicks: []
    },
    trace: []
  };
}

const operator: Caller = { operator: true };
const alice: Caller = { operator: false, session: { id: "s", githubUserId: 1, githubLogin: "alice", token: "t", createdAt: "", expiresAt: "" } };
const bob: Caller = { operator: false, session: { id: "s", githubUserId: 2, githubLogin: "bob", token: "t", createdAt: "", expiresAt: "" } };
const anon: Caller = { operator: false };

describe("operator key", () => {
  it("is rejected when unset or wrong", () => {
    // DASHBOARD_TOKEN is unset in the test env, so nothing can authenticate.
    expect(isOperator({ authorization: "Bearer anything" })).toBe(false);
    expect(isOperator({})).toBe(false);
    expect(isOperator({ authorization: "Basic abc" })).toBe(false);
  });
});

describe("project visibility", () => {
  it("gives the operator everything", () => {
    expect(canReadProject(operator, project(), DEMO)).toBe(true);
    expect(canReadProject(operator, undefined, DEMO)).toBe(false);
  });

  it("shows the demo project to signed-in users but not anonymous ones", () => {
    const demo = project({ id: DEMO });
    expect(canReadProject(alice, demo, DEMO)).toBe(true);
    expect(canReadProject(anon, demo, DEMO)).toBe(false);
  });

  it("isolates tenants by owner login, case-insensitively", () => {
    const mine = project({ ownerLogin: "Alice" });
    expect(canReadProject(alice, mine, DEMO)).toBe(true);
    expect(canReadProject(bob, mine, DEMO)).toBe(false);
    expect(canReadProject(anon, mine, DEMO)).toBe(false);
  });

  it("never leaks a project with no owner to a tenant", () => {
    expect(canReadProject(alice, project(), DEMO)).toBe(false);
  });
});

describe("list scoping", () => {
  const projects = [
    project({ id: "p_alice", ownerLogin: "alice" }),
    project({ id: "p_bob", ownerLogin: "bob" }),
    project({ id: DEMO })
  ];
  const issues = [issue("i1", "p_alice"), issue("i2", "p_bob"), issue("i3", DEMO)];

  it("gives alice only her own reports plus the demo", () => {
    expect(visibleProjects(alice, projects, DEMO).map((p) => p.id)).toEqual(["p_alice", DEMO]);
    expect(visibleIssues(alice, issues, projects, DEMO).map((i) => i.id)).toEqual(["i1", "i3"]);
  });

  it("hides everything from anonymous callers", () => {
    expect(visibleProjects(anon, projects, DEMO)).toEqual([]);
    expect(visibleIssues(anon, issues, projects, DEMO)).toEqual([]);
  });

  it("gives the operator everything", () => {
    expect(visibleProjects(operator, projects, DEMO)).toHaveLength(3);
    expect(visibleIssues(operator, issues, projects, DEMO)).toHaveLength(3);
  });
});
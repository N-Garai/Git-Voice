/**
 * Dashboard authorisation + tenant scoping.
 *
 * Three access tiers, checked per request:
 *
 *  1. operator — `Authorization: Bearer <DASHBOARD_TOKEN>` (constant-time
 *     compare). Sees everything. This is the server owner's own key.
 *  2. session  — a logged-in GitHub user (HttpOnly cookie). Sees only the
 *     projects stamped with their login, so tenants never read each other's
 *     transcripts, telemetry or audio.
 *  3. anonymous — nothing. Every dashboard read is closed by default.
 *
 * The widget's `POST /api/issue` is deliberately outside this guard: it is
 * the product's public front door, so it stays open and is protected by
 * per-IP + global rate limits instead (see routes/rateLimit.ts).
 */
import crypto from "node:crypto";
import { config } from "../config.js";
import type { IssueRecord, Project } from "../types.js";
import type { Session } from "./sessions.js";

export interface Caller {
  /** Full-access key holder. */
  operator: boolean;
  /** Logged-in GitHub session, when present. */
  session?: Session;
}

export const ANONYMOUS: Caller = { operator: false };

export function isOperator(headers: Record<string, string>): boolean {
  const expected = config.dashboardToken;
  if (!expected) return false;
  const header = headers["authorization"] ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const given = header.slice("Bearer ".length).trim();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  // Length check first: timingSafeEqual throws on mismatched buffer lengths.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Resolve the caller from a GitHub session cookie + optional Bearer key. */
export function callerFrom(session: Session | undefined, headers: Record<string, string>): Caller {
  return { operator: isOperator(headers), session };
}

function sameLogin(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/** The bundled demo project is public showcase content, visible to every tier. */
export function isDemoProject(project: Project, demoId: string): boolean {
  return project.id === demoId;
}

/**
 * May this caller see this project's data? Operators and the demo project are
 * always allowed; everyone else needs a matching GitHub login.
 */
export function canReadProject(caller: Caller, project: Project | undefined, demoId: string): boolean {
  if (!project) return false;
  // Defence in depth: anonymous callers get nothing, not even the demo. The
  // route guard already rejects them before this runs, so this only matters if
  // a future route forgets that check.
  if (!caller.operator && !caller.session) return false;
  if (caller.operator) return true;
  if (isDemoProject(project, demoId)) return true;
  return sameLogin(caller.session?.githubLogin, project.ownerLogin);
}

/** Filter a project list down to what the caller may read. */
export function visibleProjects(caller: Caller, projects: Project[], demoId: string): Project[] {
  if (caller.operator) return projects;
  return projects.filter((p) => canReadProject(caller, p, demoId));
}

/** Filter issue records to those belonging to the caller's visible projects. */
export function visibleIssues(
  caller: Caller,
  issues: IssueRecord[],
  projects: Project[],
  demoId: string
): IssueRecord[] {
  if (caller.operator) return issues;
  const allowed = new Set(visibleProjects(caller, projects, demoId).map((p) => p.id));
  return issues.filter((i) => allowed.has(i.projectId));
}
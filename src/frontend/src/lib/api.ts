/** Typed client for the backend REST API. */

export interface Telemetry {
  url: string;
  route: string;
  title?: string;
  viewport: { w: number; h: number; dpr?: number };
  userAgent: string;
  language?: string;
  referrer?: string;
  sessionMs?: number;
  consoleLogs: Array<{ level: string; text: string; ts?: number }>;
  errors: Array<{ message: string; source?: string; line?: number; col?: number; ts?: number }>;
  clicks: Array<{ selector: string; label?: string; ts?: number }>;
}

export interface IssueRecordDto {
  id: string;
  projectId: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  error?: string;
  transcript?: string;
  transcriptSource?: string;
  audioMime?: string;
  telemetry: Telemetry;
  trace: Array<{ stepId: string; name: string; status: string; durationMs?: number; detail?: string }>;
  result?: {
    draft: {
      title: string;
      severity: "high" | "medium" | "low";
      labels: string[];
      suspectedFile: string;
      suspectedLineRange?: string;
      suspectedFunction?: string;
      summary: string;
      expected: string;
      actual: string;
      reproSteps: string[];
      issueBody: string;
    };
    matches: Array<{
      filePath: string;
      componentName: string;
      score: number;
      vectorScore: number;
      keywordScore: number;
    }>;
    consoleCorrelations: string[];
    transcriptSource: string;
    models: { transcriber: string; drafter: string; embeddings: string; vectorStore: string };
    confirmation: { spokenText: string; voiceBackend: string };
    github: { pushed: boolean; issueUrl?: string; issueNumber?: number; repository?: string; reason?: string };
  };
}

export interface ProjectDto {
  id: string;
  name: string;
  repoFullName?: string;
  createdAt: string;
  indexedAt?: string;
  indexCount: number;
  embedderId: string;
  indexStatus: "empty" | "indexing" | "ready" | "failed";
  indexError?: string;
}

export interface IntegrationDto {
  id: string;
  label: string;
  envKey: string;
  configured: boolean;
  activeMode: string;
  fallbackMode: string;
}

export interface GitHubUser {
  login: string;
  id: number;
}

export interface RepoListing {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
}

const base = "";

/**
 * Operator key for dashboard calls, kept in localStorage. Dashboard reads are
 * locked server-side, so the browser must present this Bearer token (or be a
 * logged-in GitHub user) to see report data.
 */
export function getToken(): string {
  return localStorage.getItem("gv_token") ?? "";
}

export function setToken(value: string): void {
  if (value) localStorage.setItem("gv_token", value);
  else localStorage.removeItem("gv_token");
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function get<T>(path: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${base}${path}`, { headers: authHeaders(headers) });
  if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`, res.status);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", ...headers }),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/** Fetch a protected binary (report audio) with the operator key attached. */
export async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetch(`${base}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`, res.status);
  return res.blob();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { method: "DELETE", headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  health: () => get<{ ok: boolean }>("/health"),
  issues: (projectId?: string) =>
    get<{ issues: IssueRecordDto[] }>(`/api/issues${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  issue: (id: string) => get<{ issue: IssueRecordDto }>(`/api/issues/${id}`),
  projects: () => get<{ projects: ProjectDto[] }>("/api/projects"),
  createProject: (name: string, repoFullName?: string) =>
    post<{ project: ProjectDto }>("/api/projects", { name, repoFullName }),
  reindexProject: (id: string, repoFullName?: string) =>
    post<{ filesIndexed: number }>(
      `/api/projects/${id}/index`,
      repoFullName ? { repoFullName } : {}
    ),
  /** Removes the project, its reports/audio, and its index rows (incl. Postgres). */
  deleteProject: (id: string) =>
    del<{ ok: boolean; deleted: { project: boolean; reports: number } }>(`/api/projects/${id}`),
  /** File a report from the dashboard, optionally targeting a specific repo. */
  submitReport: (payload: {
    projectId: string;
    transcript: string;
    telemetry: unknown;
    repoFullName?: string;
  }) => post<{ issue: IssueRecordDto }>("/api/issue", payload),
  search: (projectId: string, q: string) =>
    get<{ matches: Array<{ filePath: string; componentName: string; score: number }> }>(
      `/api/projects/${projectId}/search?q=${encodeURIComponent(q)}`
    ),
  issueAudioUrl: (id: string) => `${base}/api/issues/${id}/audio`,
  settings: () => get<{ baseUrl: string; integrations: IntegrationDto[] }>("/api/settings"),
  me: () => get<{ user: GitHubUser | null }>("/api/auth/me"),
  repos: () => get<{ repos: RepoListing[] }>("/api/repos"),
  logout: () => post<{ ok: boolean }>("/api/auth/logout")
};

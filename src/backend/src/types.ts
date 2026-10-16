/** Shared domain types for the Git-Voice triage pipeline. */

export type Severity = "high" | "medium" | "low";

export type IssueStatus = "queued" | "running" | "completed" | "failed";

export type TranscriptSource =
  | "browser-speech"
  | "typed-report"
  | "server-transcription"
  | "telemetry-only";

export interface ConsoleEntry {
  level: string;
  text: string;
  ts?: number;
}

export interface PageError {
  message: string;
  source?: string;
  line?: number;
  col?: number;
  ts?: number;
}

export interface ClickEvent {
  selector: string;
  label?: string;
  ts?: number;
}

export interface Telemetry {
  url: string;
  route: string;
  title?: string;
  viewport: { w: number; h: number; dpr?: number };
  userAgent: string;
  language?: string;
  referrer?: string;
  sessionMs?: number;
  consoleLogs: ConsoleEntry[];
  errors: PageError[];
  clicks: ClickEvent[];
}

export type StepStatus = "completed" | "skipped" | "failed" | "running";

export interface StepTrace {
  stepId: string;
  name: string;
  status: StepStatus;
  durationMs?: number;
  detail?: string;
  startedAt?: number;
}

export interface IndexMatch {
  filePath: string;
  componentName: string;
  routePath?: string;
  exportedSymbols: string[];
  errorEnums: string[];
  description: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

export interface GithubPublishResult {
  pushed: boolean;
  issueUrl?: string;
  issueNumber?: number;
  repository?: string;
  reason?: string;
}

export interface DraftIssue {
  title: string;
  severity: Severity;
  labels: string[];
  suspectedFile: string;
  suspectedLineRange?: string;
  suspectedFunction?: string;
  summary: string;
  expected: string;
  actual: string;
  reproSteps: string[];
  issueBody: string;
}

export interface PipelineModels {
  transcriber: string;
  drafter: string;
  embeddings: string;
  vectorStore: string;
}

export interface ConfirmationPayload {
  spokenText: string;
  voiceBackend: "elevenlabs" | "web-speech";
  audioBase64?: string;
  audioMime?: string;
}

export interface IssueResult {
  draft: DraftIssue;
  matches: IndexMatch[];
  consoleCorrelations: string[];
  transcriptSource: TranscriptSource;
  models: PipelineModels;
  confirmation: ConfirmationPayload;
  github: GithubPublishResult;
}

export interface IssueRecord {
  id: string;
  projectId: string;
  status: IssueStatus;
  createdAt: string;
  completedAt?: string;
  error?: string;
  transcript?: string;
  transcriptSource?: TranscriptSource;
  audioMime?: string;
  audioBase64?: string;
  telemetry: Telemetry;
  trace: StepTrace[];
  result?: IssueResult;
}

/** A single entry in a project's Smart Architecture Index. */
export interface IndexEntry {
  id: string;
  projectId: string;
  filePath: string;
  componentName: string;
  routePath: string;
  exportedSymbols: string[];
  errorEnums: string[];
  classNames: string[];
  description: string;
  signature: string;
  embedding: number[];
  embedderId: string;
}

export interface Project {
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

export interface SettingsView {
  baseUrl: string;
  integrations: Array<{
    id: string;
    label: string;
    envKey: string;
    configured: boolean;
    activeMode: string;
    fallbackMode: string;
  }>;
}

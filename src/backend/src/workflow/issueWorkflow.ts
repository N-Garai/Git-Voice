/**
 * The Git-Voice triage pipeline — seven stations, in order:
 *
 *   1. INGEST     normalize the voice report + telemetry, mark the record live
 *   2. TRANSCRIBE secure a text transcript (browser speech, typed, or hosted STT)
 *   3. LOCATE     hybrid search of the project's architecture index
 *   4. CORRELATE  match captured console/error text against indexed error codes
 *   5. DRAFT      synthesize the structured issue (hosted model or offline engine)
 *   6. CONFIRM    build the spoken client confirmation (hosted voice or browser)
 *   7. PUBLISH    create the GitHub issue, or keep it as a dashboard draft
 *
 * Every external integration degrades instead of aborting: a failed model call
 * falls back to the deterministic synthesizer, a missing token leaves the issue
 * as a draft. The pipeline therefore completes end-to-end with zero config.
 */
import crypto from "node:crypto";
import { config } from "../config.js";
import type {
  DraftIssue,
  GithubPublishResult,
  IndexMatch,
  IssueRecord,
  PipelineModels,
  Severity,
  StepTrace,
  Telemetry,
  TranscriptSource
} from "../types.js";
import { issueStore } from "../store/issues.js";
import { projectStore } from "../store/projects.js";
import type { VectorIndex } from "../store/vectorIndex.js";
import { transcribeAudio, draftIssueJson, llmConfigured } from "../services/gemini.js";
import { synthesizeIssueHeuristically } from "../services/heuristic.js";
import { buildIssueBody, buildSpokenText } from "../services/spoken.js";
import { renderConfirmationAudio } from "../services/elevenlabs.js";
import { createGitHubIssue } from "../services/github.js";
import { activeEmbedder } from "../services/embeddings.js";
import { runWorkflow, type WorkflowStep } from "./engine.js";

export interface PipelineContext {
  issueId: string;
  projectId: string;
  telemetry: Telemetry;
  audioBase64?: string;
  audioMime?: string;
  providedTranscript?: string;
  providedSource: TranscriptSource;
  transcript: string;
  transcriptSource: TranscriptSource;
  matches: IndexMatch[];
  correlations: string[];
  draft: DraftIssue | null;
  drafterLabel: string;
  confirmation: { spokenText: string; voiceBackend: "elevenlabs" | "web-speech"; audioBase64?: string; audioMime?: string };
  github: GithubPublishResult | null;
}

export interface PipelineSubmit {
  projectId: string;
  telemetry: Telemetry;
  audio?: { base64: string; mime: string };
  transcript?: string;
  transcriptSource: TranscriptSource;
}

const STEP_NAMES: Record<string, string> = {
  ingest: "Ingest report",
  transcribe: "Transcribe voice",
  locate: "Locate suspect files",
  correlate: "Correlate console errors",
  draft: "Draft issue",
  confirm: "Prepare confirmation",
  publish: "Publish to GitHub"
};

function makeTraceSink(issueId: string) {
  const write = (entry: StepTrace) => issueStore.appendTrace(issueId, entry);
  return {
    start(step: { stepId: string; name: string }) {
      write({ stepId: step.stepId, name: step.name, status: "running", startedAt: Date.now() });
    },
    complete(stepId: string, durationMs: number, detail?: string) {
      write({
        stepId,
        name: STEP_NAMES[stepId] ?? stepId,
        status: "completed",
        durationMs,
        detail
      });
    },
    skip(stepId: string, detail: string) {
      write({ stepId, name: STEP_NAMES[stepId] ?? stepId, status: "skipped", durationMs: 0, detail });
    },
    fail(stepId: string, durationMs: number, error: string) {
      write({ stepId, name: STEP_NAMES[stepId] ?? stepId, status: "failed", durationMs, detail: error });
    }
  };
}

/** Scan captured console/error text against indexed error codes and symbols. */
export function correlateConsoleErrors(telemetry: Telemetry, matches: IndexMatch[]): string[] {
  const hay = [
    ...telemetry.consoleLogs.map((l) => l.text),
    ...telemetry.errors.map((e) => `${e.message} ${e.source ?? ""}`),
    telemetry.route
  ]
    .join(" \n ")
    .toLowerCase();
  if (!hay.trim()) return [];

  const found: string[] = [];
  for (const match of matches) {
    for (const err of match.errorEnums) {
      if (err.length > 4 && hay.includes(err.toLowerCase())) {
        found.push(`${err} → ${match.filePath}`);
      }
    }
    for (const symbol of match.exportedSymbols) {
      const bare = symbol.replace(/\(\)$/, "").toLowerCase();
      if (bare.length > 5 && hay.includes(bare)) {
        found.push(`${symbol} → ${match.filePath}`);
      }
    }
  }
  return [...new Set(found)].slice(0, 8);
}

function sanitizeLabels(modelLabels: unknown, severity: Severity): string[] {
  const extras = Array.isArray(modelLabels)
    ? modelLabels.filter((l): l is string => typeof l === "string" && l.length <= 30).slice(0, 3)
    : [];
  return [...new Set(["bug", "staging", `severity:${severity}`, ...extras])].slice(0, 6);
}

function coerceDraft(parsed: Record<string, unknown>, fallback: DraftIssue): DraftIssue {
  const str = (v: unknown, fb: string, max = 400): string =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fb;
  const steps = Array.isArray(parsed.reproSteps)
    ? parsed.reproSteps
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 220))
    : [];

  const severityRaw = typeof parsed.severity === "string" ? parsed.severity.toLowerCase() : "";
  const severity: Severity =
    severityRaw === "high" || severityRaw === "medium" || severityRaw === "low" ? severityRaw : fallback.severity;

  return {
    title: str(parsed.title, fallback.title, 110),
    severity,
    labels: sanitizeLabels(parsed.labels, severity),
    suspectedFile: str(parsed.suspectedFile, fallback.suspectedFile, 300),
    suspectedLineRange: typeof parsed.suspectedLineRange === "string" ? parsed.suspectedLineRange.slice(0, 40) : undefined,
    suspectedFunction: str(parsed.suspectedFunction, fallback.suspectedFunction ?? "", 120) || undefined,
    summary: str(parsed.summary, fallback.summary, 900),
    expected: str(parsed.expected, fallback.expected, 700),
    actual: str(parsed.actual, fallback.actual, 700),
    reproSteps: steps.length >= 1 ? steps.slice(0, 8) : fallback.reproSteps,
    issueBody: ""
  };
}

export async function runIssuePipeline(
  submit: PipelineSubmit,
  index: VectorIndex
): Promise<IssueRecord | undefined> {
  const issueId = crypto.randomUUID();
  const record: IssueRecord = {
    id: issueId,
    projectId: submit.projectId,
    status: "running",
    createdAt: new Date().toISOString(),
    transcript: submit.transcript,
    transcriptSource: submit.transcriptSource,
    telemetry: submit.telemetry,
    trace: []
  };
  issueStore.create(record);

  if (submit.audio) {
    issueStore.attachAudio(issueId, submit.audio.base64, submit.audio.mime);
  }

  const project = projectStore.get(submit.projectId);

  const ctx: PipelineContext = {
    issueId,
    projectId: submit.projectId,
    telemetry: submit.telemetry,
    audioBase64: submit.audio?.base64,
    audioMime: submit.audio?.mime,
    providedTranscript: submit.transcript,
    providedSource: submit.transcriptSource,
    transcript: submit.transcript ?? "",
    transcriptSource: submit.transcriptSource,
    matches: [],
    correlations: [],
    draft: null,
    drafterLabel: "Built-in deterministic triage engine (offline)",
    confirmation: { spokenText: "", voiceBackend: "web-speech" },
    github: null
  };

  const steps: Array<WorkflowStep<PipelineContext>> = [
    {
      stepId: "ingest",
      name: STEP_NAMES.ingest,
      run: async (c) => {
        const t = c.telemetry;
        return {
          telemetry: {
            ...t,
            consoleLogs: t.consoleLogs.slice(-100),
            errors: t.errors.slice(-25),
            clicks: t.clicks.slice(-25)
          }
        };
      }
    },
    {
      stepId: "transcribe",
      name: STEP_NAMES.transcribe,
      run: async (c) => {
        if (c.providedTranscript?.trim()) {
          return {
            transcript: c.providedTranscript.trim().slice(0, 4000),
            transcriptSource: c.providedSource
          };
        }
        if (c.audioBase64 && llmConfigured()) {
          try {
            const { text } = await transcribeAudio(c.audioBase64, c.audioMime ?? "audio/webm");
            return { transcript: text, transcriptSource: "server-transcription" as TranscriptSource };
          } catch (err) {
            console.warn("[pipeline] Server transcription failed:", err instanceof Error ? err.message : err);
            return { transcriptSource: "telemetry-only" as TranscriptSource };
          }
        }
        return { transcriptSource: "telemetry-only" as TranscriptSource };
      }
    },
    {
      stepId: "locate",
      name: STEP_NAMES.locate,
      run: async (c) => {
        const query = [
          c.transcript,
          c.telemetry.errors.map((e) => e.message).join(" "),
          c.telemetry.consoleLogs.map((l) => l.text).join(" "),
          c.telemetry.clicks.map((k) => `${k.selector} ${k.label ?? ""}`).join(" ")
        ]
          .filter(Boolean)
          .join(" ")
          .slice(0, 3000);

        const outcome = await index.search(c.projectId, query, c.telemetry.route, 5);
        if (outcome.matches.length) return { matches: outcome.matches };
        // Route-only fallback so a report always has candidates to reason over.
        const fallback = await index.search(c.projectId, c.telemetry.route || "checkout", "", 3);
        return { matches: fallback.matches };
      }
    },
    {
      stepId: "correlate",
      name: STEP_NAMES.correlate,
      run: async (c) => ({ correlations: correlateConsoleErrors(c.telemetry, c.matches) })
    },
    {
      stepId: "draft",
      name: STEP_NAMES.draft,
      run: async (c) => {
        const heuristic = synthesizeIssueHeuristically({
          transcript: c.transcript,
          telemetry: c.telemetry,
          matches: c.matches,
          correlations: c.correlations
        });

        let draft = heuristic;
        if (llmConfigured()) {
          try {
            const { parsed, model } = await draftIssueJson({
              transcript: c.transcript,
              telemetryJson: JSON.stringify(
                {
                  route: c.telemetry.route,
                  url: c.telemetry.url,
                  viewport: c.telemetry.viewport,
                  userAgent: c.telemetry.userAgent,
                  consoleLogs: c.telemetry.consoleLogs.slice(-25),
                  errors: c.telemetry.errors.slice(-10),
                  clicks: c.telemetry.clicks.slice(-10)
                },
                null,
                1
              ),
              correlations: c.correlations,
              matchesJson: JSON.stringify(
                c.matches.map((m) => ({
                  file: m.filePath,
                  component: m.componentName,
                  exports: m.exportedSymbols,
                  errorCodes: m.errorEnums,
                  route: m.routePath,
                  description: m.description
                })),
                null,
                1
              )
            });
            draft = coerceDraft(parsed, heuristic);
            c.drafterLabel = model;
          } catch (err) {
            console.warn(
              "[pipeline] Model drafting failed; using the deterministic engine:",
              err instanceof Error ? err.message : err
            );
          }
        }

        const models: PipelineModels = {
          transcriber:
            c.transcriptSource === "server-transcription" ? config.gemini.transcribeModelId : "browser-native speech",
          drafter: c.drafterLabel,
          embeddings: activeEmbedder().label,
          vectorStore: index.backendName
        };
        return { draft: { ...draft, issueBody: buildIssueBody(draft, c.transcript, c.telemetry, c.matches, models) } };
      }
    },
    {
      stepId: "confirm",
      name: STEP_NAMES.confirm,
      run: async (c) => {
        const draft = c.draft!;
        const spokenText = buildSpokenText(draft.title, draft.suspectedFile, draft.severity);
        const tts = await renderConfirmationAudio(spokenText);
        return {
          confirmation: {
            spokenText,
            voiceBackend: tts.backend,
            audioBase64: tts.audioBase64,
            audioMime: tts.audioMime
          }
        };
      }
    },
    {
      stepId: "publish",
      name: STEP_NAMES.publish,
      run: async (c) => {
        const draft = c.draft!;
        const github = await createGitHubIssue({
          repoFullName: project?.repoFullName,
          title: draft.title,
          body: draft.issueBody,
          labels: draft.labels
        });
        return { github };
      }
    }
  ];

  const sink = makeTraceSink(issueId);
  const run = await runWorkflow(steps, ctx, sink);

  const draft = ctx.draft;
  if (draft) {
    const models: PipelineModels = {
      transcriber:
        ctx.transcriptSource === "server-transcription" ? config.gemini.transcribeModelId : "browser-native speech",
      drafter: ctx.drafterLabel,
      embeddings: activeEmbedder().label,
      vectorStore: index.backendName
    };
    issueStore.update(issueId, {
      status: run.ok ? "completed" : "failed",
      completedAt: new Date().toISOString(),
      transcript: ctx.transcript,
      transcriptSource: ctx.transcriptSource,
      error: run.ok ? undefined : run.error,
      result: {
        draft,
        matches: ctx.matches,
        consoleCorrelations: ctx.correlations,
        transcriptSource: ctx.transcriptSource,
        models,
        confirmation: ctx.confirmation,
        github: ctx.github ?? { pushed: false, reason: "Publish step did not run." }
      }
    });
  } else {
    issueStore.update(issueId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: run.error ?? "Pipeline produced no draft"
    });
  }

  return issueStore.get(issueId);
}

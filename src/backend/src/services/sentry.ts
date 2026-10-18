/**
 * Sentry observability layer — Agent Tracing for the triage pipeline.
 *
 * When SENTRY_DSN is configured the seven-station pipeline reports an agent
 * trace in Sentry's agent model (docs.sentry.io Agent Tracing, manual
 * instrumentation spec):
 *
 *   invoke_agent voice-triage          (gen_ai.invoke_agent — the whole run)
 *     ├─ execute_tool transcribe       (gen_ai.execute_tool — engine stations)
 *     ├─ chat gemma-…                  (gen_ai.chat — model calls + token usage)
 *     └─ execute_tool publish
 *
 * Everything here is a no-op without a DSN — local, CI and tests run with
 * zero overhead and zero behavior change. SENTRY_CONTENT=off strips report
 * content (transcripts, prompts) from attributes while keeping latency,
 * token and cost data.
 */
import * as Sentry from "@sentry/node";
import { config } from "../config.js";

export type TraceSpan = ReturnType<typeof Sentry.startInactiveSpan>;

let ready = false;
let captureContent = true;

/** True only after initSentry() found a DSN. Gates every helper below. */
export function sentryEnabled(): boolean {
  return ready;
}

/** Whether report content (transcripts, prompts) may ride on span attributes. */
export function contentCaptured(): boolean {
  return captureContent;
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  captureContent = process.env.SENTRY_CONTENT !== "off";
  const rate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1");
  try {
    Sentry.init({
      dsn,
      environment: config.nodeEnv || "production",
      tracesSampleRate: Number.isFinite(rate) && rate > 0 ? rate : 1
    });
    ready = true;
    console.log("[sentry] agent tracing enabled (content capture " + (captureContent ? "on" : "off") + ")");
  } catch (err) {
    console.warn("[sentry] init failed — tracing stays off:", err instanceof Error ? err.message : err);
  }
}

/** Give the SDK a chance to ship buffered spans before the process exits. */
export async function flushSentry(): Promise<void> {
  if (!ready) return;
  await Sentry.flush(2000);
}

/**
 * The whole pipeline run as an agent invocation. Starts the span, marks it
 * active for everything inside (outbound HTTP/model calls parent to it), and
 * fills the outcome attributes from the finished run.
 */
export async function runTracedAgent<T>(
  attributes: Record<string, string | number | boolean | undefined>,
  outcome: (span: NonNullable<TraceSpan>, result: T, error?: string) => Record<string, string | number | boolean | undefined>,
  body: () => Promise<T>
): Promise<T> {
  if (!ready) return body();
  return Sentry.startSpan(
    {
      op: "gen_ai.invoke_agent",
      name: "invoke_agent voice-triage",
      attributes
    },
    async (span) => {
      try {
        const result = await body();
        span.setAttributes(outcome(span, result));
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        span.setStatus({ code: 2, message: "internal_error" });
        span.setAttribute("error.type", err instanceof Error ? err.name : "Error");
        span.setAttributes(outcome(span, undefined as T, message));
        throw err;
      }
    }
  );
}

/** Start an engine-station span (`gen_ai.execute_tool`) parented above. */
export function startToolSpan(stepId: string, stepName: string): NonNullable<TraceSpan> | null {
  if (!ready) return null;
  const span = Sentry.startInactiveSpan({
    op: "gen_ai.execute_tool",
    name: `execute_tool ${stepId}`,
    attributes: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": stepId,
      "gen_ai.tool.description": stepName,
      "gen_ai.agent.name": "voice-triage",
      "gen_ai.pipeline.name": "git-voice-issue-pipeline"
    }
  });
  return span ?? null;
}

/** Make a tool span the active parent for the step body, then close it. */
export async function withToolSpan<T>(
  span: NonNullable<TraceSpan> | null,
  stepId: string,
  body: () => Promise<T>
): Promise<T> {
  if (!span) return body();
  try {
    const result = await Sentry.withActiveSpan(span, body);
    span.end();
    return result;
  } catch (err) {
    span.setStatus({ code: 2, message: "internal_error" });
    span.setAttribute("error.type", err instanceof Error ? err.name : "Error");
    span.end();
    throw err;
  }
}

/**
 * One hosted model call (`gen_ai.chat`), with the token-usage and response
 * attributes Sentry needs to compute latency, tokens and model cost. The
 * callback receives the span so the caller can attach response details the
 * moment they are parsed.
 */
export async function modelSpan<T>(
  opts: {
    modelId: string;
    inputText: string;
    temperature?: number;
  },
  body: (span: NonNullable<TraceSpan>) => Promise<T>
): Promise<T> {
  if (!ready) return body(undefined as unknown as NonNullable<TraceSpan>);
  return Sentry.startSpan(
    {
      op: "gen_ai.chat",
      name: `chat ${opts.modelId}`,
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "google",
        "gen_ai.request.model": opts.modelId,
        "gen_ai.agent.name": "voice-triage",
        "gen_ai.pipeline.name": "git-voice-issue-pipeline",
        ...(opts.temperature !== undefined ? { "gen_ai.request.temperature": opts.temperature } : {}),
        ...(captureContent && opts.inputText
          ? { "gen_ai.input.messages": JSON.stringify([{ role: "user", parts: [{ type: "text", content: opts.inputText.slice(0, 1500) }] }]) }
          : {})
      }
    },
    body
  );
}

/** Same lifecycle for embedding batches (`gen_ai.embeddings`). */
export async function embeddingsSpan<T>(
  opts: { modelId: string; count: number },
  body: () => Promise<T>
): Promise<T> {
  if (!ready) return body();
  return Sentry.startSpan(
    {
      op: "gen_ai.embeddings",
      name: `embeddings ${opts.modelId}`,
      attributes: {
        "gen_ai.operation.name": "embeddings",
        "gen_ai.provider.name": "google",
        "gen_ai.request.model": opts.modelId,
        "gen_ai.agent.name": "voice-triage",
        "gitvoice.embedding.count": opts.count
      }
    },
    async (span) => {
      try {
        const result = await body();
        span.setAttributes({
          "gen_ai.response.model": opts.modelId,
          "gen_ai.response.finish_reasons": JSON.stringify(["stop"])
        });
        return result;
      } catch (err) {
        span.setStatus({ code: 2, message: "internal_error" });
        span.setAttribute("error.type", err instanceof Error ? err.name : "Error");
        throw err;
      }
    }
  );
}

/**
 * Record a model call's usage/response details. `usage` mirrors Gemini REST
 * `usageMetadata`. All fields optional; unknown values are skipped.
 */
export function recordModelOutcome(
  span: NonNullable<TraceSpan> | undefined,
  data: {
    usage?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      cachedContentTokenCount?: number;
      totalTokenCount?: number;
    };
    responseModel?: string;
    outputText?: string;
    finishReason?: string;
  }
): void {
  if (!span) return;
  if (data.responseModel) span.setAttribute("gen_ai.response.model", data.responseModel);
  const u = data.usage;
  if (u) {
    const num = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v);
    if (num(u.promptTokenCount)) span.setAttribute("gen_ai.usage.input_tokens", u.promptTokenCount);
    if (num(u.candidatesTokenCount)) span.setAttribute("gen_ai.usage.output_tokens", u.candidatesTokenCount);
    if (num(u.totalTokenCount)) {
      span.setAttribute("gen_ai.usage.total_tokens", u.totalTokenCount);
    } else if (num(u.promptTokenCount) && num(u.candidatesTokenCount)) {
      span.setAttribute("gen_ai.usage.total_tokens", u.promptTokenCount + u.candidatesTokenCount);
    }
    if (num(u.cachedContentTokenCount)) {
      span.setAttribute("gen_ai.usage.cache_read.input_tokens", u.cachedContentTokenCount);
    }
  }
  if (data.finishReason) {
    span.setAttribute("gen_ai.response.finish_reasons", JSON.stringify([data.finishReason]));
  }
  if (captureContent && data.outputText) {
    span.setAttribute(
      "gen_ai.output.messages",
      JSON.stringify([{ role: "assistant", parts: [{ type: "text", content: data.outputText.slice(0, 2000) }] }])
    );
  }
}

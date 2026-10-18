import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => {
  const fakeSpans: Array<{
    name: string;
    op?: string;
    attributes: Record<string, unknown>;
    status?: { code: number; message?: string };
    ended: boolean;
  }> = [];
  const initCalls: Array<Record<string, unknown>> = [];
  function fakeStartSpan(opts: { op?: string; name: string; attributes?: Record<string, unknown> }, cb: (s: unknown) => unknown) {
    const span = {
      name: opts.name,
      op: opts.op,
      attributes: { ...(opts.attributes ?? {}) },
      status: undefined,
      ended: false,
      setAttribute(k: string, v: unknown) {
        span.attributes[k] = v;
      },
      setAttributes(o: Record<string, unknown>) {
        Object.assign(span.attributes, o);
      },
      setStatus(s: { code: number; message?: string }) {
        span.status = s;
      },
      end() {
        span.ended = true;
      }
    };
    fakeSpans.push(span);
    const result = cb(span);
    if (result instanceof Promise) return result.finally(() => span.end());
    span.end();
    return result;
  }
  return { fakeSpans, initCalls, fakeStartSpan };
});

vi.mock("@sentry/node", () => ({
  init: vi.fn((opts: Record<string, unknown>) => h.initCalls.push(opts)),
  flush: vi.fn(async () => {}),
  startSpan: vi.fn((opts: unknown, cb: unknown) => h.fakeStartSpan(opts, cb)),
  startInactiveSpan: vi.fn((span) => {
    h.fakeStartSpan(span, () => null);
    return h.fakeSpans[h.fakeSpans.length - 1];
  }),
  withActiveSpan: vi.fn((span: unknown, cb: (s: unknown) => unknown) => cb(span))
}));

import { runWorkflow, TraceSink, WorkflowStep } from "../workflow/engine.js";
import {
  initSentry,
  sentryEnabled,
  contentCaptured,
  flushSentry,
  startToolSpan,
  withToolSpan,
  runTracedAgent,
  modelSpan,
  embeddingsSpan,
  recordModelOutcome
} from "./sentry.js";

describe("sentry tracing disabled (no DSN)", () => {
  it("stays off and no-ops every helper", async () => {
    delete process.env.SENTRY_DSN;
    initSentry();
    expect(sentryEnabled()).toBe(false);
    expect(h.initCalls).toHaveLength(0);
    expect(contentCaptured()).toBe(true);

    const value = Symbol("body");
    expect(await runTracedAgent({}, () => ({}), async () => value)).toBe(value);
    expect(startToolSpan("s1", "One") ?? null).toBeNull();
    const marker = Symbol("out");
    expect(await withToolSpan(null, "s1", async () => marker)).toBe(marker);
    expect(await modelSpan({ modelId: "m" }, async (span) => span === undefined)).toBe(true);
    expect(await embeddingsSpan({ modelId: "m", count: 3 }, async () => value)).toBe(value);
    expect(() => recordModelOutcome(undefined, { responseModel: "m" })).not.toThrow();
    await expect(flushSentry()).resolves.toBeUndefined();
  });
});

describe("sentry tracing enabled (DSN set)", () => {
  beforeEach(() => {
    h.fakeSpans.length = 0;
  });
  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it("initializes with the sample rate and flags content capture", () => {
    process.env.SENTRY_DSN = "https://key@example.ingest.sentry.io/1";
    initSentry();
    expect(sentryEnabled()).toBe(true);
    expect(h.initCalls).toHaveLength(1);
    expect(h.initCalls[0].tracesSampleRate).toBe(1);
  });

  it("runs the engine workflow and reports every station as a tool span", async () => {
    const sink: TraceSink = {
      start: vi.fn(),
      complete: vi.fn(),
      skip: vi.fn(),
      fail: vi.fn()
    };
    const steps: Array<WorkflowStep<Record<string, unknown>>> = [
      { stepId: "s1", name: "Station one", run: async () => ({ one: 1 }) },
      { stepId: "s2", name: "Station two", run: async () => undefined }
    ];
    const run = await runWorkflow(steps as never, {} as Record<string, unknown>, sink);
    expect(run.ok).toBe(true);
    expect(h.fakeSpans).toHaveLength(2);
    for (const [i, span] of h.fakeSpans.entries()) {
      expect(span.ended).toBe(true);
      expect(span.op).toBe("gen_ai.execute_tool");
      expect(span.attributes["gen_ai.tool.name"]).toBe(steps[i].stepId);
      expect(span.attributes["gen_ai.pipeline.name"]).toBe("git-voice-issue-pipeline");
    }
    expect(sink.fail).not.toHaveBeenCalled();
  });

  it("marks a failed station span as an error", async () => {
    const sink: TraceSink = { start: vi.fn(), complete: vi.fn(), skip: vi.fn(), fail: vi.fn() };
    const steps = [
      {
        stepId: "s1",
        name: "One",
        run: async () => {
          throw new Error("boom");
        }
      }
    ];
    const run = await runWorkflow(steps as never, {} as Record<string, unknown>, sink);
    expect(run.ok).toBe(false);
    expect(run.error).toContain("boom");
    expect(sink.fail).toHaveBeenCalledWith("s1", expect.any(Number), "boom");
    const span = h.fakeSpans[0];
    expect(span.status?.code).toBe(2);
    expect(span.attributes["error.type"]).toBe("Error");
  });

  it("reports the agent span with outcome attributes", async () => {
    const result = await runTracedAgent(
      { "gen_ai.operation.name": "invoke_agent" },
      () => ({ published: true }),
      async () => ({ ok: true })
    );
    expect(result.ok).toBe(true);
    const span = h.fakeSpans[0];
    expect(span.op).toBe("gen_ai.invoke_agent");
    expect(span.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    expect(span.attributes.published).toBe(true);
    expect(span.ended).toBe(true);
  });

  it("records model outcome attributes on the chat span", async () => {
    const text = await modelSpan({ modelId: "gemma-x", inputText: "hello" }, async (span) => {
      recordModelOutcome(span, {
        usage: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15, cachedContentTokenCount: 3 },
        responseModel: "gemma-x",
        outputText: "the reply",
        finishReason: "stop"
      });
      return "the reply";
    });
    expect(text).toBe("the reply");
    const span = h.fakeSpans[0];
    expect(span.op).toBe("gen_ai.chat");
    expect(span.attributes["gen_ai.request.model"]).toBe("gemma-x");
    expect(span.attributes["gen_ai.provider.name"]).toBe("google");
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(10);
    expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(5);
    expect(span.attributes["gen_ai.usage.total_tokens"]).toBe(15);
    expect(span.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(3);
    expect(span.attributes["gen_ai.response.model"]).toBe("gemma-x");
    expect(span.attributes["gen_ai.response.finish_reasons"]).toBe('["stop"]');
    const messages = JSON.parse(span.attributes["gen_ai.input.messages"] as string) as Array<{ parts: unknown }>;
    expect(messages[0].parts.length).toBeGreaterThan(0);
    const output = JSON.parse(span.attributes["gen_ai.output.messages"] as string) as Array<{ parts: unknown }>;
    expect(output[0].parts.length).toBeGreaterThan(0);
  });

  it("chat span carries the failure markers the model path sets", async () => {
    await expect(
      modelSpan({ modelId: "m" }, async (span) => {
        span.setStatus({ code: 2, message: "internal_error" });
        span.setAttribute("error.type", "ModelHttp503");
        throw new TypeError("nope");
      })
    ).rejects.toThrow("nope");
    const span = h.fakeSpans[0];
    expect(span.status?.code).toBe(2);
    expect(span.attributes["error.type"]).toBe("ModelHttp503");
    expect(span.ended).toBe(true);
  });

  it("embeddings spans carry the batch size and close cleanly", async () => {
    const value = await embeddingsSpan({ modelId: "emb", count: 7 }, async () => "done");
    const span = h.fakeSpans[0];
    expect(value).toBe("done");
    expect(span.op).toBe("gen_ai.embeddings");
    expect(span.attributes["gitvoice.embedding.count"]).toBe(7);
    expect(span.attributes["gen_ai.response.model"]).toBe("emb");
    expect(span.ended).toBe(true);
  });

  it("SENTRY_CONTENT=off strips content but keeps token data", async () => {
    process.env.SENTRY_DSN = "https://key@example.ingest.sentry.io/1";
    process.env.SENTRY_CONTENT = "off";
    h.fakeSpans.length = 0;
    initSentry();
    expect(contentCaptured()).toBe(false);
    await modelSpan({ modelId: "m", inputText: "secret transcript" }, async (span) => {
      recordModelOutcome(span, { usage: { promptTokenCount: 4 }, outputText: "secret reply" });
      return null;
    });
    const span = h.fakeSpans[0];
    expect(span.attributes["gen_ai.input.messages"]).toBeUndefined();
    expect(span.attributes["gen_ai.output.messages"]).toBeUndefined();
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(4);
  });
});

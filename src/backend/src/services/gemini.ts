/**
 * Thin REST client for the hosted Gemini API (free tier, key from Google AI
 * Studio). Used for two things:
 *  - audio -> transcript (when the browser could not transcribe locally)
 *  - transcript + telemetry + index matches -> structured issue JSON
 *
 * If no key is configured (or a call fails) the callers fall back to the
 * offline deterministic paths — this module never throws past its boundary.
 */
import { config } from "../config.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

export function llmConfigured(): boolean {
  return Boolean(config.gemini.apiKey);
}

/**
 * Free-tier model latency is unpredictable (cold starts, queued requests), so a
 * generous per-call budget plus one retry keeps a slow response from silently
 * downgrading a good draft to the offline engine.
 */
const MODEL_TIMEOUT_MS = 70_000;

async function generateOnce(
  modelId: string,
  parts: GeminiPart[],
  jsonMode: boolean,
  timeoutMs: number
): Promise<string> {
  const key = config.gemini.apiKey;
  if (!key) throw new Error("No model API key configured");

  const res = await fetch(`${BASE}/${modelId}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: jsonMode ? 0.2 : 0,
        ...(jsonMode ? { responseMimeType: "application/json" } : {})
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Model API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("Model returned an empty completion");
  return text;
}

async function generate(modelId: string, parts: GeminiPart[], jsonMode: boolean): Promise<string> {
  try {
    return await generateOnce(modelId, parts, jsonMode, MODEL_TIMEOUT_MS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const transient = /timeout|aborted|429|500|502|503|504/i.test(message);
    if (!transient) throw err;
    // One shorter retry: transient queueing usually clears immediately.
    await new Promise((r) => setTimeout(r, 1200));
    return generateOnce(modelId, parts, jsonMode, 35_000);
  }
}

/**
 * Transcribe a short voice recording. Preserves the speaker's casual wording —
 * the drafting stage is responsible for stripping emotion, not this one.
 */
export async function transcribeAudio(
  base64Audio: string,
  mimeType: string
): Promise<{ text: string; model: string }> {
  const text = await generate(
    config.gemini.transcribeModelId,
    [
      { inlineData: { mimeType, data: base64Audio } },
      {
        text:
          "Transcribe this voice bug report verbatim in the speaker's language. " +
          "Keep the casual tone and any product names, button labels, or codes they mention. " +
          "Output only the transcript text."
      }
    ],
    false
  );
  return { text: text.trim(), model: config.gemini.transcribeModelId };
}

/** Extract the first JSON object from a model completion. */
export function extractJson(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const startArr = candidate.indexOf("[");
  const from =
    start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (from === -1) throw new Error("No JSON found in model output");
  const isObject = candidate[from] === "{";
  const closer = isObject ? "}" : "]";
  const end = candidate.lastIndexOf(closer);
  if (end <= from) throw new Error("Unbalanced JSON in model output");
  return JSON.parse(candidate.slice(from, end + 1)) as Record<string, unknown>;
}

export interface DraftPromptInput {
  transcript: string;
  telemetryJson: string;
  matchesJson: string;
  correlations: string[];
}

/** Build the drafting prompt. Instructions ride in the user turn so the same
 * shape works across every instruct model served by the API. */
export function buildDraftPrompt(input: DraftPromptInput): { parts: GeminiPart[]; model: string } {
  const system =
    "You are a senior triage engineer. A non-technical client recorded a voice note " +
    "about what is broken on their staging site. Convert their report plus captured " +
    "browser telemetry and repository index matches into one engineering-grade bug report.\n" +
    "Rules:\n" +
    "- Strip emotion; keep every concrete fact (labels, codes, error text, buttons, routes).\n" +
    "- Reproduction steps must be numbered, imperative, and ordered (3 to 6 steps).\n" +
    "- Prefer a suspected file from the provided index matches. Never invent file paths " +
    "that are not in the matches.\n" +
    "- Severity: high when a flow is blocked or errors are thrown, medium when degraded, " +
    "low for cosmetic issues.\n" +
    "Respond with ONLY a JSON object with exactly these keys:\n" +
    '{"title": string (<= 80 chars, no markdown), "severity": "high"|"medium"|"low", ' +
    '"summary": string (1-2 sentences), "expected": string, "actual": string, ' +
    '"reproSteps": string[], "suspectedFile": string, "suspectedFunction": string, ' +
    '"labels": string[]}';

  const user = [
    "CLIENT VOICE TRANSCRIPT:",
    input.transcript || "(no transcript — rely on telemetry below)",
    "",
    "BROWSER TELEMETRY (route, viewport, console, errors, clicks):",
    input.telemetryJson,
    "",
    "CONSOLE / ERROR CORRELATIONS WITH INDEXED ERROR CODES:",
    input.correlations.length ? input.correlations.map((c) => `- ${c}`).join("\n") : "(none)",
    "",
    "TOP REPOSITORY INDEX MATCHES:",
    input.matchesJson,
    "",
    "Respond with ONLY the JSON object."
  ].join("\n");

  return { parts: [{ text: `${system}\n\n${user}` }], model: config.gemini.draftModelId };
}

export async function draftIssueJson(input: DraftPromptInput): Promise<{
  parsed: Record<string, unknown>;
  model: string;
}> {
  const { parts, model } = buildDraftPrompt(input);
  const raw = await generate(model, parts, false);
  return { parsed: extractJson(raw), model };
}

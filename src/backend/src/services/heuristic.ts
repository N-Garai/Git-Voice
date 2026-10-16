/**
 * Deterministic triage synthesizer — the offline drafting engine.
 *
 * When no model API key is configured, this produces a structured, honest bug
 * report from the same inputs the hosted model would see: the client's own
 * words, their real browser telemetry, and the architecture-index matches.
 * It is intentionally rule-based and auditable — no randomness, no fabrication:
 * every line it emits is traceable to captured evidence.
 */
import type { IndexMatch, Severity, Telemetry, DraftIssue } from "../types.js";

const BLOCKING_WORDS = [
  "nothing happens",
  "not working",
  "doesn't work",
  "does not work",
  "broken",
  "stuck",
  "frozen",
  "crash",
  "can't",
  "cannot",
  "won't",
  "error",
  "fail",
  "blank",
  "disappear"
];
const DEGRADED_WORDS = ["slow", "weird", "odd", "off", "misalign", "overlap", "jumpy", "flicker"];
const COSMETIC_WORDS = ["typo", "color", "colour", "font", "spelling", "spacing", "logo"];

export function classifySeverity(
  transcript: string,
  telemetry: Telemetry,
  correlations: string[]
): Severity {
  const hay = `${transcript} ${telemetry.consoleLogs.map((l) => l.text).join(" ")} ${telemetry.errors
    .map((e) => e.message)
    .join(" ")}`.toLowerCase();

  const thrownErrors = telemetry.errors.length + correlations.length;
  if (COSMETIC_WORDS.some((w) => hay.includes(w)) && thrownErrors === 0) return "low";
  if (thrownErrors > 0 || BLOCKING_WORDS.some((w) => hay.includes(w))) return "high";
  if (DEGRADED_WORDS.some((w) => hay.includes(w))) return "medium";
  return "medium";
}

/** Pull explicit button/field names the client mentioned ("complete order", "coupon"). */
function mentionedTargets(transcript: string): string[] {
  const targets: string[] = [];
  const quoted = transcript.match(/["“']([^"”']{3,40})["”']/g) ?? [];
  for (const q of quoted) {
    const inner = q.slice(1, -1).trim();
    if (inner && !targets.includes(inner)) targets.push(inner);
  }
  const typed = transcript.match(/\b(?:typed?|entered|entered in|put)\s+([a-z0-9][a-z0-9-]{1,24})\b/i);
  if (typed) targets.push(`the value "${typed[1].toUpperCase()}"`);
  return targets.slice(0, 4);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortRoute(route: string): string {
  return route === "/" ? "the home route" : `\`${route}\``;
}

export interface HeuristicInput {
  transcript: string;
  telemetry: Telemetry;
  matches: IndexMatch[];
  correlations: string[];
}

export function synthesizeIssueHeuristically(input: HeuristicInput): DraftIssue {
  const { transcript, telemetry, matches, correlations } = input;
  const top = matches[0];
  const severity = classifySeverity(transcript, telemetry, correlations);

  const suspectComponent = top?.componentName ?? "the staging view";
  const suspectFile = (top?.filePath ?? telemetry.route) || "unlocated";
  const suspectSymbol = top?.exportedSymbols[0];

  const errors = telemetry.errors.map((e) => e.message).filter(Boolean);
  const firstError = errors[0] ?? correlations[0];
  const targets = mentionedTargets(transcript);
  const hay = transcript.toLowerCase();

  // --- title ------------------------------------------------------------
  let subject = `Reported failure in ${suspectComponent}`;
  if (/coupon|promo|discount|voucher|code/.test(hay)) subject = "Coupon code reported failing at checkout";
  else if (/pay|order|checkout|complete order|buy|purchase/.test(hay)) subject = "Checkout completion reported broken";
  else if (/cart|basket/.test(hay)) subject = "Cart interaction reported failing";
  else if (/login|log in|sign in|password/.test(hay)) subject = "Sign-in flow reported failing";
  else if (/upload|image|photo|file/.test(hay)) subject = "Upload flow reported failing";
  else if (/page|load|open|render/.test(hay)) subject = `Page did not behave as expected on ${telemetry.route}`;

  const title = titleCase(
    `${subject} on ${shortRoute(telemetry.route)}${severity === "high" ? " (blocked)" : ""}`.slice(0, 90)
  );

  // --- expected / actual -------------------------------------------------
  const expected = top
    ? `Interacting with ${suspectComponent}${suspectSymbol ? ` (${suspectSymbol})` : ""} on ${telemetry.route} should complete the client's action without errors.`
    : `The page at ${telemetry.route} should complete the client's action without errors.`;

  const actualBits: string[] = [];
  if (firstError) actualBits.push(`The browser captured: "${firstError}".`);
  else if (/\bnothing happened\b|\bnothing happens\b/.test(hay))
    actualBits.push("The client reports that the action silently did nothing.");
  else actualBits.push("The client reports the page did not behave as expected.");
  if (targets.length) actualBits.push(`They mention ${targets.map((t) => `"${t}"`).join(", ")}.`);
  const actual = actualBits.join(" ");

  // --- repro steps (from real telemetry first) ----------------------------
  const steps: string[] = [];
  steps.push(`Open ${telemetry.url || telemetry.route} at viewport ${telemetry.viewport.w}x${telemetry.viewport.h}.`);
  for (const click of telemetry.clicks.slice(-4).reverse()) {
    const label = click.label ? ` ("${click.label.slice(0, 48)}")` : "";
    steps.push(`Click ${click.selector}${label}.`);
  }
  if (!telemetry.clicks.length && targets.length) {
    steps.push(`Interact with ${targets.join(", then ")}.`);
  }
  if (!telemetry.clicks.length && !targets.length) {
    steps.push(`Reproduce the client's action on ${shortRoute(telemetry.route)}.`);
  }
  steps.push(
    errors.length
      ? "Observe the captured console error and the reported failure."
      : "Observe that the expected result does not occur."
  );

  // --- summary -------------------------------------------------------------
  const transcriptSnippet = transcript
    ? ` The client described it as: "${transcript.slice(0, 180)}${transcript.length > 180 ? "…" : ""}"`
    : " The report was filed from browser telemetry alone (no transcript available).";
  const summary =
    `Voice report from a non-technical client on ${telemetry.route}. ` +
    `Captured ${telemetry.consoleLogs.length} console entries, ${telemetry.errors.length} page errors, ` +
    `and ${telemetry.clicks.length} interaction breadcrumbs.` +
    transcriptSnippet;

  const labels = ["bug", "staging", `severity:${severity}`, "git-voice"];

  return {
    title,
    severity,
    labels,
    suspectedFile: suspectFile,
    suspectedLineRange: undefined,
    suspectedFunction: suspectSymbol,
    summary,
    expected,
    actual,
    reproSteps: steps.slice(0, 7),
    issueBody: "" // filled by buildIssueBody after assembly
  };
}

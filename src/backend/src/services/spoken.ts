/** Markdown assembly for the GitHub issue body + the spoken confirmation text. */

import type { DraftIssue, IndexMatch, PipelineModels, Telemetry } from "../types.js";

export function buildIssueBody(
  draft: DraftIssue,
  transcript: string,
  telemetry: Telemetry,
  matches: IndexMatch[],
  models: PipelineModels
): string {
  const matchTable = matches.length
    ? [
        "",
        "### Architecture-index matches",
        "",
        "| Rank | File | Component | Vector | Keyword | Combined |",
        "| :--- | :--- | :--- | ---: | ---: | ---: |",
        ...matches.map(
          (m, i) =>
            `| ${i + 1} | \`${m.filePath}\` | ${m.componentName} | ${m.vectorScore.toFixed(3)} | ${m.keywordScore.toFixed(3)} | **${m.score.toFixed(3)}** |`
        )
      ].join("\n")
    : "";

  const correlations = matches
    .flatMap((m) => m.errorEnums)
    .filter((e) =>
      telemetry.consoleLogs.some((l) => l.text.includes(e)) ||
      telemetry.errors.some((er) => er.message.includes(e))
    );

  return [
    "## Summary",
    "",
    draft.summary,
    "",
    "| Field | Value |",
    "| :--- | :--- |",
    `| Severity | \`${draft.severity}\` |`,
    `| Suspected file | \`${draft.suspectedFile}\` |`,
    draft.suspectedFunction ? `| Suspected symbol | \`${draft.suspectedFunction}\` |` : null,
    `| Route | \`${telemetry.route}\` |`,
    `| Viewport | ${telemetry.viewport.w}×${telemetry.viewport.h}${telemetry.viewport.dpr ? ` @${telemetry.viewport.dpr}x` : ""} |`,
    `| Reported at | ${telemetry.url || "(origin unknown)"} |`,
    "",
    "## Reproduction steps",
    "",
    ...draft.reproSteps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Expected vs. actual",
    "",
    `- **Expected:** ${draft.expected}`,
    `- **Actual:** ${draft.actual}`,
    "",
    correlations.length
      ? ["## Console correlations", "", ...correlations.map((c) => `- \`${c}\``), ""].join("\n")
      : "",
    "## Captured telemetry",
    "",
    "<details>",
    "<summary>Browser telemetry (console, errors, clicks)</summary>",
    "",
    "```json",
    JSON.stringify(
      {
        url: telemetry.url,
        route: telemetry.route,
        viewport: telemetry.viewport,
        userAgent: telemetry.userAgent,
        language: telemetry.language,
        consoleLogs: telemetry.consoleLogs.slice(-20),
        errors: telemetry.errors.slice(-10),
        clicks: telemetry.clicks.slice(-10)
      },
      null,
      2
    ),
    "```",
    "",
    "</details>",
    "",
    "<details>",
    "<summary>Client voice transcript</summary>",
    "",
    `> ${transcript ? transcript : "(no transcript — the report was filed from telemetry only)"}`,
    "",
    "</details>",
    matchTable,
    "",
    "---",
    "",
    `<sub>Filed automatically by Git-Voice · drafter: ${models.drafter} · transcriber: ${models.transcriber} · embeddings: ${models.embeddings} · index: ${models.vectorStore}</sub>`
  ]
    .filter((block) => block !== "")
    .join("\n");
}

export function buildSpokenText(
  title: string,
  suspectedFile: string,
  severity: string,
  github?: { pushed?: boolean; issueUrl?: string; issueNumber?: number }
): string {
  const cleanTitle = title
    .replace(/\(blocked\)/gi, "")
    .replace(/[`*_#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const fileName = suspectedFile.split("/").pop() ?? suspectedFile;

  // Exactly two spoken lines: what is wrong + how it is being handled. Clients
  // hearing this should never need to read the issue to know what happens next.
  const line1 = `${cleanTitle}. It's in ${fileName}, marked ${severity} priority.`;

  let line2: string;
  if (github?.pushed) {
    const where = github.issueNumber ? `issue number ${github.issueNumber}` : "a new issue";
    line2 = `Your developer has it as ${where} on GitHub and is fixing it now.`;
  } else {
    line2 = "Your developer has it in their dashboard and will pick it up from there.";
  }

  return `${line1} ${line2}`;
}

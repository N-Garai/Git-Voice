import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/gemini.js", () => ({
  llmConfigured: () => true,
  transcribeAudio: vi.fn(async () => ({
    text: "SERVER TRANSCRIPT of the recording",
    model: "mock-stt"
  })),
  draftIssueJson: vi.fn(async () => ({ parsed: {}, model: "mock-drafter" }))
}));

vi.mock("../services/github.js", () => ({
  createGitHubIssue: vi.fn(async (args: { title: string; body: string; labels: string[] }) => ({
    pushed: true,
    repository: "acme/storefront",
    issueNumber: 42,
    issueUrl: "https://github.com/acme/storefront/issues/42"
  }))
}));

import { runIssuePipeline } from "./issueWorkflow.js";
import { sessionStore } from "../store/sessions.js";
import { projectStore, makeProject } from "../store/projects.js";
import { createGitHubIssue } from "../services/github.js";
import { transcribeAudio } from "../services/gemini.js";
import type { VectorIndex } from "../store/vectorIndex.js";

function stubIndex(): VectorIndex {
  return {
    backendName: "stub",
    add: async () => {},
    removeProject: async () => {},
    count: async () => 0,
    entriesFor: async () => [],
    search: async () => ({ matches: [], backend: "stub" }),
    close: async () => {}
  };
}

const AUDIO = { base64: "bW9jaw==", mime: "audio/webm" };
const PROVIDED = "checkout crashes when I put in my card, nothing happens";
const TELEMETRY = {
  url: "https://store.acme.test/checkout",
  route: "/checkout",
  viewport: { w: 1280, h: 720 },
  userAgent: "vitest",
  consoleLogs: [{ level: "error", text: "CartForm.tsx:19 TypeError: cannot read 'stripe' of undefined" }],
  errors: [{ message: "TypeError: cannot read 'stripe' of undefined", source: "CartForm.tsx" }],
  clicks: [{ selector: "#pay", label: "Pay now" }]
};

function prefs(overrides: Partial<{ draftReview: boolean; transcriptPreference: "auto" | "voice" | "typed" }> = {}) {
  return {
    voiceConfirmation: true,
    draftReview: false,
    includeTelemetry: true,
    transcriptPreference: "typed" as const,
    ...overrides
  };
}

describe("issue pipeline preference wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("files the report when draft review is off, using the owner's token", async () => {
    await sessionStore.create(801, "auto-file-owner", "ghp_owner");
    await projectStore.upsert(
      makeProject({
        id: "prj_auto_file",
        name: "Auto file",
        repoFullName: "acme/storefront",
        ownerLogin: "auto-file-owner"
      })
    );

    const record = await runIssuePipeline(
      { projectId: "prj_auto_file", telemetry: TELEMETRY, transcript: PROVIDED, transcriptSource: "typed-report" },
      stubIndex(),
      { entitlements: { hostedDrafting: true, premiumVoice: false }, preferences: prefs() }
    );

    expect(record?.status).toBe("completed");
    expect(record?.result?.github?.pushed).toBe(true);
    expect(record?.result?.github?.issueNumber).toBe(42);
    expect(record?.result?.confirmation.spokenText).toContain("issue number 42");

    expect(createGitHubIssue).toHaveBeenCalledTimes(1);
    const call = vi.mocked(createGitHubIssue).mock.calls[0][0];
    expect(call.repoFullName).toBe("acme/storefront");
    expect(call.ownerToken).toBe("ghp_owner");
    expect(call.labels).toContain("client-report");
  });

  it("holds the finished report as a dashboard draft when draft review is on", async () => {
    await sessionStore.create(802, "review-owner", "ghp_owner");
    await projectStore.upsert(
      makeProject({
        id: "prj_review",
        name: "Review",
        repoFullName: "acme/storefront",
        ownerLogin: "review-owner"
      })
    );

    const record = await runIssuePipeline(
      { projectId: "prj_review", telemetry: TELEMETRY, transcript: PROVIDED, transcriptSource: "typed-report" },
      stubIndex(),
      { entitlements: { hostedDrafting: true, premiumVoice: false }, preferences: prefs({ draftReview: true }) }
    );

    expect(record?.status).toBe("completed");
    expect(record?.result?.github?.pushed).toBe(false);
    expect(record?.result?.github?.reason).toContain("review");
    expect(record?.result?.draft?.title).toBeTruthy();
    expect(createGitHubIssue).not.toHaveBeenCalled();
    expect(record?.result?.confirmation.spokenText).toContain("dashboard");
  });

  it("re-transcribes the recording when the trusted source is the voice note", async () => {
    await projectStore.upsert(
      makeProject({ id: "prj_voice", name: "Voice", repoFullName: "acme/storefront" })
    );

    const record = await runIssuePipeline(
      {
        projectId: "prj_voice",
        telemetry: TELEMETRY,
        audio: AUDIO,
        transcript: PROVIDED,
        transcriptSource: "browser-speech"
      },
      stubIndex(),
      { entitlements: { hostedDrafting: true, premiumVoice: false }, preferences: prefs({ transcriptPreference: "voice" }) }
    );

    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(transcribeAudio).toHaveBeenCalledWith(AUDIO.base64, AUDIO.mime);
    expect(record?.transcript).toBe("SERVER TRANSCRIPT of the recording");
    expect(record?.transcriptSource).toBe("server-transcription");
  });

  it("keeps the browser transcript when the trusted source is the typed report", async () => {
    await projectStore.upsert(
      makeProject({ id: "prj_typed", name: "Typed", repoFullName: "acme/storefront" })
    );

    const record = await runIssuePipeline(
      {
        projectId: "prj_typed",
        telemetry: TELEMETRY,
        audio: AUDIO,
        transcript: PROVIDED,
        transcriptSource: "browser-speech"
      },
      stubIndex(),
      { entitlements: { hostedDrafting: true, premiumVoice: false }, preferences: prefs({ transcriptPreference: "typed" }) }
    );

    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(record?.transcript).toBe(PROVIDED);
    expect(record?.transcriptSource).toBe("browser-speech");
  });
});

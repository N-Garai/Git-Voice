/**
 * Account preferences.
 *
 * Settings must do something real: a toggle that only changes the UI would be
 * decorative. These tests assert the values persist and that unknown fields
 * cannot be smuggled into storage.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { apiRoutes } from "./api.js";
import { sessionStore } from "../store/sessions.js";
import { preferenceStore } from "../store/preferences.js";
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

async function cookie(login: string, id: number) {
  const s = await sessionStore.create(id, login, `token_${login}`);
  return `gv_session=${s.id}`;
}

describe("preferences defaults", () => {
  it("starts every account with auto-file semantics", () => {
    const prefs = preferenceStore.get("newcomer");
    expect(prefs.voiceConfirmation).toBe(true);
    expect(prefs.draftReview).toBe(false);
    expect(prefs.includeTelemetry).toBe(true);
    expect(prefs.transcriptPreference).toBe("auto");
  });
});

describe("preferences endpoints", () => {
  let app: ReturnType<typeof apiRoutes>;
  let auth: string;

  beforeEach(async () => {
    app = apiRoutes(stubIndex());
    auth = await cookie("settingsuser", 77);
  });

  it("returns defaults before anything is changed", async () => {
    const res = await app.request("http://local/api/preferences", { headers: { cookie: auth } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preferences: { includeTelemetry: boolean } };
    expect(body.preferences.includeTelemetry).toBe(true);
  });

  it("persists a change and reads it back", async () => {
    const patch = await app.request("http://local/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth },
      body: JSON.stringify({ includeTelemetry: false, transcriptPreference: "typed" })
    });
    expect(patch.status).toBe(200);

    const read = await app.request("http://local/api/preferences", { headers: { cookie: auth } });
    const body = (await read.json()) as {
      preferences: { includeTelemetry: boolean; transcriptPreference: string; voiceConfirmation: boolean };
    };
    expect(body.preferences.includeTelemetry).toBe(false);
    expect(body.preferences.transcriptPreference).toBe("typed");
    // Untouched fields keep their defaults.
    expect(body.preferences.voiceConfirmation).toBe(true);
  });

  it("ignores unknown fields instead of storing them", async () => {
    await app.request("http://local/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth },
      body: JSON.stringify({ includeTelemetry: false, isAdmin: true, tier: "agency", token: "leak" })
    });
    const read = await app.request("http://local/api/preferences", { headers: { cookie: auth } });
    const raw = await read.text();
    expect(raw).not.toContain("isAdmin");
    // A caller must not be able to grant themselves a plan through settings.
    expect(raw).not.toContain("leak");
  });

  it("rejects an invalid transcript preference by falling back", async () => {
    await app.request("http://local/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth },
      body: JSON.stringify({ transcriptPreference: "telepathy" })
    });
    const read = await app.request("http://local/api/preferences", { headers: { cookie: auth } });
    const body = (await read.json()) as { preferences: { transcriptPreference: string } };
    expect(body.preferences.transcriptPreference).toBe("auto");
  });

  it("requires a sign-in", async () => {
    const read = await app.request("http://local/api/preferences");
    expect(read.status).toBe(401);
    const write = await app.request("http://local/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ includeTelemetry: false })
    });
    expect(write.status).toBe(401);
  });
});

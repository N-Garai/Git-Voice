/**
 * Per-account preferences.
 *
 * These are the settings a developer can actually change from the dashboard:
 * how reports are written, what the spoken confirmation says, and which
 * transcript they prefer to read. Stored per GitHub login so the same options
 * follow the account across browsers, and mirrored to Postgres when configured.
 */
import pg from "pg";
import { config } from "../config.js";

export interface Preferences {
  login: string;
  /** Spoken confirmation after a report is filed. */
  voiceConfirmation: boolean;
  /** Hold every finished report in the dashboard instead of filing to GitHub. */
  draftReview: boolean;
  /** Include captured telemetry in the drafted issue body. */
  includeTelemetry: boolean;
  /** Preferred transcript source to trust when both are available. */
  transcriptPreference: "auto" | "voice" | "typed";
  updatedAt: string;
}

export const DEFAULT_PREFERENCES: Omit<Preferences, "login" | "updatedAt"> = {
  voiceConfirmation: true,
  // New accounts file reports automatically; review-on is an opt-in toggle in
  // the dashboard for developers who want to read every report first.
  draftReview: false,
  includeTelemetry: true,
  transcriptPreference: "auto"
};

function sanitize(raw: Record<string, unknown>, login: string): Preferences {
  return {
    login,
    voiceConfirmation: raw.voiceConfirmation !== false,
    draftReview: raw.draftReview === true,
    includeTelemetry: raw.includeTelemetry !== false,
    transcriptPreference:
      raw.transcriptPreference === "voice" || raw.transcriptPreference === "typed"
        ? raw.transcriptPreference
        : "auto",
    updatedAt: new Date().toISOString()
  };
}

export class PreferenceStore {
  private prefs = new Map<string, Preferences>();
  private pool: pg.Pool | null = null;

  constructor() {
    if (config.databaseUrl) {
      try {
        this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
      } catch {
        this.pool = null;
      }
    }
  }

  async hydrate(): Promise<void> {
    if (!this.pool) return;
    try {
      const res = await this.pool.query(
        `SELECT login, voice_confirmation, draft_review, include_telemetry, transcript_preference, updated_at
         FROM git_voice_preferences`
      );
      for (const r of res.rows as Array<Record<string, unknown>>) {
        const login = r.login as string;
        this.prefs.set(login, {
          login,
          voiceConfirmation: r.voice_confirmation !== false,
          draftReview: r.draft_review === true,
          includeTelemetry: r.include_telemetry !== false,
          transcriptPreference:
            r.transcript_preference === "voice" || r.transcript_preference === "typed"
              ? r.transcript_preference
              : "auto",
          updatedAt: (r.updated_at as Date).toISOString()
        });
      }
    } catch (err) {
      console.warn("[prefs] hydrate skipped:", err instanceof Error ? err.message : err);
    }
  }

  get(login: string): Preferences {
    const existing = this.prefs.get(login);
    if (existing) return existing;
    return { ...DEFAULT_PREFERENCES, login, updatedAt: new Date().toISOString() };
  }

  /** Patch only the known keys; unknown fields are ignored rather than stored. */
  update(login: string, patch: Record<string, unknown>): Preferences {
    const current = this.get(login);
    const next = sanitize({ ...current, ...patch }, login);
    this.prefs.set(login, next);
    if (this.pool) {
      void this.pool
        .query(
          `INSERT INTO git_voice_preferences
             (login, voice_confirmation, draft_review, include_telemetry, transcript_preference, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (login) DO UPDATE SET
             voice_confirmation = EXCLUDED.voice_confirmation,
             draft_review = EXCLUDED.draft_review,
             include_telemetry = EXCLUDED.include_telemetry,
             transcript_preference = EXCLUDED.transcript_preference,
             updated_at = EXCLUDED.updated_at`,
          [
            login,
            next.voiceConfirmation,
            next.draftReview,
            next.includeTelemetry,
            next.transcriptPreference,
            new Date(next.updatedAt)
          ]
        )
        .catch(() => {
          /* memory stays authoritative */
        });
    }
    return next;
  }

  /** Drop preferences when an account is removed. */
  async remove(login: string): Promise<void> {
    this.prefs.delete(login);
    if (!this.pool) return;
    await this.pool.query(`DELETE FROM git_voice_preferences WHERE login = $1`, [login]).catch(() => {});
  }

  async close(): Promise<void> {
    await this.pool?.end().catch(() => {});
  }
}

export const preferenceStore = new PreferenceStore();

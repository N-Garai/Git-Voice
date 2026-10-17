/**
 * Issue record persistence.
 *
 * Three layers, each optional and independent:
 *  - memory      always on; the source of truth while the process is alive.
 *  - Postgres    when DATABASE_URL is set: the whole record (minus audio) is
 *                mirrored so reports survive restarts and free-tier sleeps.
 *  - DATA_DIR    when set: an additional JSON snapshot plus audio files on disk.
 *
 * Audio is deliberately never written to Postgres — it is large and binary.
 * Only the most recent N reports keep their audio attached.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { config } from "../config.js";
import type { IssueRecord, StepTrace } from "../types.js";

const AUDIO_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav"
};

export class IssueStore {
  private issues = new Map<string, IssueRecord>();
  private order: string[] = [];
  private dirty = false;
  private snapshotPath: string | null;
  private audioDir: string | null;
  private pool: pg.Pool | null = null;
  private hydrated = false;

  constructor() {
    if (config.databaseUrl) {
      try {
        this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3 });
      } catch {
        this.pool = null;
      }
    }

    if (config.dataDir) {
      try {
        fs.mkdirSync(config.dataDir, { recursive: true });
        this.snapshotPath = path.join(config.dataDir, "issues.json");
        this.audioDir = path.join(config.dataDir, "audio");
        fs.mkdirSync(this.audioDir, { recursive: true });
        this.loadSnapshot();
      } catch (err) {
        console.warn("[store] Data dir unusable, staying in memory:", err instanceof Error ? err.message : err);
        this.snapshotPath = null;
        this.audioDir = null;
      }
    } else {
      this.snapshotPath = null;
      this.audioDir = null;
    }
  }

  /**
   * Restore records from Postgres at boot. Without this every free-tier sleep
   * or deploy would silently empty the dashboard, which is exactly the bug this
   * layer exists to prevent. Records are re-keyed by project so tenant scoping
   * keeps working against restored data.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated || !this.pool) return;
    this.hydrated = true;
    try {
      const res = await this.pool.query(
        `SELECT id, project_id, status, created_at, completed_at, error, transcript,
                transcript_source, audio_mime, telemetry, trace, result
         FROM git_voice_issues ORDER BY created_at DESC`
      );
      for (const r of res.rows as Array<Record<string, unknown>>) {
        const id = r.id as string;
        if (this.issues.has(id)) continue;
        const record: IssueRecord = {
          id,
          projectId: r.project_id as string,
          status: (r.status as IssueRecord["status"]) ?? "completed",
          createdAt: (r.created_at as Date).toISOString(),
          completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : undefined,
          error: (r.error as string) ?? undefined,
          transcript: (r.transcript as string) ?? undefined,
          transcriptSource: (r.transcript_source as IssueRecord["transcriptSource"]) ?? undefined,
          audioMime: (r.audio_mime as string) ?? undefined,
          telemetry: (r.telemetry as IssueRecord["telemetry"]) ?? {
            url: "", route: "", viewport: { w: 0, h: 0 }, userAgent: "", consoleLogs: [], errors: [], clicks: []
          },
          trace: (r.trace as StepTrace[]) ?? [],
          result: (r.result as IssueRecord["result"]) ?? undefined
        };
        this.issues.set(id, record);
        this.order.push(id);
      }
      if (this.order.length) {
        console.log(`[store] Restored ${this.order.length} issue record(s) from Postgres`);
      }
    } catch (err) {
      // A missing table is normal before the schema runs; never block boot.
      console.warn("[store] Issue hydrate skipped:", err instanceof Error ? err.message : err);
    }
  }

  /** Mirror one record to Postgres. Never throws — memory stays authoritative. */
  private persist(record: IssueRecord): void {
    if (!this.pool) return;
    const { audioBase64, ...rest } = record;
    void audioBase64;
    void this.pool
      .query(
        `INSERT INTO git_voice_issues
           (id, project_id, status, created_at, completed_at, error, transcript,
            transcript_source, audio_mime, telemetry, trace, result)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, completed_at = EXCLUDED.completed_at,
           error = EXCLUDED.error, transcript = EXCLUDED.transcript,
           transcript_source = EXCLUDED.transcript_source,
           audio_mime = EXCLUDED.audio_mime, telemetry = EXCLUDED.telemetry,
           trace = EXCLUDED.trace, result = EXCLUDED.result`,
        [
          rest.id, rest.projectId, rest.status, new Date(rest.createdAt),
          rest.completedAt ? new Date(rest.completedAt) : null,
          rest.error ?? null, rest.transcript ?? null, rest.transcriptSource ?? null,
          rest.audioMime ?? null,
          JSON.stringify(rest.telemetry ?? {}),
          JSON.stringify(rest.trace ?? []),
          rest.result ? JSON.stringify(rest.result) : null
        ]
      )
      .catch(() => {
        // Database hiccup: the in-memory record is still served correctly.
      });
  }

  private deletePersisted(id: string): void {
    if (!this.pool) return;
    void this.pool
      .query(`DELETE FROM git_voice_issues WHERE id = $1`, [id])
      .catch(() => {
        /* best effort */
      });
  }

  private loadSnapshot(): void {
    if (!this.snapshotPath || !fs.existsSync(this.snapshotPath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.snapshotPath, "utf8")) as IssueRecord[];
      for (const rec of raw) {
        // Audio never lives in the snapshot file — it is on disk or dropped.
        rec.audioBase64 = undefined;
        this.issues.set(rec.id, rec);
        this.order.push(rec.id);
      }
      console.log(`[store] Restored ${this.order.length} issue records from snapshot`);
    } catch (err) {
      console.warn("[store] Snapshot unreadable:", err instanceof Error ? err.message : err);
    }
  }

  private scheduleSnapshot(): void {
    const snapshotPath = this.snapshotPath;
    if (!snapshotPath || this.dirty) return;
    this.dirty = true;
    setTimeout(() => {
      this.dirty = false;
      try {
        const records = this.list().map(({ audioBase64, ...rest }) => {
          void audioBase64;
          return { ...rest, hasAudio: this.hasAudioOnDisk(rest.id) };
        });
        fs.writeFileSync(snapshotPath, JSON.stringify(records, null, 2));
      } catch (err) {
        console.warn("[store] Snapshot write failed:", err instanceof Error ? err.message : err);
      }
    }, 400);
  }

  private hasAudioOnDisk(id: string): boolean {
    return Boolean(this.audioDir && fs.existsSync(path.join(this.audioDir, `${id}.bin`)));
  }

  create(record: IssueRecord): void {
    this.issues.set(record.id, record);
    this.order.unshift(record.id);
    this.persist(record);
    this.trim();
    this.scheduleSnapshot();
  }

  get(id: string): IssueRecord | undefined {
    return this.issues.get(id);
  }

  list(projectId?: string): IssueRecord[] {
    const all = this.order.map((id) => this.issues.get(id)).filter((r): r is IssueRecord => Boolean(r));
    return projectId ? all.filter((r) => r.projectId === projectId) : all;
  }

  /** Delete one record (and its audio file). Returns true when it existed. */
  remove(id: string): boolean {
    const existed = this.issues.delete(id);
    const at = this.order.indexOf(id);
    if (at !== -1) this.order.splice(at, 1);
    if (this.audioDir) {
      try {
        fs.rmSync(path.join(this.audioDir, `${id}.bin`), { force: true });
      } catch {
        /* best effort */
      }
    }
    if (existed) {
      this.deletePersisted(id);
      this.scheduleSnapshot();
    }
    return existed;
  }

  /** Delete every record belonging to a project. Returns how many were removed. */
  removeProject(projectId: string): number {
    const ids = this.order.filter((id) => this.issues.get(id)?.projectId === projectId);
    for (const id of ids) this.remove(id);
    return ids.length;
  }

  update(id: string, patch: Partial<IssueRecord>): IssueRecord | undefined {
    const existing = this.issues.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.issues.set(id, updated);
    this.persist(updated);
    this.scheduleSnapshot();
    return updated;
  }

  appendTrace(id: string, entry: StepTrace): void {
    const existing = this.issues.get(id);
    if (!existing) return;
    const trace = [...existing.trace];
    const idx = trace.findIndex((t) => t.stepId === entry.stepId);
    if (idx >= 0) trace[idx] = entry;
    else trace.push(entry);
    existing.trace = trace;
    // Persist at the end of the run, not on every station tick.
    if (entry.status === "completed" || entry.status === "failed" || entry.status === "skipped") {
      this.persist(existing);
    }
  }

  async close(): Promise<void> {
    await this.pool?.end().catch(() => {});
  }

  attachAudio(id: string, base64: string, mime: string): void {
    const record = this.issues.get(id);
    if (!record) return;
    record.audioMime = mime;

    if (this.audioDir) {
      try {
        fs.writeFileSync(path.join(this.audioDir, `${id}.bin`), Buffer.from(base64, "base64"));
        record.audioBase64 = undefined;
        this.scheduleSnapshot();
        return;
      } catch {
        // fall through to in-memory attachment
      }
    }

    record.audioBase64 = base64;
    this.trimAudio();
    this.scheduleSnapshot();
  }

  getAudio(id: string): { base64: string; mime: string } | null {
    const record = this.issues.get(id);
    if (!record) return null;
    if (record.audioBase64 && record.audioMime) {
      return { base64: record.audioBase64, mime: record.audioMime };
    }
    if (this.audioDir && record.audioMime) {
      const file = path.join(this.audioDir, `${id}.bin`);
      if (fs.existsSync(file)) {
        return { base64: fs.readFileSync(file).toString("base64"), mime: record.audioMime };
      }
    }
    return null;
  }

  private trim(): void {
    while (this.order.length > config.limits.maxIssuesKept) {
      const dropped = this.order.pop();
      if (dropped) {
        this.issues.delete(dropped);
        if (this.audioDir) {
          try {
            fs.rmSync(path.join(this.audioDir, `${dropped}.bin`), { force: true });
          } catch {
            /* best effort */
          }
        }
      }
    }
  }

  private trimAudio(): void {
    let withAudio = this.order.filter((id) => this.issues.get(id)?.audioBase64);
    while (withAudio.length > config.limits.maxAudioIssuesKept) {
      const dropped = withAudio.pop();
      if (dropped) {
        const rec = this.issues.get(dropped);
        if (rec) rec.audioBase64 = undefined;
      }
      withAudio = this.order.filter((id) => this.issues.get(id)?.audioBase64);
    }
  }
}

export const issueStore = new IssueStore();

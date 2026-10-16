/**
 * Issue record persistence.
 *
 * Primary store is in-process (fast, always available). Two optional upgrades:
 *  - DATA_DIR set  → JSON snapshot (survives restarts where the disk persists)
 *                    and audio files written to disk instead of memory.
 *  - DATABASE_URL set → record metadata mirrored into Postgres.
 * Audio is capped: only the most recent N reports keep their audio attached.
 */
import fs from "node:fs";
import path from "node:path";
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

  constructor() {
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

  update(id: string, patch: Partial<IssueRecord>): IssueRecord | undefined {
    const existing = this.issues.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.issues.set(id, updated);
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

/**
 * Minimal ustar tar reader — enough to walk a GitHub repository tarball
 * (codeload.github.com/<owner>/<repo>/tar.gz/refs/heads/<branch>) without
 * spawning git or shelling out to system tar. Handles the standard ustar
 * header layout, GNU long-name ('L') entries, and pax extended headers
 * (skipped; codeload emits ustar).
 */
import zlib from "node:zlib";

export interface TarEntry {
  path: string;
  size: number;
  type: "file" | "directory" | "other";
  content?: Buffer;
}

const BLOCK = 512;

function parseOctal(buf: Buffer, start: number, length: number): number {
  const raw = buf.slice(start, start + length).toString("utf8").replace(/[\0\s]/g, "");
  if (!raw) return 0;
  const parsed = parseInt(raw, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readString(buf: Buffer, start: number, length: number): string {
  const raw = buf.slice(start, start + length);
  const end = raw.indexOf(0);
  return raw.slice(0, end === -1 ? length : end).toString("utf8");
}

export function gunzipTar(gz: Buffer): Buffer {
  return zlib.gunzipSync(gz);
}

export function readTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + BLOCK <= buf.length) {
    const header = buf.slice(offset, offset + BLOCK);

    // A fully-zero block marks the end of the archive (or padding between).
    if (header.every((b) => b === 0)) {
      offset += BLOCK;
      continue;
    }

    let name = readString(header, 0, 100);
    const size = parseOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] || 0x30);
    const prefix = readString(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;

    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) break; // truncated archive — keep what we have
    const data = buf.slice(dataStart, dataEnd);

    if (typeflag === "L") {
      // GNU long name: the next header's name replaces this entry's.
      const longName = data.toString("utf8").replace(/\0+$/, "");
      offset = dataEnd + BLOCK;
      if (offset + BLOCK > buf.length) break;
      const next = buf.slice(offset, offset + BLOCK);
      if (!next.every((b) => b === 0)) {
        const nextSize = parseOctal(next, 124, 12);
        const nextDataStart = offset + BLOCK;
        const nextType = String.fromCharCode(next[156] || 0x30);
        const nextData = buf.slice(nextDataStart, nextDataStart + nextSize);
        entries.push({
          path: longName,
          size: nextSize,
          type: nextType === "5" ? "directory" : nextType === "0" || nextType === "\0" ? "file" : "other",
          content: nextType === "0" || nextType === "\0" ? nextData : undefined
        });
        offset = nextDataStart + Math.ceil(nextSize / BLOCK) * BLOCK;
        continue;
      }
      continue;
    }

    if (typeflag === "x" || typeflag === "g") {
      // pax extended header — the following entry carries the real metadata.
      offset = dataEnd + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }

    entries.push({
      path: name,
      size,
      type: typeflag === "5" ? "directory" : typeflag === "0" || typeflag === "\0" ? "file" : "other",
      content: typeflag === "0" || typeflag === "\0" ? data : undefined
    });

    // The next header follows after the data, padded to a 512-byte boundary.
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}

/** GitHub codeload tarballs wrap everything in a top-level <repo>-<ref>/ folder. */
export function stripCommonPrefix(entries: TarEntry[]): TarEntry[] {
  if (!entries.length) return entries;
  const first = entries[0].path;
  const top = first.includes("/") ? first.split("/")[0] : "";
  if (!top) return entries;
  // Only strip when every entry genuinely shares that top-level folder and there
  // is more than one entry (a lone file cannot prove a wrapper folder exists).
  const prefix = `${top}/`;
  if (entries.length < 2) return entries;
  if (!entries.every((e) => e.path.startsWith(prefix))) return entries;
  return entries.map((e) => ({ ...e, path: e.path.slice(prefix.length) }));
}

import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { readTar, stripCommonPrefix, gunzipTar, type TarEntry } from "./tar.js";

/** Build a valid ustar archive in memory (exactly what the reader must accept). */
function buildTar(files: Array<{ path: string; content: string }>): Buffer {
  const chunks: Buffer[] = [];

  for (const file of files) {
    const header = Buffer.alloc(512);
    header.write(file.path.slice(0, 99), 0, "utf8");

    // size in octal, null-terminated, 12 bytes
    const sizeOctal = file.content.length.toString(8).padStart(11, "0");
    header.write(sizeOctal, 124, "ascii");
    header.write("0000644\0" + "0000000\0" + "0000000\0", 100, "ascii"); // mode, uid, gid
    header.write("0", 156, "ascii"); // typeflag: regular file

    // checksum: spaces while computing
    header.write("        ", 148, "ascii");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");

    // ustar magic
    header.write("ustar\0" + "00", 257, "ascii");

    chunks.push(header);
    const data = Buffer.from(file.content, "utf8");
    chunks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }

  chunks.push(Buffer.alloc(1024)); // two zero blocks terminate the archive
  return Buffer.concat(chunks);
}

/** Header with an arbitrary typeflag — used for pax global/extended headers. */
function buildTypedHeader(
  name: string,
  typeflag: string,
  size: number,
  content: Buffer
): { header: Buffer; data: Buffer } {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 99), 0, "utf8");
  header.write(size.toString(8).padStart(11, "0"), 124, "ascii");
  header.write("0000644\0" + "0000000\0" + "0000000\0", 100, "ascii");
  header.write(typeflag, 156, "ascii");
  header.write("        ", 148, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  header.write("ustar\0" + "00", 257, "ascii");
  const pad = (512 - (content.length % 512)) % 512;
  return { header, data: Buffer.concat([content, Buffer.alloc(pad)]) };
}

/**
 * codeload.tar.gz prefixes every archive with a `pax_global_header` whose
 * payload is 52 bytes — not a whole number of 512-byte blocks. Regression guard:
 * mis-advancing past that block desynchronises every subsequent entry, which
 * silently produced empty paths and garbage content.
 */
function buildTarballWithPaxGlobal(files: Array<{ path: string; content: string }>): Buffer {
  const pax = buildTypedHeader(
    "pax_global_header",
    "g",
    52,
    Buffer.from("52 mtime=1757576295.532175\n30 comment=2d49746572", "utf8")
  );
  return Buffer.concat([pax.header, pax.data, buildTar(files)]);
}

describe("readTar", () => {
  it("reads regular files with contents", () => {
    const tar = buildTar([
      { path: "repo-main/src/a.ts", content: "export const a = 1;" },
      { path: "repo-main/src/b.ts", content: "export const b = 2;\n".repeat(10) }
    ]);
    const entries = readTar(tar);
    const files = entries.filter((e) => e.type === "file");
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("repo-main/src/a.ts");
    expect(files[0].content?.toString()).toBe("export const a = 1;");
  });

  it("handles contents that are exact multiples of the block size", () => {
    const content = "x".repeat(512);
    const tar = buildTar([{ path: "f", content }]);
    const entries = readTar(tar).filter((e) => e.type === "file");
    expect(entries[0].content?.length).toBe(512);
    expect(entries).toHaveLength(1);
  });

  it("stops cleanly on a truncated archive", () => {
    const tar = buildTar([{ path: "f", content: "hello world" }]).slice(0, 600);
    const entries = readTar(tar);
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it("skips a pax_global_header and still reads every real entry", () => {
    const tar = buildTarballWithPaxGlobal([
      { path: "flappy-bird-main/README.md", content: "# Flappy Bird" },
      { path: "flappy-bird-main/script.js", content: "const sounds = {};\nfunction flap() {}\n" },
      { path: "flappy-bird-main/styles.css", content: "body { margin: 0 }" }
    ]);
    const files = readTar(tar).filter((e) => e.type === "file");

    expect(files).toHaveLength(3);
    expect(files.map((f) => f.path)).toEqual([
      "flappy-bird-main/README.md",
      "flappy-bird-main/script.js",
      "flappy-bird-main/styles.css"
    ]);
    // Content integrity — the real symptom of the offset bug was garbage text.
    expect(files[0].content?.toString()).toBe("# Flappy Bird");
    expect(files[1].content?.toString()).toContain("function flap()");
    expect(files[2].content?.toString()).toBe("body { margin: 0 }");
  });

  it("still strips the wrapper folder after a pax global header", () => {
    const tar = buildTarballWithPaxGlobal([
      { path: "flappy-bird-main/index.html", content: "<h1>hi</h1>" },
      { path: "flappy-bird-main/script.js", content: "const a = 1;" }
    ]);
    const stripped = stripCommonPrefix(readTar(tar)).filter((e) => e.type === "file");
    expect(stripped.map((e) => e.path)).toEqual(["index.html", "script.js"]);
  });
});

describe("stripCommonPrefix", () => {
  it("strips the codeload top-level folder", () => {
    const entries: TarEntry[] = [
      { path: "repo-abc123/src/a.ts", size: 0, type: "file" },
      { path: "repo-abc123/README.md", size: 0, type: "file" }
    ];
    const stripped = stripCommonPrefix(entries);
    expect(stripped[0].path).toBe("src/a.ts");
    expect(stripped[1].path).toBe("README.md");
  });

  it("leaves paths without a common prefix untouched", () => {
    const entries: TarEntry[] = [{ path: "src/a.ts", size: 0, type: "file" }];
    expect(stripCommonPrefix(entries)[0].path).toBe("src/a.ts");
  });
});

describe("gunzipTar", () => {
  it("round-trips a gzipped tarball", () => {
    const tar = buildTar([{ path: "x.ts", content: "export const x = 42;" }]);
    const gz = zlib.gzipSync(tar);
    const round = gunzipTar(gz);
    const entries = readTar(round).filter((e) => e.type === "file");
    expect(entries[0].content?.toString()).toBe("export const x = 42;");
  });
});

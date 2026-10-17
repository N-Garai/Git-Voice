/**
 * Coverage probe: which repository shapes actually get indexed.
 *
 * Answers "can it handle my repo?" with evidence rather than assumption —
 * server-only repos, no-JS repos, large monorepos, and the skip rules.
 */
import { describe, expect, it } from "vitest";
import { isIndexableFile } from "./chunk.js";
import { gunzipTar, readTar, stripCommonPrefix } from "./tar.js";

/** Build a ustar+pax archive in memory so we exercise the real reader. */
function tarball(files: Array<{ path: string; content: string }>): Buffer {
  const blocks: Buffer[] = [];

  const header = (name: string, size: number, type: string): Buffer => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 99), 0, "utf8");
    h.write(size.toString(8).padStart(11, "0"), 124, "ascii");
    h.write("0000644\0" + "0000000\0" + "0000000\0", 100, "ascii");
    h.write(type, 156, "ascii");
    h.write("        ", 148, "ascii");
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
    h.write("ustar\0" + "00", 257, "ascii");
    return h;
  };

  // Real codeload tarballs open with a pax_global_header.
  const paxPayload = Buffer.from("52 mtime=1757576295.532175\n", "utf8");
  blocks.push(header("pax_global_header", paxPayload.length, "g"), paxPayload);
  blocks.push(Buffer.alloc((512 - (paxPayload.length % 512)) % 512));

  for (const f of files) {
    const data = Buffer.from(f.content, "utf8");
    blocks.push(header(f.path, data.length, "0"), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function indexedPaths(files: Array<{ path: string; content: string }>): string[] {
  const entries = stripCommonPrefix(readTar(gunzipTarProbe(tarball(files))));
  return entries
    .filter((e) => e.type === "file" && e.content)
    .filter((e) => isIndexableFile(e.path, e.size))
    .map((e) => e.path);
}

/** tarball() already returns plain tar; gunzipTar is exercised separately. */
function gunzipTarProbe(buf: Buffer): Buffer {
  return buf;
}

describe("repository shape coverage", () => {
  it("indexes a plain static site", () => {
    const paths = indexedPaths([
      { path: "site/index.html", content: "<h1>hi</h1>" },
      { path: "site/style.css", content: "body{}" },
      { path: "site/app.js", content: "console.log(1)" }
    ]);
    expect(paths).toEqual(["index.html", "style.css", "app.js"]);
  });

  it("indexes a modern component framework", () => {
    const paths = indexedPaths([
      { path: "app/src/App.tsx", content: "export function App(){}" },
      { path: "app/src/routes/Home.tsx", content: "export default Home" },
      { path: "app/src/lib/api.ts", content: "export const x=1" },
      { path: "app/src/pages/Dash.vue", content: "<template/>" },
      { path: "app/src/Widget.svelte", content: "<script/>" },
      { path: "app/src/styles/main.scss", content: "a{b:c}" }
    ]);
    expect(paths).toHaveLength(6);
  });

  it("indexes a server-only repository with no front end", () => {
    const paths = indexedPaths([
      { path: "api/server.js", content: "app.get('/', h)" },
      { path: "api/routes/orders.js", content: "module.exports = {}" },
      { path: "api/db/schema.js", content: "exports.table = 1" }
    ]);
    expect(paths).toHaveLength(3);
  });

  it("skips dependency, build, binary and generated trees", () => {
    const paths = indexedPaths([
      { path: "r/src/app.js", content: "1" },
      { path: "r/node_modules/lib/index.js", content: "1" },
      { path: "r/dist/bundle.js", content: "1" },
      { path: "r/build/out.js", content: "1" },
      { path: "r/assets/logo.png", content: "1" },
      { path: "r/package-lock.json", content: "{}" },
      { path: "r/go.sum", content: "h1:" },
      { path: "r/tsconfig.json", content: "{}" }
    ]);
    expect(paths).toEqual(["src/app.js"]);
  });

  it("indexes backend languages, not just front end", () => {
    const paths = indexedPaths([
      { path: "svc/handlers.py", content: "def handle(): pass" },
      { path: "svc/Order.java", content: "class OrderService {}" },
      { path: "svc/server.go", content: "func main() {}" },
      { path: "svc/lib.rs", content: "pub fn run() {}" },
      { path: "svc/model.rb", content: "class User\nend" },
      { path: "svc/Repo.php", content: "class Repo {}" },
      { path: "svc/Service.cs", content: "class Service {}" },
      { path: "README.md", content: "# Docs" },
      { path: "config.yml", content: "a: 1" }
    ]);
    expect(paths).toHaveLength(9);
  });

  it("skips oversized files but keeps the rest of the repo", () => {
    const paths = indexedPaths([
      { path: "r/small.js", content: "1" },
      { path: "r/huge.js", content: "x".repeat(300 * 1024) }
    ]);
    expect(paths).toEqual(["small.js"]);
  });

  it("parses a 1200-file repository without dropping the tail", () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      path: `repo/src/module${i}.ts`,
      content: `export const v${i} = ${i};`
    }));
    const paths = indexedPaths(many);
    expect(paths).toHaveLength(1200);
    expect(paths[1199]).toBe("src/module1199.ts");
  });

  it("keeps nested paths intact after prefix stripping", () => {
    const paths = indexedPaths([
      { path: "owner-repo-main/a/b/c/deep.js", content: "1" },
      { path: "owner-repo-main/a/b/other.js", content: "2" }
    ]);
    expect(paths).toEqual(["a/b/c/deep.js", "a/b/other.js"]);
  });
});
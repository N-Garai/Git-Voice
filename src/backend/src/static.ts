/**
 * Static serving: dashboard SPA (src/frontend/dist), the embeddable widget
 * bundle (src/frontend/dist-widget/widget.js), and a demo staging page that
 * loads the widget — one origin, no CORS games.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MiddlewareHandler } from "hono";

const backendDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locate the repo/app root by walking up from the compiled file location until
 * we find a directory containing src/frontend/dist. Works for every start
 * layout:
 *   dev          src/backend/src/static.js
 *   compiled     src/backend/dist/static.js
 *   Docker       /app/src/backend/dist/static.js
 */
function findAppRoot(): string {
  let dir = backendDir;
  for (let depth = 0; depth < 6; depth++) {
    if (fs.existsSync(path.join(dir, "src/frontend/dist"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Unbuilt checkout — fall back to the source-tree location of the SPA.
  return path.resolve(backendDir, "../../..");
}

const appRoot = findAppRoot();
export const frontendDistDir = path.join(appRoot, "src/frontend/dist");
export const widgetBundlePath = path.join(appRoot, "src/frontend/dist-widget/widget.js");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

function contentTypeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** Serves the compiled widget bundle with a long browser cache. */
export function widgetJsRoute(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path !== "/api/widget.js") return next();
    if (!fs.existsSync(widgetBundlePath)) {
      return c.body(
        "console.warn('[git-voice] widget bundle missing — run the frontend build first');",
        200,
        { "Content-Type": "application/javascript; charset=utf-8" }
      );
    }
    return c.body(fs.readFileSync(widgetBundlePath), 200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    });
  };
}

/**
 * SPA static handler with an index.html fallback for client-side routes.
 *
 * Hand-rolled against the absolute dist dir so it works no matter which
 * working directory the process was started from (repo root in Docker,
 * src/backend in dev).
 */
export function spaStatic(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();

    const urlPath = decodeURIComponent(c.req.path);
    if (urlPath.startsWith("/api/") || urlPath === "/api" || urlPath === "/health") return next();

    // Resolve inside the dist dir only — reject traversal.
    const relative = urlPath.replace(/^\/+/, "");
    const resolved = path.resolve(frontendDistDir, relative || "");
    if (resolved !== frontendDistDir && !resolved.startsWith(frontendDistDir + path.sep)) return next();

    const isDirectoryRequest = relative.endsWith("/") || !path.extname(resolved);
    let filePath = resolved;

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveFile(c, filePath);
    }

    // SPA fallback: extension-less routes (client-side navigation) get index.html.
    if (isDirectoryRequest) {
      const indexPath = path.join(frontendDistDir, "index.html");
      if (fs.existsSync(indexPath)) return serveFile(c, indexPath, true);
    }

    return next();
  };
}

function serveFile(c: Parameters<MiddlewareHandler>[0], filePath: string, noCache = false): Response {
  const isHashedAsset = filePath.includes(`${path.sep}assets${path.sep}`);
  return c.body(fs.readFileSync(filePath), 200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": noCache ? "no-cache" : isHashedAsset ? "public, max-age=31536000, immutable" : "public, max-age=3600"
  });
}

export function contentType(filePath: string): string {
  return contentTypeFor(filePath);
}

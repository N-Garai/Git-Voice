/**
 * Signature extractor — turns a source file into a compact, indexable
 * description of its role in the architecture: exported symbols, thrown error
 * codes, UI class names, route literals, and framework component names.
 *
 * We deliberately index *signatures*, not raw code: it keeps the corpus small,
 * keeps client source out of third-party embedding calls, and gives the
 * retriever exactly the vocabulary a voice complaint tends to hit
 * (component names, button labels, error strings, routes).
 */

export interface FileSignature {
  filePath: string;
  componentName: string;
  routePath: string;
  exportedSymbols: string[];
  errorEnums: string[];
  classNames: string[];
  routes: string[];
  description: string;
  signature: string;
}

const TEXT_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
  ".css", ".scss", ".sass", ".less", ".html", ".htm", ".astro"
];

const SKIP_DIRS = [
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage",
  ".turbo", ".cache", "vendor", "__pycache__", ".venv", "target"
];

const SKIP_FILES = [
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"
];

const BINARY_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svgz", ".woff", ".woff2",
  ".ttf", ".eot", ".otf", ".mp4", ".webm", ".mp3", ".wav", ".zip", ".gz", ".tar",
  ".pdf", ".exe", ".dll", ".so", ".dylib", ".wasm", ".map"
];

export function isIndexableFile(filePath: string, sizeBytes: number): boolean {
  if (sizeBytes > 200 * 1024) return false;
  const lower = filePath.toLowerCase();
  if (SKIP_FILES.some((f) => lower.endsWith(f))) return false;
  if (BINARY_EXTENSIONS.some((ext) => lower.endsWith(ext))) return false;
  const dirParts = lower.split("/");
  if (dirParts.some((p) => SKIP_DIRS.includes(p))) return false;
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function baseComponentName(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.[^.]+$/, "");
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function extractSignature(filePath: string, source: string): FileSignature {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const componentName = baseComponentName(filePath);
  const isStyle = ext === ".css" || ext === ".scss" || ext === ".sass" || ext === ".less";
  const isMarkup = ext === ".html" || ext === ".htm";

  // Exported symbols ---------------------------------------------------------
  const exportedSymbols: string[] = [];
  if (!isStyle && !isMarkup) {
    const patterns = [
      /export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
      /export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g,
      /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g,
      /export\s+default\s+([A-Za-z0-9_$]+)/g,
      /export\s*\{([^}]+)\}/g
    ];
    for (const pattern of patterns) {
      for (const m of source.matchAll(pattern)) {
        const group = m[1];
        for (const name of group.split(",")) {
          const clean = name.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
          if (/^[A-Za-z0-9_$]+$/.test(clean) && !exportedSymbols.includes(clean)) {
            exportedSymbols.push(clean);
          }
        }
      }
    }
  }

  // Thrown / declared error codes --------------------------------------------
  const errorEnums: string[] = [];
  if (!isStyle) {
    for (const m of source.matchAll(/(?:throw\s+(?:new\s+\w*)?|new\s+\w*Error\s*\(\s*)['"`]([A-Z][A-Z0-9_]{2,})['"`]/g)) {
      if (!errorEnums.includes(m[1])) errorEnums.push(m[1]);
    }
    // SCREAMING_SNAKE constants declared in the file (error-code convention).
    for (const m of source.matchAll(/\b([A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+)\b/g)) {
      if (!errorEnums.includes(m[1]) && errorEnums.length < 12) errorEnums.push(m[1]);
    }
  }

  // UI class names -------------------------------------------------------------
  const classNames: string[] = [];
  for (const m of source.matchAll(/className=["'`{]([^"'`}]{2,120})/g)) {
    for (const token of m[1].split(/[\s'"`]+/)) {
      const clean = token.replace(/[{}()]/g, "").trim();
      if (/^[a-zA-Z][\w-]*$/.test(clean) && !classNames.includes(clean) && classNames.length < 16) {
        classNames.push(clean);
      }
    }
  }
  if (isStyle) {
    for (const m of source.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      if (!classNames.includes(m[1]) && classNames.length < 16) classNames.push(m[1]);
    }
  }

  // Route literals ---------------------------------------------------------------
  const routes: string[] = [];
  const routePatterns = [
    /(?:path|route|href|to)\s*[=:"']\s*["'`](\/[a-zA-Z0-9_\-/:.]*)["'`]/g,
    /["'`](\/(?:api|app|checkout|cart|settings|auth|account|onboarding|dashboard|billing|profile|admin|login|signup|search)(?:\/[a-zA-Z0-9_\-/:.]*)?)["'`]/g
  ];
  for (const pattern of routePatterns) {
    for (const m of source.matchAll(pattern)) {
      const route = m[1].replace(/[:*].*$/, "") || "/";
      if (!routes.includes(route) && routes.length < 10) routes.push(route);
    }
  }

  const routePath = routes.find((r) => r !== "/") ?? routes[0] ?? "";
  const description = buildDescription(componentName, filePath, exportedSymbols, errorEnums, classNames, routes, source);
  const signature = [
    `path:${filePath}`,
    `component:${componentName}`,
    routePath ? `route:${routePath}` : "",
    exportedSymbols.length ? `exports:${exportedSymbols.join(",")}` : "",
    errorEnums.length ? `errors:${errorEnums.join(",")}` : "",
    classNames.length ? `classNames:${classNames.slice(0, 8).join(",")}` : "",
    routes.length ? `routes:${routes.join(",")}` : "",
    `desc:${description}`
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    filePath,
    componentName,
    routePath,
    exportedSymbols: unique(exportedSymbols).slice(0, 12),
    errorEnums: unique(errorEnums).slice(0, 12),
    classNames: unique(classNames),
    routes: unique(routes),
    description,
    signature
  };
}

/** One-line human summary of the file's role, derived from real evidence. */
function buildDescription(
  componentName: string,
  filePath: string,
  exportedSymbols: string[],
  errorEnums: string[],
  classNames: string[],
  routes: string[],
  source: string
): string {
  const parts: string[] = [];
  parts.push(`${componentName} in ${filePath}`);
  if (exportedSymbols.length) parts.push(`exposes ${exportedSymbols.slice(0, 4).join(", ")}`);
  if (errorEnums.length) parts.push(`error surface: ${errorEnums.slice(0, 4).join(", ")}`);
  if (routes.length) parts.push(`related routes: ${routes.slice(0, 3).join(", ")}`);
  if (classNames.length) parts.push(`ui: ${classNames.slice(0, 4).join(", ")}`);

  // A leading comment often states intent — free context, cheap to include.
  const comment = source.match(/^(?:\s*\/\*\*?|\s*\/\/\s*)(.{10,140})/);
  if (comment) parts.push(comment[1].replace(/\*\/$/, "").trim());

  return parts.join("; ").slice(0, 400);
}

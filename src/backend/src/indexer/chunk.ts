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

/**
 * Files with no meaningful extension whose contents still describe how the
 * project builds and runs — a frequent source of deployment bugs.
 */
const EXTENSIONLESS_FILES = [
  "dockerfile", "containerfile", "makefile", "gnumakefile", "jenkinsfile",
  "procfile", "cmakelists.txt", "rakefile", "brewfile", "justfile", "vagrantfile"
];

/** Dotfiles that describe toolchain or ignore rules rather than app code. */
const DOTFILE_PATTERNS = [
  ".gitignore", ".dockerignore", ".npmrc", ".nvmrc", ".node-version",
  ".python-version", ".ruby-version", ".tool-versions", ".editorconfig",
  ".gitattributes", ".env.example", ".env.sample", ".prettierrc", ".eslintrc"
];

const TEXT_EXTENSIONS = [
  // Web front end
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro",
  ".css", ".scss", ".sass", ".less", ".html", ".htm",
  // Backend / server
  ".py", ".java", ".go", ".rs", ".rb", ".php", ".cs", ".kt", ".swift",
  ".scala", ".ex", ".exs", ".hs", ".lua", ".dart", ".sql", ".graphql", ".proto",
  // Shell + config + prose that describe intent
  ".sh", ".bash", ".zsh", ".yml", ".yaml", ".toml", ".env.example",
  ".md", ".mdx", ".json"
];

/** Documentation/manifest files carry intent but no symbols. */
const PROSE_EXTENSIONS = new Set([".md", ".mdx", ".json", ".yml", ".yaml", ".toml", ".sh", ".bash", ".zsh", ".env.example"]);

const SKIP_FILES = [
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
  // Large machine-generated data that adds noise, not signal.
  "composer.lock", "gemfile.lock", "cargo.lock", "go.sum", "poetry.lock",
  "tsconfig.json", "jsconfig.json"
];

/** Directories whose contents are generated or vendored, never hand-written. */
const SKIP_DIRS = [
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage",
  ".turbo", ".cache", "vendor", "__pycache__", ".venv", "venv", "target",
  "bin", "obj", ".idea", ".gradle", "migrations", "fixtures", "__snapshots__"
];

const BINARY_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svgz", ".woff", ".woff2",
  ".ttf", ".eot", ".otf", ".mp4", ".webm", ".mp3", ".wav", ".zip", ".gz", ".tar",
  ".pdf", ".exe", ".dll", ".so", ".dylib", ".wasm", ".map"
];

export function isIndexableFile(filePath: string, sizeBytes: number): boolean {
  if (sizeBytes > 200 * 1024) return false;
  const lower = filePath.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  if (SKIP_FILES.some((f) => base === f || base.endsWith(f))) return false;
  if (BINARY_EXTENSIONS.some((ext) => base.endsWith(ext))) return false;
  const dirParts = lower.split("/");
  if (dirParts.some((p) => SKIP_DIRS.includes(p))) return false;

  if (TEXT_EXTENSIONS.some((ext) => base.endsWith(ext))) return true;
  // Build/tooling files that carry no extension: Dockerfile, Makefile, Procfile…
  if (EXTENSIONLESS_FILES.some((name) => base === name || base.startsWith(`${name}.`))) return true;
  // Toolchain + ignore dotfiles (.nvmrc, .gitignore, .editorconfig…).
  if (DOTFILE_PATTERNS.includes(base)) return true;

  return false;
}

export function baseComponentName(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  // Known source extensions are stripped; anything else (Dockerfile, Makefile,
  // .nvmrc, Dockerfile.prod) keeps its full name so it never becomes empty.
  const known = TEXT_EXTENSIONS.concat(BINARY_EXTENSIONS);
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const ext = base.slice(dot).toLowerCase();
    if (known.includes(ext)) return base.slice(0, dot);
  }
  return base;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * Build/tooling files have their own instruction vocabulary. Exposing the
 * important directives (base image, exposed port, entrypoint, targets) is what
 * lets a report like "the deploy fails on Render" point at the right file.
 */
function extractToolingDirectives(source: string): string[] {
  const out: string[] = [];
  const add = (v: string | undefined) => {
    if (v && !out.includes(v) && out.length < 12) out.push(v);
  };

  if (/^\s*FROM\s+/im.test(source)) {
    for (const m of source.matchAll(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+([^\s]+))?/gim)) {
      add(m[2] ? `${m[1]} AS ${m[2]}` : m[1]);
    }
  }
  if (/^\s*EXPOSE\s+/im.test(source)) {
    for (const m of source.matchAll(/^\s*EXPOSE\s+([0-9]+(?:\s+[0-9]+)*)/gim)) {
      for (const port of m[1].split(/\s+/)) add(`EXPOSE ${port}`);
    }
  }
  if (/^\s*CMD\s+/im.test(source)) {
    for (const m of source.matchAll(/^\s*CMD\s+\[?\[?\s*["']([^"']{2,80})/gim)) add(`CMD ${m[1]}`);
  }
  if (/^\s*ENTRYPOINT\s+/im.test(source)) {
    for (const m of source.matchAll(/^\s*ENTRYPOINT\s+\[?\[?\s*["']([^"']{2,80})/gim)) {
      add(`ENTRYPOINT ${m[1]}`);
    }
  }
  for (const m of source.matchAll(
    /^[ \t]*(?:FROM[ \t]+\S+[ \t]+)?RUN[ \t]+((?:npm|yarn|pnpm|pip3?|python3?|go|cargo|bun|apt|apt-get|apk|mvn|gradle)[ \t]+[^\n&|]{1,60})/gim
  )) {
    add(`RUN ${m[1].replace(/\s+/g, " ").trim()}`);
  }
  return out;
}

/** Targets/commands for Makefiles and friends. */
function extractMakeTargets(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^([A-Za-z0-9_.\-/]+)\s*:(?!=)/gm)) {
    const target = m[1].trim();
    if (target && !out.includes(target) && out.length < 12) out.push(target);
  }
  return out;
}

export function extractSignature(filePath: string, source: string): FileSignature {
  const lowerPath = filePath.toLowerCase();
  const extIndex = lowerPath.lastIndexOf(".");
  const base = lowerPath.split("/").pop() ?? lowerPath;
  const ext = extIndex > lowerPath.lastIndexOf("/") ? lowerPath.slice(extIndex) : "";
  const componentName = baseComponentName(filePath);
  const isStyle = ext === ".css" || ext === ".scss" || ext === ".sass" || ext === ".less";
  const isMarkup = ext === ".html" || ext === ".htm";
  const isProse = PROSE_EXTENSIONS.has(ext);
  const isContainerfile = /^dockerfile(\..*)?$/.test(base) || base === "containerfile";
  const isMakefile = base === "makefile" || base === "gnumakefile" || base === "rakefile";

  // Exported symbols ---------------------------------------------------------
  const exportedSymbols: string[] = [];
  if (isContainerfile) {
    exportedSymbols.push(...extractToolingDirectives(source));
  } else if (isMakefile) {
    exportedSymbols.push(...extractMakeTargets(source));
  } else if (!isStyle && !isMarkup && !isProse) {
    const patterns = [
      // ES modules / TypeScript
      /export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
      /export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g,
      /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g,
      /export\s+default\s+([A-Za-z0-9_$]+)/g,
      /export\s*\{([^}]+)\}/g,
      // Python
      /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)/gm,
      /^\s*class\s+([A-Za-z0-9_]+)/gm,
      // Go
      /^func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/gm,
      /^type\s+([A-Za-z0-9_]+)/gm,
      // Rust
      /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/gm,
      /^\s*(?:pub\s+)?(?:struct|enum|trait|type)\s+([A-Za-z0-9_]+)/gm,
      // Java / Kotlin / C# / Scala
      /^\s*(?:public|private|protected|internal|open|final|abstract|static|\s)*\b(?:class|interface|enum|record|object)\s+([A-Za-z0-9_]+)/gm,
      // Ruby / PHP
      /^\s*def\s+([A-Za-z0-9_?!]+)/gm,
      /^\s*(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/gm,
      /^\s*(?:public\s+|private\s+|protected\s+)?function\s+([A-Za-z0-9_]+)/gm,
      // Elixir / Haskell / Lua / Dart / Swift
      /^\s*defmodule\s+([A-Za-z0-9_.]+)/gm,
      /^\s*[a-z_]+\s+([A-Za-z0-9_']+)\s+::/gm,
      /^\s*(?:local\s+)?function\s+([A-Za-z0-9_.:]+)/gm,
      /^\s*(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/gm
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
      // Front-end: JSX/Router attributes and literal paths.
      /(?:path|route|href|to)\s*[=:"']\s*["'`](\/[a-zA-Z0-9_\-/:.]*)["'`]/g,
      /["'`](\/(?:api|app|checkout|cart|settings|auth|account|onboarding|dashboard|billing|profile|admin|login|signup|search)(?:\/[a-zA-Z0-9_\-/:.]*)?)["'`]/g,
      // Backend routers.
      /(?:app|router|api)\.(?:get|post|put|patch|delete|use)\s*\(\s*["'`](\/[a-zA-Z0-9_\-/:.{}]*)["'`]/g,
      /@(?:app|router|bp|blueprint)\.route\s*\(\s*["'`](\/[a-zA-Z0-9_\-/:.{}]*)["'`]/g,
      /path\s*\(?\s*["'`](\/[a-zA-Z0-9_\-/:.{}]*)["'`]/g,
      /(?:get|post|put|delete)\s+["'`](\/[a-zA-Z0-9_\-/:.{}]*)["'`]/g,
      /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["'`](\/[a-zA-Z0-9_\-/:.{}]*)["'`]/g,
      /(?:http\.)?HandleFunc\s*\(\s*["`](\/[a-zA-Z0-9_\-/:.{}]*)["`]/g,
      /^\s*[a-z]+\s+["'`](\/[a-zA-Z0-9_\-/:.{}]*)["'`]/gm,
      // Docs and API surfaces.
      /["'`](\/(?:v\d+|graphql|health|status|webhooks?)(?:\/[a-zA-Z0-9_\-/:.]*)?)["'`]/g
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

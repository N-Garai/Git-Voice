/**
 * Build/tooling file coverage.
 *
 * Dockerfile, Makefile and dotfiles carry no extension, so they need explicit
 * handling — both to be indexed at all and to extract something meaningful.
 */
import { describe, expect, it } from "vitest";
import { extractSignature, isIndexableFile, baseComponentName } from "./chunk.js";

describe("extensionless build files are indexed", () => {
  it("accepts container and build files", () => {
    for (const f of [
      "Dockerfile",
      "dockerfile",
      "Dockerfile.prod",
      "backend/Dockerfile",
      "Containerfile",
      "Makefile",
      "GNUmakefile",
      "Procfile",
      "CMakeLists.txt",
      "Jenkinsfile",
      "Rakefile"
    ]) {
      expect(isIndexableFile(f, 1000), f).toBe(true);
    }
  });

  it("accepts toolchain and ignore dotfiles", () => {
    for (const f of [
      ".gitignore",
      ".dockerignore",
      ".nvmrc",
      ".node-version",
      ".python-version",
      ".tool-versions",
      ".editorconfig",
      ".env.example",
      ".prettierrc"
    ]) {
      expect(isIndexableFile(f, 500), f).toBe(true);
    }
  });

  it("still rejects binaries and lockfiles that look similar", () => {
    expect(isIndexableFile("logo.png", 1000)).toBe(false);
    expect(isIndexableFile("package-lock.json", 1000)).toBe(false);
    expect(isIndexableFile("go.sum", 1000)).toBe(false);
    expect(isIndexableFile("tsconfig.json", 1000)).toBe(false);
    expect(isIndexableFile("node_modules/pkg/Dockerfile", 1000)).toBe(false);
  });

  it("keeps the name intact for extensionless files", () => {
    expect(baseComponentName("Dockerfile")).toBe("Dockerfile");
    expect(baseComponentName("src/Dockerfile.prod")).toBe("Dockerfile.prod");
    expect(baseComponentName("src/App.tsx")).toBe("App");
  });
});

describe("Dockerfile signatures are useful", () => {
  const dockerfile = [
    "# syntax=docker/dockerfile:1.7",
    "FROM node:22-alpine AS frontend-build",
    "WORKDIR /app",
    "COPY package.json package-lock.json ./",
    "RUN npm ci",
    "COPY src/frontend ./src/frontend",
    "RUN npm run build -w @git-voice/frontend",
    "",
    "FROM node:22-alpine AS runtime",
    "ENV NODE_ENV=production",
    "ENV PORT=10000",
    "EXPOSE 10000",
    "HEALTHCHECK --interval=30s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1",
    'CMD ["node", "src/backend/dist/index.js"]'
  ].join("\n");

  it("captures base images, stages, exposed ports and the start command", () => {
    const sig = extractSignature("Dockerfile", dockerfile);
    const joined = sig.exportedSymbols.join(" | ");

    expect(joined).toContain("node:22-alpine AS frontend-build");
    expect(joined).toContain("node:22-alpine AS runtime");
    expect(joined).toContain("EXPOSE 10000");
    expect(joined).toContain("CMD node");
    expect(joined).toContain("RUN npm ci");
  });

  it("builds a signature string that embeds cleanly", () => {
    const sig = extractSignature("Dockerfile", dockerfile);
    expect(sig.componentName).toBe("Dockerfile");
    expect(sig.signature).toContain("path:Dockerfile");
    expect(sig.signature).toContain("EXPOSE 10000");
  });

  it("handles multi-stage builds without losing the last stage", () => {
    const sig = extractSignature("deploy/Dockerfile.prod", dockerfile);
    expect(sig.exportedSymbols.join(" ")).toContain("runtime");
  });
});

describe("Makefile signatures are useful", () => {
  const makefile = [
    "NODE_ENV ?= production",
    "",
    ".PHONY: build",
    "build:",
    "\tnpm run build",
    "",
    "deploy:",
    "\tgit push origin main",
    "",
    "test:"
  ].join("\n");

  it("captures targets", () => {
    const sig = extractSignature("Makefile", makefile);
    expect(sig.exportedSymbols).toContain("build");
    expect(sig.exportedSymbols).toContain("deploy");
    expect(sig.exportedSymbols).toContain("test");
    // `.PHONY` is a target too, but noise — real targets are what matter.
    expect(sig.componentName).toBe("Makefile");
  });
});

describe("dotfiles describe toolchain without inventing symbols", () => {
  it("reads the runtime version as description context", () => {
    const sig = extractSignature(".nvmrc", "22\n");
    expect(sig.componentName).toBe(".nvmrc");
    expect(sig.exportedSymbols).toEqual([]);
    expect(sig.signature).toContain("path:.nvmrc");
  });
});
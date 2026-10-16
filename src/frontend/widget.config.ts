import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// The embeddable widget is built as a dependency-free IIFE so host pages load
// a single small script tag with no framework runtime attached.
export default defineConfig({
  root,
  build: {
    outDir: "dist-widget",
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    lib: {
      entry: path.resolve(root, "src/widget/main.ts"),
      name: "GitVoiceWidget",
      formats: ["iife"],
      fileName: () => "widget.js"
    }
  }
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:10000",
      "/health": "http://localhost:10000"
    }
  }
});

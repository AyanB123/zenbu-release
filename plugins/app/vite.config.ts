import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
// @vitejs/plugin-react-swc replaces the default plugin's babel HMR
// pass with SWC (Rust). On a cold boot the babel pass is one of the
// dominant CPU-blocking transforms — every .tsx file goes through it.
// SWC parses ~20× faster and offloads to a thread pool, so it doesn't
// pin the main event loop.
import react from "@vitejs/plugin-react-swc"
import tailwindcss from "@tailwindcss/vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(__dirname, "src", "renderer"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src", "renderer"),
    },
  },
  // Cold boot: serving allotment via Vite's on-demand dep pre-bundling
  // costs ~1100ms on first request because esbuild bundles its (large)
  // dependency graph synchronously inside the request handler, stalling
  // the iframe's load. Adding it to `optimizeDeps.include` makes Vite
  // bundle it during `optimizeDeps` (overlapping with the rest of cold
  // startup) and serve a single cached chunk on first request.
  optimizeDeps: {
    include: [
      "allotment",
      // react-scan is loaded via dynamic import after first paint (see
      // main.tsx). Keeping it OUT of `include` means Vite won't bundle it
      // during the cold optimizeDeps pass that gates `loadURL`.
    ],
  },
})

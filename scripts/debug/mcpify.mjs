#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const configPath = path.join(repoRoot, "mcp", "zenbu-debug.mcpify.json");
const mode = process.argv[2] ?? "serve";
const port = process.argv[3] ?? "8787";
const python = process.env.PYTHON ?? "C:\\Program Files\\Python312\\python.exe";

const args = ["-m", "mcpify"];
if (mode === "serve") {
  args.push("serve", configPath);
} else if (mode === "serve-http") {
  args.push("serve", configPath, "--mode", "streamable-http", "--port", port);
} else if (mode === "validate") {
  args.push("validate", configPath, "--verbose");
} else {
  console.error(`Unknown mode: ${mode}`);
  process.exit(2);
}

const child = spawn(python, args, {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
  },
});

child.on("error", (error) => {
  console.error(`[zenbu-debug-mcpify] failed to start ${python}:`, error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

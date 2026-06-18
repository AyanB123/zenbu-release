#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

if (process.platform !== "darwin" || process.arch !== "x64") {
  console.error(
    "build:mac:intel must run on an Intel macOS host or Intel macOS VM. " +
      `Current host is ${process.platform}/${process.arch}.`,
  );
  console.error(
    "Do not cross-build this target from Apple Silicon: the Zenbu launcher " +
      "bundles the host-architecture Bun toolchain.",
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const corePackagePath = require.resolve("@zenbujs/core/package.json");
const zenBin = path.join(path.dirname(corePackagePath), "dist", "cli", "bin.mjs");
const extraArgs = process.argv.slice(2);

const child = spawn(
  process.execPath,
  [zenBin, "build:electron", "--", "--mac", "--x64", ...extraArgs],
  { stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`build:mac:intel terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

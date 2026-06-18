import path from "node:path";
import { pathToFileURL } from "node:url";

const cliPath = path.resolve("node_modules", "@zenbujs", "core", "dist", "cli", "bin.mjs");

process.argv = [process.argv[0], cliPath, "dev", ...process.argv.slice(2)];
await import(pathToFileURL(cliPath).href);

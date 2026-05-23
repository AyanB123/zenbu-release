import { createSchema, z } from "@zenbujs/core/db";

const diagnostic = z.object({
  filePath: z.string(),
  plugin: z.string(),
  rule: z.string(),
  severity: z.string(),
  message: z.string(),
  help: z.string().default(""),
  line: z.number(),
  column: z.number(),
  category: z.string(),
});

const projectReport = z.object({
  directory: z.string(),
  projectName: z.string().nullable(),
  reactVersion: z.string().nullable(),
  framework: z.string().nullable(),
  sourceFileCount: z.number(),
  diagnostics: z.array(diagnostic),
});

const report = z.object({
  version: z.string(),
  mode: z.string(),
  score: z.number().nullable(),
  scoreLabel: z.string().nullable(),
  errorCount: z.number(),
  warningCount: z.number(),
  affectedFileCount: z.number(),
  totalDiagnosticCount: z.number(),
  elapsedMs: z.number(),
  projects: z.array(projectReport),
  generatedAt: z.number(),
});

const indexStatus = z.enum(["idle", "scanning", "error"]);

/**
 * Per-scope react-doctor index. Mirrors the shape of
 * `root.app.fileTreeIndexes`: keep the last good `report` while a new
 * scan is in flight so the sidebar stays useful, then swap atomically
 * when the new run lands.
 */
const reactDoctorIndex = z.object({
  scopeId: z.string(),
  directory: z.string(),
  status: indexStatus,
  error: z.string().nullable(),
  report: report.nullable(),
});

export default createSchema({
  indexes: z.record(z.string(), reactDoctorIndex).default({}),
});

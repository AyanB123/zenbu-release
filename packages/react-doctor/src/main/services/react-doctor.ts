import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import {
  DbService,
  RendererHostService,
  ViewRegistryService,
} from "@zenbujs/core/services";

const here = path.dirname(fileURLToPath(import.meta.url));
const SIDEBAR_VIEW_ROOT = path.resolve(here, "../../views/react-doctor-sidebar");
const SIDEBAR_VIEW_CONFIG = path.resolve(SIDEBAR_VIEW_ROOT, "vite.config.ts");

const require_ = createRequire(import.meta.url);

/** Locate the bundled `react-doctor` CLI inside this plugin's
 * `node_modules`. We pin it as a regular dep so we don't pay the
 * `npx --yes` resolve+download tax on every fresh scan.
 *
 * react-doctor's `exports` map intentionally doesn't expose
 * `./package.json` (Node 22 strict ESM), so we can't read its `bin`
 * field through `require`. Luckily its main entry *is* the CLI
 * (`dist/cli.js`), so `require.resolve("react-doctor")` lands
 * exactly where we want to spawn from. */
function locateReactDoctorBin(): string {
  return require_.resolve("react-doctor");
}

type RawDiagnostic = {
  filePath?: string;
  plugin?: string;
  rule?: string;
  severity?: string;
  message?: string;
  help?: string;
  line?: number;
  column?: number;
  category?: string;
};

type RawProject = {
  directory?: string;
  project?: {
    projectName?: string | null;
    reactVersion?: string | null;
    framework?: string | null;
    sourceFileCount?: number;
  };
  diagnostics?: RawDiagnostic[];
};

type RawReport = {
  ok: boolean;
  version?: string;
  mode?: string;
  projects?: RawProject[];
  summary?: {
    errorCount?: number;
    warningCount?: number;
    affectedFileCount?: number;
    totalDiagnosticCount?: number;
    score?: number | null;
    scoreLabel?: string | null;
  };
  elapsedMilliseconds?: number;
  error?: string | null;
};

/**
 * Maintains a per-scope `react-doctor` index in
 * `root.reactDoctor.indexes` and registers the sidebar view.
 *
 *  - On every new scope (or directory change), kicks off a scan in
 *    the background. The index entry lands in "scanning" state
 *    immediately so the sidebar can paint a spinner while the CLI
 *    runs, and the previous good report (if any) stays visible.
 *  - Exposes `rescan({ scopeId })` so the sidebar's button can ask
 *    for a fresh run without going through the scope subscription.
 *  - Orphan indexes (scopes that got archived/removed) are pruned
 *    on every reconcile so the DB never grows unbounded.
 */
export class ReactDoctorService extends Service.create({
  key: "reactDoctor",
  deps: {
    viewRegistry: ViewRegistryService,
    db: DbService,
    // Order-only: registering the view needs the renderer host alive.
    rendererHost: RendererHostService,
  },
}) {
  /** Scope ids with an in-flight scan. Prevents re-entrancy if
   * `scopes` fires twice in quick succession. */
  private scanning = new Set<string>();
  /** Auto-scan happens at most once per (scopeId, directory) pair so
   * we don't re-scan unprompted on every hot reload. The user's
   * "Rescan" button is the explicit refresh path. */
  private autoScanned = new Set<string>();

  evaluate() {
    this.setup("register-sidebar-view", () => {
      void this.ctx.viewRegistry.register({
        type: "react-doctor-sidebar",
        root: SIDEBAR_VIEW_ROOT,
        configFile: SIDEBAR_VIEW_CONFIG,
        meta: {
          kind: "view",
          sidebar: true,
          label: "React Doctor",
        },
      });
      return () => {
        void this.ctx.viewRegistry.unregister("react-doctor-sidebar");
      };
    });

    this.setup("reconcile-scopes", () => {
      this.reconcile();
      const unsub = this.ctx.db.client.app.scopes.subscribe(() => {
        this.reconcile();
      });
      return unsub;
    });
  }

  /** Called by the sidebar's "Rescan" button. */
  async rescan(args: { scopeId: string }): Promise<{ ok: true }> {
    const scope = this.ctx.db.client.readRoot().app.scopes[args.scopeId];
    if (!scope) throw new Error(`unknown scope: ${args.scopeId}`);
    await this.scanScope(scope.id, scope.directory);
    return { ok: true };
  }

  private reconcile(): void {
    const root = this.ctx.db.client.readRoot();
    const scopes = root.app.scopes;
    const indexes = root.reactDoctor.indexes;

    for (const scope of Object.values(scopes)) {
      const key = `${scope.id}::${scope.directory}`;
      if (this.autoScanned.has(key)) continue;
      const existing = indexes[scope.id];
      if (existing && existing.directory === scope.directory && existing.report) {
        // Already have a report from a previous boot — don't auto-rescan,
        // just mark it so we don't re-enter.
        this.autoScanned.add(key);
        continue;
      }
      this.autoScanned.add(key);
      void this.scanScope(scope.id, scope.directory);
    }

    // Prune orphan indexes whose scope is gone.
    const liveIds = new Set(Object.keys(scopes));
    const orphaned = Object.keys(indexes).filter((id) => !liveIds.has(id));
    if (orphaned.length > 0) {
      void this.ctx.db.client.update((r) => {
        for (const id of orphaned) delete r.reactDoctor.indexes[id];
      });
    }
  }

  private async scanScope(scopeId: string, directory: string): Promise<void> {
    if (this.scanning.has(scopeId)) return;
    this.scanning.add(scopeId);

    // Land "scanning" in the DB immediately so the sidebar paints a
    // spinner without waiting for the CLI to spawn.
    await this.ctx.db.client.update((root) => {
      const prev = root.reactDoctor.indexes[scopeId];
      root.reactDoctor.indexes[scopeId] = {
        scopeId,
        directory,
        status: "scanning",
        error: null,
        report: prev?.directory === directory ? (prev.report ?? null) : null,
      };
    });

    try {
      const raw = await this.runReactDoctor(directory);
      const report = normalizeReport(raw);
      await this.ctx.db.client.update((root) => {
        root.reactDoctor.indexes[scopeId] = {
          scopeId,
          directory,
          status: "idle",
          error: null,
          report,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.ctx.db.client.update((root) => {
        const prev = root.reactDoctor.indexes[scopeId];
        root.reactDoctor.indexes[scopeId] = {
          scopeId,
          directory,
          status: "error",
          error: message,
          report: prev?.report ?? null,
        };
      });
    } finally {
      this.scanning.delete(scopeId);
    }
  }

  private runReactDoctor(directory: string): Promise<RawReport> {
    return new Promise((resolve, reject) => {
      let bin: string;
      try {
        bin = locateReactDoctorBin();
      } catch (err) {
        reject(err);
        return;
      }

      const args = [bin, "--json", "--fail-on", "none", "-y", directory];
      // We deliberately avoid `process.execPath` + `ELECTRON_RUN_AS_NODE`
      // here: commander auto-detects Electron via `process.versions.electron`
      // (which stays set even in run-as-node mode) and then slices argv
      // differently, swallowing the script path as a positional arg and
      // tripping `error: too many arguments. Expected 1 argument but got 2.`
      // Using a real `node` binary side-steps that detection entirely.
      const child = spawn("node", args, {
        cwd: directory,
        env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (b: Buffer) => {
        stdout += b.toString("utf8");
      });
      child.stderr.on("data", (b: Buffer) => {
        stderr += b.toString("utf8");
      });

      child.on("error", reject);
      child.on("close", (code) => {
        // react-doctor still emits its JSON payload even when it
        // exits non-zero (e.g. `fail-on warning` was triggered) so
        // we always try to parse stdout first; only surface spawn /
        // parse failures as errors.
        void code;
        const trimmed = stdout.trim();
        // Surface non-zero exits with no usable output as the spawn
        // error (e.g. `node` not on PATH, react-doctor crash before
        // first JSON byte).
        // Successful runs still pass through the JSON-parse path below.
        // No-op if `trimmed` is empty — the existing branch handles it.
        if (!trimmed) {
          reject(
            new Error(
              `react-doctor produced no output${stderr ? `: ${stderr.trim()}` : ""}`,
            ),
          );
          return;
        }
        try {
          const parsed = JSON.parse(trimmed) as RawReport;
          if (parsed.ok === false && parsed.error) {
            reject(new Error(parsed.error));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(
            new Error(
              `failed to parse react-doctor output: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
        }
      });
    });
  }
}

function normalizeReport(raw: RawReport) {
  const summary = raw.summary ?? {};
  const projects = (raw.projects ?? []).map((p) => ({
    directory: p.directory ?? "",
    projectName: p.project?.projectName ?? null,
    reactVersion: p.project?.reactVersion ?? null,
    framework: p.project?.framework ?? null,
    sourceFileCount: p.project?.sourceFileCount ?? 0,
    diagnostics: (p.diagnostics ?? []).map((d) => ({
      filePath: d.filePath ?? "",
      plugin: d.plugin ?? "react-doctor",
      rule: d.rule ?? "",
      severity: d.severity ?? "warning",
      message: d.message ?? "",
      help: d.help ?? "",
      line: typeof d.line === "number" ? d.line : 0,
      column: typeof d.column === "number" ? d.column : 0,
      category: d.category ?? "Other",
    })),
  }));
  return {
    version: raw.version ?? "",
    mode: raw.mode ?? "full",
    score: summary.score ?? null,
    scoreLabel: summary.scoreLabel ?? null,
    errorCount: summary.errorCount ?? 0,
    warningCount: summary.warningCount ?? 0,
    affectedFileCount: summary.affectedFileCount ?? 0,
    totalDiagnosticCount: summary.totalDiagnosticCount ?? 0,
    elapsedMs: raw.elapsedMilliseconds ?? 0,
    projects,
    generatedAt: Date.now(),
  };
}

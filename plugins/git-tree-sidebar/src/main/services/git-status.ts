import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Service } from "@zenbujs/core/runtime";
import { DbService } from "@zenbujs/core/services";

const execFileP = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

type StatusRow = {
  scopeId: string;
  directory: string;
  isRepo: boolean;
  files: { path: string; code: string; untracked: boolean }[];
  status: "polling" | "idle" | "error";
  error: string | null;
  updatedAt: number;
};

/**
 * On-demand git status cache for the sidebar.
 *
 * Writes minimal working-tree snapshots into
 * `root.gitTreeSidebar.statuses[scopeId]`. The view reads the replica
 * synchronously and calls `refresh({ scopeId })` when it mounts or the
 * active scope changes — no background polling.
 */
export class GitStatusService extends Service.create({
  key: "gitStatus",
  deps: { db: DbService },
}) {
  private inflight = new Map<string, Promise<void>>();

  evaluate() {
    this.setup("purge-orphans", () => {
      void this.purgeOrphans();
      const unsub = this.ctx.db.client.app.scopes.subscribe(() => {
        void this.purgeOrphans();
      });
      return () => unsub();
    });
  }

  /** Refresh the cached status for one scope. Coalesces concurrent
   * calls for the same scopeId. Skips the DB write when the parsed
   * snapshot is unchanged. */
  async refresh(args: { scopeId: string }): Promise<{ ok: true }> {
    const scope =
      this.ctx.db.client.readRoot().app.scopes[args.scopeId];
    if (!scope) throw new Error(`unknown scope: ${args.scopeId}`);

    const existing = this.inflight.get(args.scopeId);
    if (existing) {
      await existing;
      return { ok: true };
    }

    const job = this.refreshScope(args.scopeId, scope.directory);
    this.inflight.set(args.scopeId, job);
    try {
      await job;
    } finally {
      this.inflight.delete(args.scopeId);
    }
    return { ok: true };
  }

  private async refreshScope(
    scopeId: string,
    directory: string,
  ): Promise<void> {
    try {
      const snapshot = await runStatus(directory);
      const prev =
        this.ctx.db.client.readRoot().gitTreeSidebar.statuses[scopeId];
      const next: StatusRow = {
        scopeId,
        directory,
        isRepo: snapshot.isRepo,
        files: snapshot.files,
        status: "idle",
        error: null,
        updatedAt: Date.now(),
      };
      if (prev && statusRowsEqual(prev, next)) return;
      await this.ctx.db.client.update((root) => {
        root.gitTreeSidebar.statuses[scopeId] = next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const prev =
        this.ctx.db.client.readRoot().gitTreeSidebar.statuses[scopeId];
      const next: StatusRow = {
        scopeId,
        directory,
        isRepo: prev?.isRepo ?? false,
        files: prev?.files ?? [],
        status: "error",
        error: message,
        updatedAt: prev?.updatedAt ?? 0,
      };
      if (prev && statusRowsEqual(prev, next)) return;
      await this.ctx.db.client.update((root) => {
        root.gitTreeSidebar.statuses[scopeId] = next;
      });
    }
  }

  private async purgeOrphans(): Promise<void> {
    const root = this.ctx.db.client.readRoot();
    const liveIds = new Set(Object.keys(root.app.scopes));
    const orphaned = Object.keys(root.gitTreeSidebar.statuses).filter(
      (id) => !liveIds.has(id),
    );
    if (orphaned.length === 0) return;
    await this.ctx.db.client.update((r) => {
      for (const id of orphaned) delete r.gitTreeSidebar.statuses[id];
    });
  }
}

function statusRowsEqual(a: StatusRow, b: StatusRow): boolean {
  if (
    a.scopeId !== b.scopeId ||
    a.directory !== b.directory ||
    a.isRepo !== b.isRepo ||
    a.status !== b.status ||
    a.error !== b.error ||
    a.updatedAt !== b.updatedAt ||
    a.files.length !== b.files.length
  ) {
    return false;
  }
  for (let i = 0; i < a.files.length; i++) {
    const af = a.files[i]!;
    const bf = b.files[i]!;
    if (af.path !== bf.path || af.code !== bf.code || af.untracked !== bf.untracked) {
      return false;
    }
  }
  return true;
}

/* --------------------------- git, minimal --------------------------- */

type StatusSnapshot = {
  isRepo: boolean;
  files: { path: string; code: string; untracked: boolean }[];
};

async function runStatus(directory: string): Promise<StatusSnapshot> {
  if (!directory) return { isRepo: false, files: [] };
  const out = await runGit(
    ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"],
    directory,
  );
  if (out == null) return { isRepo: false, files: [] };
  return { isRepo: true, files: parsePorcelain(out) };
}

async function runGit(argv: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", argv, {
      cwd,
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    if (e.stdout != null) return e.stdout;
    return null;
  }
}

function parsePorcelain(
  raw: string,
): { path: string; code: string; untracked: boolean }[] {
  const files: { path: string; code: string; untracked: boolean }[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "#" && raw[i + 1] === "#") {
      const nul = raw.indexOf("\0", i);
      const nl = raw.indexOf("\n", i);
      const candidates = [nul, nl].filter((x) => x !== -1);
      const end =
        candidates.length === 0 ? raw.length : Math.min(...candidates);
      i = end >= raw.length ? raw.length : end + 1;
      continue;
    }
    if (i + 3 > raw.length) break;
    const code = raw.slice(i, i + 2);
    const indexStatus = code[0];
    const nul = raw.indexOf("\0", i + 3);
    if (nul === -1) break;
    const newPath = raw.slice(i + 3, nul);
    let next = nul + 1;
    if (indexStatus === "R" || indexStatus === "C") {
      const oldNul = raw.indexOf("\0", next);
      if (oldNul === -1) break;
      next = oldNul + 1;
    }
    const untracked = code === "??";
    const ignored = code === "!!";
    if (!ignored) {
      files.push({ path: newPath, code, untracked });
    }
    i = next;
  }
  return files;
}

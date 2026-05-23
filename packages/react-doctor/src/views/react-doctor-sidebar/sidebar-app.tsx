import { useMemo, useState } from "react";
import { useDb, useRpc } from "@zenbujs/core/react";

/**
 * React Doctor sidebar.
 *
 * Reads `root.reactDoctor.indexes` for the current scope and renders
 * the score, a per-category histogram, and a collapsible list of
 * files with their diagnostics. Clicking a file (or a diagnostic
 * row) opens the file in the active pane via the host's
 * `fileTree.openFile` RPC — same path the file-tree sidebar uses.
 */

type Severity = "error" | "warning" | "info";

type Diagnostic = {
  filePath: string;
  plugin: string;
  rule: string;
  severity: string;
  message: string;
  help: string;
  line: number;
  column: number;
  category: string;
};

export function SidebarApp() {
  const active = useActiveScope();

  if (!active) {
    return <Empty>No active workspace.</Empty>;
  }

  return <SidebarForScope key={active.scopeId} scope={active} />;
}

function SidebarForScope({
  scope,
}: {
  scope: { scopeId: string; directory: string };
}) {
  const index = useDb((root) => root.reactDoctor.indexes[scope.scopeId]);
  const rpc = useRpc();

  const handleRescan = () => {
    void rpc.reactDoctor.reactDoctor
      .rescan({ scopeId: scope.scopeId })
      .catch((err: unknown) =>
        console.error("[react-doctor] rescan failed:", err),
      );
  };

  const handleOpen = (filePath: string) => {
    void rpc.app.fileTree
      .openFile({ directory: scope.directory, path: filePath })
      .catch((err: unknown) =>
        console.error("[react-doctor] openFile failed:", err),
      );
  };

  const status = index?.status ?? "idle";
  const report = index?.report ?? null;
  const error = index?.error ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <Header
        report={report}
        status={status}
        onRescan={handleRescan}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {error && status === "error" && (
          <div className="mx-3 my-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
            {error}
          </div>
        )}
        {!report && status === "scanning" && (
          <Empty>Scanning…</Empty>
        )}
        {!report && status !== "scanning" && !error && (
          <Empty>
            <div className="flex flex-col items-center gap-2">
              <div>No scan yet.</div>
              <button
                onClick={handleRescan}
                className="rounded-md border bg-card px-2 py-1 text-[11px] hover:bg-accent hover:text-accent-foreground"
              >
                Run scan
              </button>
            </div>
          </Empty>
        )}
        {report && (
          <ReportBody report={report} onOpen={handleOpen} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Header ------------------------------- */

function Header({
  report,
  status,
  onRescan,
}: {
  report: {
    score: number | null;
    scoreLabel: string | null;
    errorCount: number;
    warningCount: number;
    affectedFileCount: number;
    elapsedMs: number;
    generatedAt: number;
  } | null;
  status: "idle" | "scanning" | "error";
  onRescan: () => void;
}) {
  const score = report?.score ?? null;
  const scoreLabel = report?.scoreLabel ?? null;
  const tone = scoreTone(score);

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-md border ${tone.bg} ${tone.border}`}
          >
            <span className={`text-[18px] font-semibold tabular-nums ${tone.fg}`}>
              {score == null ? "—" : score}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className={`text-[12px] font-medium ${tone.fg}`}>
              {scoreLabel ?? "Not scanned"}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {report
                ? `${formatElapsed(report.elapsedMs)} · ${formatTime(report.generatedAt)}`
                : "Click rescan to start"}
            </div>
          </div>
        </div>
        <button
          onClick={onRescan}
          disabled={status === "scanning"}
          className="flex h-6 items-center gap-1 rounded-md border bg-card px-2 text-[11px] text-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
          title="Re-run react-doctor"
        >
          {status === "scanning" ? (
            <Spinner />
          ) : (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          )}
          <span>{status === "scanning" ? "Scanning" : "Rescan"}</span>
        </button>
      </div>
      {report && (
        <div className="flex items-center gap-1.5">
          <Chip
            tone="destructive"
            value={report.errorCount}
            label="errors"
          />
          <Chip
            tone="warning"
            value={report.warningCount}
            label="warnings"
          />
          <Chip
            tone="muted"
            value={report.affectedFileCount}
            label="files"
          />
        </div>
      )}
    </div>
  );
}

function Chip({
  tone,
  value,
  label,
}: {
  tone: "destructive" | "warning" | "muted";
  value: number;
  label: string;
}) {
  const cls =
    tone === "destructive"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-border bg-muted text-muted-foreground";
  return (
    <div
      className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${cls}`}
    >
      <span className="font-semibold tabular-nums">{value}</span>
      <span>{label}</span>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className="animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------------------- Report body ---------------------------- */

function ReportBody({
  report,
  onOpen,
}: {
  report: {
    projects: {
      directory: string;
      projectName: string | null;
      framework: string | null;
      reactVersion: string | null;
      sourceFileCount: number;
      diagnostics: Diagnostic[];
    }[];
  };
  onOpen: (filePath: string) => void;
}) {
  const allDiagnostics = useMemo(
    () => report.projects.flatMap((p) => p.diagnostics),
    [report.projects],
  );

  if (allDiagnostics.length === 0) {
    return (
      <Empty>
        <div className="flex flex-col items-center gap-1">
          <div className="text-emerald-500">✓</div>
          <div>No issues found.</div>
        </div>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col">
      <CategoryBreakdown diagnostics={allDiagnostics} />
      <div className="border-t" />
      {report.projects
        .filter((p) => p.diagnostics.length > 0)
        .map((p) => (
          <ProjectSection
            key={p.directory}
            project={p}
            multiple={report.projects.length > 1}
            onOpen={onOpen}
          />
        ))}
    </div>
  );
}

function CategoryBreakdown({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const buckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of diagnostics) {
      counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [diagnostics]);

  const max = buckets[0]?.[1] ?? 1;

  return (
    <div className="flex flex-col gap-1 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Categories
      </div>
      <div className="flex flex-col gap-1">
        {buckets.map(([name, count]) => (
          <div key={name} className="flex items-center gap-2">
            <div className="w-28 truncate text-[11px]">{name}</div>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-foreground/40"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <div className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
              {count}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectSection({
  project,
  multiple,
  onOpen,
}: {
  project: {
    directory: string;
    projectName: string | null;
    framework: string | null;
    reactVersion: string | null;
    diagnostics: Diagnostic[];
  };
  multiple: boolean;
  onOpen: (filePath: string) => void;
}) {
  const fileGroups = useMemo(() => {
    const map = new Map<string, Diagnostic[]>();
    for (const d of project.diagnostics) {
      const arr = map.get(d.filePath);
      if (arr) arr.push(d);
      else map.set(d.filePath, [d]);
    }
    return Array.from(map.entries())
      .map(([filePath, diags]) => ({
        filePath,
        diags: diags.sort((a, b) => a.line - b.line),
      }))
      .sort((a, b) => {
        // Sort errors first, then most diagnostics, then path.
        const aErr = a.diags.some((d) => d.severity === "error") ? 1 : 0;
        const bErr = b.diags.some((d) => d.severity === "error") ? 1 : 0;
        if (aErr !== bErr) return bErr - aErr;
        if (a.diags.length !== b.diags.length) {
          return b.diags.length - a.diags.length;
        }
        return a.filePath.localeCompare(b.filePath);
      });
  }, [project.diagnostics]);

  return (
    <div className="flex flex-col">
      {multiple && (
        <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b bg-background/95 px-3 py-1.5 backdrop-blur">
          <div className="truncate text-[11px] font-medium">
            {project.projectName ?? project.directory}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {[project.framework, project.reactVersion]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      )}
      {fileGroups.map((g) => (
        <FileRow
          key={`${project.directory}::${g.filePath}`}
          directory={project.directory}
          filePath={g.filePath}
          diags={g.diags}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function FileRow({
  filePath,
  diags,
  onOpen,
}: {
  directory: string;
  filePath: string;
  diags: Diagnostic[];
  onOpen: (filePath: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const errorCount = diags.filter((d) => d.severity === "error").length;
  const warningCount = diags.length - errorCount;

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-accent/30"
      >
        <Chevron open={open} />
        <span className="truncate text-[11px] font-mono">
          {shortenPath(filePath)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {errorCount > 0 && (
            <span className="rounded-sm bg-destructive/15 px-1 text-[9px] font-semibold tabular-nums text-destructive">
              {errorCount}
            </span>
          )}
          {warningCount > 0 && (
            <span className="rounded-sm bg-amber-500/15 px-1 text-[9px] font-semibold tabular-nums text-amber-600 dark:text-amber-400">
              {warningCount}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="flex flex-col">
          {diags.map((d, i) => (
            <DiagnosticRow
              key={`${d.rule}-${d.line}-${d.column}-${i}`}
              d={d}
              onOpen={() => onOpen(filePath)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticRow({
  d,
  onOpen,
}: {
  d: Diagnostic;
  onOpen: () => void;
}) {
  const isError = d.severity === "error";
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-start gap-2 border-t border-border/40 px-3 py-1.5 text-left hover:bg-accent/40"
    >
      <SeverityDot severity={d.severity as Severity} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-1.5">
          <span
            className={`truncate font-mono text-[10px] ${
              isError ? "text-destructive" : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {d.rule || d.plugin}
          </span>
          {d.line > 0 && (
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
              L{d.line}
            </span>
          )}
        </div>
        <div className="text-[11px] leading-snug text-foreground/90">
          {d.message}
        </div>
      </div>
    </button>
  );
}

function SeverityDot({ severity }: { severity: Severity }) {
  const cls =
    severity === "error"
      ? "bg-destructive"
      : severity === "info"
        ? "bg-sky-500"
        : "bg-amber-500";
  return (
    <span
      className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${cls}`}
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 120ms ease",
        opacity: 0.6,
      }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

/* ------------------------------ helpers ------------------------------ */

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-muted-foreground">
      {children}
    </div>
  );
}

function useActiveScope(): { scopeId: string; directory: string } | null {
  return useDb((root) => {
    const states = Object.values(root.app.windowStates);
    const scopeId =
      states.find((s) => s.selectedScopeId != null)?.selectedScopeId ?? null;
    if (!scopeId) return null;
    const scope = root.app.scopes[scopeId];
    if (!scope) return null;
    return { scopeId: scope.id, directory: scope.directory };
  });
}

function scoreTone(score: number | null): {
  bg: string;
  fg: string;
  border: string;
} {
  if (score == null) {
    return {
      bg: "bg-muted",
      fg: "text-muted-foreground",
      border: "border-border",
    };
  }
  if (score >= 75) {
    return {
      bg: "bg-emerald-500/10",
      fg: "text-emerald-600 dark:text-emerald-400",
      border: "border-emerald-500/30",
    };
  }
  if (score >= 50) {
    return {
      bg: "bg-amber-500/10",
      fg: "text-amber-600 dark:text-amber-400",
      border: "border-amber-500/30",
    };
  }
  return {
    bg: "bg-destructive/10",
    fg: "text-destructive",
    border: "border-destructive/30",
  };
}

function shortenPath(p: string): string {
  // Keep the last 2 segments verbatim, ellipsize the middle if long.
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

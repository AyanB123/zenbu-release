import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircleIcon,
  ChevronRightIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { useUpdater } from "@zenbujs/core/react";
import { Button } from "@zenbu/ui/button";
import { cn } from "@zenbu/ui/utils";

type PluginRepoRef = {
  path: string;
  displayName: string;
  kind: "core" | "external";
  plugins: { name: string; dir: string }[];
  lockfile: string | null;
  branch: string | null;
  remote: string | null;
  remoteUrl: string | null;
  head: string | null;
};

type UpdateCheck =
  | { kind: "up-to-date"; repo: PluginRepoRef }
  | {
      kind: "available";
      repo: PluginRepoRef;
      target: string;
      remoteRef: string;
      behind: number;
      ahead: number;
      canFastForward: boolean;
      conflicts: string[];
      dirtyFiles: string[];
      dependenciesChanged: boolean;
      lockfile: string | null;
    }
  | { kind: "error"; repo: PluginRepoRef; message: string };

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ready"; result: UpdateCheck }
  | { status: "error"; message: string };

/**
 * Resolve the user-visible label for a repo card.
 *
 * - A single-plugin repo is conceptually "the plugin" \u2014 the repo
 *   directory and the plugin tend to share a name, and surfacing the
 *   distinction in the UI just adds noise (the user already thinks of
 *   it as "the plugin").
 * - A multi-plugin repo (today: only `core`) is its own thing; we keep
 *   the repo's `displayName` and let the user expand to see members.
 */
function repoLabel(repo: PluginRepoRef): string {
  if (repo.plugins.length === 1) return repo.plugins[0]!.name;
  return repo.displayName;
}

function hasBlockingIssue(result: UpdateCheck | null): boolean {
  if (!result || result.kind !== "available") return false;
  return !result.canFastForward || result.conflicts.length > 0;
}

export default function UpdatesPanel() {
  const updater = useUpdater();
  const [repos, setRepos] = useState<PluginRepoRef[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});

  useEffect(() => {
    let cancelled = false;
    setLoadingRepos(true);
    void updater.listRepos()
      .then((next) => {
        if (cancelled) return;
        const typed = next as PluginRepoRef[];
        setRepos(typed);
        setChecks((prev) => {
          const out: Record<string, CheckState> = {};
          for (const repo of typed) {
            out[repo.path] = prev[repo.path] ?? { status: "idle" };
          }
          return out;
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingRepos(false);
      });
    return () => {
      cancelled = true;
    };
  }, [updater]);

  const checkRepo = useCallback(
    async (repo: PluginRepoRef) => {
      setChecks((prev) => ({ ...prev, [repo.path]: { status: "checking" } }));
      try {
        const result = (await updater.checkRepo({ path: repo.path })) as UpdateCheck;
        setChecks((prev) => ({ ...prev, [repo.path]: { status: "ready", result } }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setChecks((prev) => ({ ...prev, [repo.path]: { status: "error", message } }));
      }
    },
    [updater],
  );

  const checkAll = useCallback(async () => {
    await Promise.all(repos.map((repo) => checkRepo(repo)));
  }, [repos, checkRepo]);

  return (
    <div className="flex min-h-full flex-col gap-4 pb-6">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-foreground">Updates</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loadingRepos || repos.length === 0}
          onClick={() => void checkAll()}
          className="gap-2"
        >
          <RefreshCwIcon className="size-3.5" />
          Check all
        </Button>
      </header>

      {loadingRepos ? (
        <div className="rounded-md border border-border p-4 text-[12px] text-muted-foreground">
          Loading…
        </div>
      ) : repos.length === 0 ? (
        <div className="rounded-md border border-border p-4 text-[12px] text-muted-foreground">
          No updateable plugin repos were found.
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-md border border-border">
          {repos.map((repo) => (
            <RepoRow
              key={repo.path}
              repo={repo}
              state={checks[repo.path] ?? { status: "idle" }}
              onCheck={() => void checkRepo(repo)}
              onApply={() => void updater.applyRepo({ path: repo.path })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RepoRow({
  repo,
  state,
  onCheck,
  onApply,
}: {
  repo: PluginRepoRef;
  state: CheckState;
  onCheck: () => void;
  onApply: () => void;
}) {
  const isMulti = repo.plugins.length > 1;
  // Auto-collapse multi-plugin rows. The list of contained plugins is
  // disclosure-on-demand because it's almost always implementation
  // detail (a user clicking "Check" for "Core plugins" doesn't need
  // to scan thirty plugin names to act).
  const [expanded, setExpanded] = useState(false);

  const result = state.status === "ready" ? state.result : null;
  const available = result?.kind === "available" ? result : null;
  const blocked = hasBlockingIssue(result);
  const showApply = !!available && !blocked;
  const errorMessage =
    state.status === "error"
      ? state.message
      : result?.kind === "error"
        ? result.message
        : blocked && available
          ? buildBlockedMessage(available)
          : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={isMulti ? () => setExpanded((v) => !v) : undefined}
          // Multi-plugin rows are clickable to expand; single-plugin rows
          // aren't interactive on the label \u2014 the only action is the
          // button on the right.
          disabled={!isMulti}
          className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {isMulti ? (
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
          ) : null}
          <span className="truncate text-[13px] font-medium text-foreground">
            {repoLabel(repo)}
          </span>
        </button>
        <RowAction
          state={state}
          showApply={showApply}
          onCheck={onCheck}
          onApply={onApply}
        />
      </div>

      {isMulti && expanded ? (
        <ul className="ml-7 mb-2 flex flex-col gap-0.5 text-[12px] text-muted-foreground">
          {repo.plugins.map((p) => (
            <li key={p.name} className="truncate">
              {p.name}
            </li>
          ))}
        </ul>
      ) : null}

      {errorMessage ? (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-all">{errorMessage}</span>
        </div>
      ) : null}
    </div>
  );
}

function RowAction({
  state,
  showApply,
  onCheck,
  onApply,
}: {
  state: CheckState;
  showApply: boolean;
  onCheck: () => void;
  onApply: () => void;
}) {
  if (state.status === "checking") {
    return (
      <Button type="button" size="sm" variant="outline" disabled className="gap-2">
        <Loader2Icon className="size-3.5 animate-spin" />
        Checking…
      </Button>
    );
  }
  if (showApply) {
    return (
      <Button type="button" size="sm" onClick={onApply}>
        Restart to update
      </Button>
    );
  }
  return (
    <Button type="button" size="sm" variant="outline" onClick={onCheck}>
      Check
    </Button>
  );
}

function buildBlockedMessage(result: Extract<UpdateCheck, { kind: "available" }>): string {
  const parts: string[] = [];
  if (result.dirtyFiles.length > 0) {
    parts.push(`Local changes: ${result.dirtyFiles.join(", ")}`);
  }
  if (result.conflicts.length > 0) {
    parts.push(`Conflicts: ${result.conflicts.join(", ")}`);
  }
  if (parts.length === 0) {
    parts.push("Update cannot be fast-forwarded cleanly.");
  }
  return parts.join(" — ");
}

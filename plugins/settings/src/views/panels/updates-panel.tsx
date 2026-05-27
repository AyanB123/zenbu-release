import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircleIcon, CheckCircle2Icon, DownloadCloudIcon, RefreshCwIcon } from "lucide-react";
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

  const coreRepo = useMemo(
    () => repos.find((repo) => repo.kind === "core") ?? null,
    [repos],
  );
  const externalRepos = useMemo(
    () => repos.filter((repo) => repo.kind === "external"),
    [repos],
  );

  return (
    <div className="flex min-h-full flex-col gap-5 pb-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Updates</h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-snug text-muted-foreground">
            Check plugin repos for downloaded updates. Checking only fetches git
            objects; code is applied after you click Restart to update.
          </p>
        </div>
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
          Loading plugin repos…
        </div>
      ) : repos.length === 0 ? (
        <div className="rounded-md border border-border p-4 text-[12px] text-muted-foreground">
          No updateable plugin repos were found.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {coreRepo ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold text-foreground">Core plugins</h3>
              <RepoCard
                repo={coreRepo}
                state={checks[coreRepo.path] ?? { status: "idle" }}
                onCheck={() => void checkRepo(coreRepo)}
                onApply={() => void updater.applyRepo({ path: coreRepo.path })}
              />
            </section>
          ) : null}

          {externalRepos.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold text-foreground">Installed plugin repos</h3>
              <div className="flex flex-col gap-2">
                {externalRepos.map((repo) => (
                  <RepoCard
                    key={repo.path}
                    repo={repo}
                    state={checks[repo.path] ?? { status: "idle" }}
                    onCheck={() => void checkRepo(repo)}
                    onApply={() => void updater.applyRepo({ path: repo.path })}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function RepoCard({
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
  const result = state.status === "ready" ? state.result : null;
  const available = result?.kind === "available" ? result : null;
  const hasBlockingIssue = !!available && (!available.canFastForward || available.conflicts.length > 0);

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-foreground">
              {repo.displayName}
            </span>
            <StatusBadge state={state} />
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {repo.remoteUrl ?? repo.path}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {repo.plugins.map((plugin) => (
              <span
                key={plugin.name}
                className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {plugin.name}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={state.status === "checking"}
            onClick={onCheck}
            className="gap-2"
          >
            <DownloadCloudIcon className="size-3.5" />
            {state.status === "checking" ? "Checking…" : "Check"}
          </Button>
          {available && !hasBlockingIssue ? (
            <Button type="button" size="sm" onClick={onApply}>
              Restart to update
            </Button>
          ) : null}
        </div>
      </div>

      <RepoDetails state={state} />
    </div>
  );
}

function StatusBadge({ state }: { state: CheckState }) {
  if (state.status === "checking") {
    return <Badge>Checking</Badge>;
  }
  if (state.status === "error") {
    return <Badge tone="bad">Error</Badge>;
  }
  if (state.status !== "ready") {
    return <Badge>Not checked</Badge>;
  }
  if (state.result.kind === "up-to-date") {
    return <Badge tone="good">Up to date</Badge>;
  }
  if (state.result.kind === "error") {
    return <Badge tone="bad">Error</Badge>;
  }
  if (!state.result.canFastForward || state.result.conflicts.length > 0) {
    return <Badge tone="bad">Needs attention</Badge>;
  }
  return <Badge tone="update">Update available</Badge>;
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: string;
  tone?: "neutral" | "good" | "bad" | "update";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "good" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "bad" && "bg-destructive/10 text-destructive",
        tone === "update" && "bg-primary/10 text-primary",
      )}
    >
      {children}
    </span>
  );
}

function RepoDetails({ state }: { state: CheckState }) {
  if (state.status === "idle") {
    return (
      <p className="mt-4 text-[12px] text-muted-foreground">
        Not checked yet.
      </p>
    );
  }
  if (state.status === "checking") {
    return (
      <p className="mt-4 text-[12px] text-muted-foreground">
        Fetching the remote and checking whether the update can apply cleanly…
      </p>
    );
  }
  if (state.status === "error") {
    return <Issue message={state.message} />;
  }

  const result = state.result;
  if (result.kind === "error") {
    return <Issue message={result.message} />;
  }
  if (result.kind === "up-to-date") {
    return (
      <div className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
        <CheckCircle2Icon className="size-4 text-emerald-600" />
        This repo is already on the latest fetched commit.
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3 text-[12px] text-muted-foreground">
      <div className="grid gap-2 sm:grid-cols-3">
        <Fact label="Commits behind" value={String(result.behind)} />
        <Fact label="Local commits ahead" value={String(result.ahead)} />
        <Fact label="Dependencies" value={result.dependenciesChanged ? "Will install" : "No change"} />
      </div>
      {result.canFastForward && result.conflicts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
          <CheckCircle2Icon className="size-4 text-emerald-600" />
          Ready to apply. The window will close immediately when you restart to update.
        </div>
      ) : (
        <Issue
          message="This update cannot be applied automatically yet. Resolve local changes or branch divergence first."
          details={[...result.dirtyFiles, ...result.conflicts]}
        />
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[13px] font-medium text-foreground">{value}</div>
    </div>
  );
}

function Issue({ message, details = [] }: { message: string; details?: string[] }) {
  return (
    <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{message}</div>
          {details.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px]">
              {[...new Set(details)].map((detail) => (
                <li key={detail} className="break-all">{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

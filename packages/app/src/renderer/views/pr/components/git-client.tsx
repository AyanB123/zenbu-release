import { useCallback, useEffect, useState } from "react"
import { useRpc } from "@zenbujs/core/react"
import type {
  GitStatus,
  GitBranch,
  GitCommit,
} from "@/views/pr/types"
import { GitToolbar } from "./git-toolbar"
import { ChangesTab } from "./changes-tab"
import { HistoryTab } from "./history-tab"
import { BranchesTab } from "./branches-tab"

type TabKey = "changes" | "history" | "branches"

/**
 * Top-level git client surface. Owns the high-level repo state
 * (status, branches, commits) and the currently selected tab.
 *
 * Each tab pulls what it needs from this state and triggers a
 * targeted refetch via the callbacks we pass down. We keep all
 * fetches debounced+idempotent so multiple panes refreshing on
 * the same event won't dogpile git.
 */
export function GitClient({ directory }: { directory: string }) {
  const rpc = useRpc()
  const [tab, setTab] = useState<TabKey>("changes")
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    const next = await rpc.app.pr.getStatus({ directory })
    setStatus(next)
  }, [directory, rpc])

  const refreshBranches = useCallback(async () => {
    const res = await rpc.app.pr.getBranches({ directory })
    if (res.ok) setBranches(res.branches)
  }, [directory, rpc])

  const refreshHistory = useCallback(async () => {
    const res = await rpc.app.pr.getHistory({ directory, limit: 200 })
    if (res.ok) setCommits(res.commits)
  }, [directory, rpc])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshBranches(), refreshHistory()])
  }, [refreshBranches, refreshHistory, refreshStatus])

  // Initial load + light polling so external git activity shows up.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        await refreshAll()
      } catch (err) {
        if (!cancelled) setError(errMessage(err))
      }
    }
    void load()
    const id = setInterval(() => {
      if (cancelled) return
      void refreshStatus().catch(() => {})
    }, 2500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [refreshAll, refreshStatus])

  const runWithBusy = useCallback(
    async (label: string, fn: () => Promise<{ ok: boolean; error?: string } | void>) => {
      setBusy(label)
      setError(null)
      try {
        const res = await fn()
        if (res && res.ok === false) setError(res.error ?? "Failed")
      } catch (err) {
        setError(errMessage(err))
      } finally {
        setBusy(null)
        await refreshAll().catch(() => {})
      }
    },
    [refreshAll],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <GitToolbar
        directory={directory}
        status={status}
        branches={branches}
        busy={busy}
        activeTab={tab}
        onChangeTab={setTab}
        onRefresh={() => void refreshAll()}
        onFetch={() =>
          runWithBusy("Fetching", () => rpc.app.pr.fetch({ directory }))
        }
        onPull={() =>
          runWithBusy("Pulling", () => rpc.app.pr.pull({ directory }))
        }
        onPush={() =>
          runWithBusy("Pushing", () =>
            rpc.app.pr.push({
              directory,
              setUpstream: status?.upstream == null,
            }),
          )
        }
        onCheckout={branch =>
          runWithBusy(`Checking out ${branch}`, () =>
            rpc.app.pr.checkout({ directory, branch }),
          )
        }
        onCreateBranch={name =>
          runWithBusy(`Creating ${name}`, () =>
            rpc.app.pr.createBranch({
              directory,
              name,
              checkout: true,
            }),
          )
        }
      />

      {error && (
        <div className="shrink-0 border-b bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline-offset-2 hover:underline"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {tab === "changes" && (
          <ChangesTab
            directory={directory}
            status={status}
            busy={busy}
            onStage={paths =>
              runWithBusy("Staging", () =>
                rpc.app.pr.stageFiles({ directory, paths }),
              )
            }
            onUnstage={paths =>
              runWithBusy("Unstaging", () =>
                rpc.app.pr.unstageFiles({ directory, paths }),
              )
            }
            onDiscard={paths =>
              runWithBusy("Discarding", () =>
                rpc.app.pr.discardFiles({ directory, paths }),
              )
            }
            onCommit={(message, body, onlyStaged) =>
              runWithBusy("Committing", () =>
                rpc.app.pr.commit({
                  directory,
                  message,
                  body,
                  onlyStaged,
                }),
              )
            }
          />
        )}
        {tab === "history" && (
          <HistoryTab directory={directory} commits={commits} />
        )}
        {tab === "branches" && (
          <BranchesTab
            directory={directory}
            branches={branches}
            busy={busy}
            onCheckout={branch =>
              runWithBusy(`Checking out ${branch}`, () =>
                rpc.app.pr.checkout({ directory, branch }),
              )
            }
            onDelete={(name, force) =>
              runWithBusy(`Deleting ${name}`, () =>
                rpc.app.pr.deleteBranch({ directory, name, force }),
              )
            }
            onCreate={(name, from) =>
              runWithBusy(`Creating ${name}`, () =>
                rpc.app.pr.createBranch({
                  directory,
                  name,
                  from,
                  checkout: true,
                }),
              )
            }
          />
        )}
      </div>
    </div>
  )
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

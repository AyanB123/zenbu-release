import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react"
import { cn } from "@zenbu/ui/utils"
import { Button } from "@zenbu/ui/button"
import { HoverTip } from "@zenbu/ui/hover-tip"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@zenbu/ui/dialog"
import { useRpc, useUpdater, type ViewComponentProps } from "@zenbujs/core/react"

/**
 * Title-bar auto-updater button.
 *
 * Polls `pluginUpdater.checkAll()` every 10 seconds and renders a
 * single "Restart to update" pill in the title-bar right slot as
 * soon as any repo reports `kind: "available"`. The button is the
 * same shape for both the happy path and the conflicted path — we
 * decide what to actually do on click:
 *
 *   - All available repos can fast-forward cleanly → call
 *     `applyRepo()` on the first one. That's the same path as
 *     Settings → Updates → "Restart to update".
 *   - Any available repo has a dirty working tree, divergent
 *     history, or a probed merge conflict → pop the conflicts
 *     modal, which loads diffs lazily and offers a "Copy prompt"
 *     button so the user's agent can resolve the conflicts before
 *     the next attempt.
 *
 * Per the project's UX rules ("Restart to update" decides on
 * click, not earlier), we deliberately don't split this into two
 * differently-labelled buttons.
 */

const POLL_INTERVAL_MS = 10_000

type PluginRepoRef = {
  path: string
  displayName: string
  kind: "core" | "external"
  plugins: { name: string; dir: string }[]
  branch: string | null
  remote: string | null
  remoteUrl: string | null
  head: string | null
}

type UpdateCheck =
  | { kind: "up-to-date"; repo: PluginRepoRef }
  | {
      kind: "available"
      repo: PluginRepoRef
      target: string
      remoteRef: string
      behind: number
      ahead: number
      canFastForward: boolean
      conflicts: string[]
      dirtyFiles: string[]
      dependenciesChanged: boolean
      lockfile: string | null
    }
  | { kind: "error"; repo: PluginRepoRef; message: string }

type AvailableCheck = Extract<UpdateCheck, { kind: "available" }>

type DiffEntry = {
  path: string
  local: string
  incoming: string
  truncated: boolean
  error: string | null
}

type AutoUpdaterRpc = {
  autoUpdater: {
    autoUpdater: {
      getConflictDiffs(args: {
        repoPath: string
        target: string
        files: string[]
      }): Promise<{ diffs: DiffEntry[] }>
    }
  }
}

export default function AutoUpdaterView(
  _props: ViewComponentProps<Record<string, unknown>>,
) {
  const updater = useUpdater()
  const [checks, setChecks] = useState<UpdateCheck[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  // Mount/unmount guard — `checkAll` can take a few seconds and we
  // don't want a late resolve to set state on a remounted view.
  const aliveRef = useRef(true)

  const runCheck = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const next = (await updater.checkAll()) as UpdateCheck[]
      if (!aliveRef.current) return
      setChecks(next)
    } catch (err) {
      // Network blips / non-git plugin dirs throw here. We swallow
      // because the next poll will retry; logging too loudly would
      // spam the console while offline.
      console.debug("[auto-updater] checkAll failed:", err)
    } finally {
      inFlight.current = false
    }
  }, [updater])

  useEffect(() => {
    aliveRef.current = true
    void runCheck()
    const id = setInterval(runCheck, POLL_INTERVAL_MS)
    return () => {
      aliveRef.current = false
      clearInterval(id)
    }
  }, [runCheck])

  const available = useMemo<AvailableCheck[]>(
    () =>
      checks.filter((c): c is AvailableCheck => c.kind === "available"),
    [checks],
  )

  const blocked = useMemo<AvailableCheck[]>(
    () => available.filter(isBlocked),
    [available],
  )

  const clean = useMemo<AvailableCheck[]>(
    () => available.filter(c => !isBlocked(c)),
    [available],
  )

  if (available.length === 0) return null

  const hasBlocked = blocked.length > 0

  const handleClick = async () => {
    if (busy) return
    if (hasBlocked) {
      setModalOpen(true)
      return
    }
    const target = clean[0]
    if (!target) return
    setBusy(true)
    try {
      // `applyRepo` resolves `Promise<never>` — the host tears the
      // runtime down and the renderer reloads from scratch, so we
      // don't bother clearing `busy` on the happy path.
      await updater.applyRepo({ path: target.repo.path })
    } catch (err) {
      console.error("[auto-updater] applyRepo failed:", err)
      if (aliveRef.current) setBusy(false)
    }
  }

  return (
    <>
      <HoverTip
        label={
          hasBlocked
            ? "Update available — conflicts need attention"
            : "Update available"
        }
        setAriaLabel={false}
      >
        <button
          type="button"
          onClick={() => void handleClick()}
          disabled={busy}
          className={cn(
            "inline-flex h-[22px] items-center gap-1.5 rounded-md border border-border bg-background/40 px-2 text-[11px] font-medium leading-none text-muted-foreground transition-colors",
            "hover:bg-background/70 hover:text-foreground",
            // A single dot is enough signal that something needs
            // your attention — we don't badge "N updates" because
            // the user doesn't care which repo, only that one
            // restart is pending.
            hasBlocked && "text-amber-500 hover:text-amber-400",
          )}
        >
          <RefreshCwIcon className={cn("size-3", busy && "animate-spin")} />
          <span>Restart to update</span>
        </button>
      </HoverTip>

      <ConflictsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        blocked={blocked}
      />
    </>
  )
}

function isBlocked(check: AvailableCheck): boolean {
  return (
    !check.canFastForward ||
    check.conflicts.length > 0 ||
    check.dirtyFiles.length > 0
  )
}

// ---------------------------------------------------------------------------
// Conflicts modal.
//
// One header, one scroll region listing each blocked repo with its
// blocking files, and a two-button footer ("Cancel" / "Copy prompt").
// Per the project style we keep copy minimal — the user already
// knows what the modal is for; the prompt itself carries the
// detailed instructions for the agent.

function ConflictsModal({
  open,
  onOpenChange,
  blocked,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  blocked: AvailableCheck[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ConflictsModalBody blocked={blocked} onClose={() => onOpenChange(false)} />
      ) : null}
    </Dialog>
  )
}

function ConflictsModalBody({
  blocked,
  onClose,
}: {
  blocked: AvailableCheck[]
  onClose: () => void
}) {
  const rpc = useRpc() as unknown as AutoUpdaterRpc
  const [diffsByRepo, setDiffsByRepo] = useState<Record<string, DiffEntry[]>>({})
  const [copied, setCopied] = useState(false)
  const [loadingPrompt, setLoadingPrompt] = useState(false)

  // Lazy-load diffs on first open. We don't render them inline
  // (the modal is intentionally compact) — they're only used to
  // build the copy-prompt payload. Fetching upfront means the
  // "Copy prompt" click feels instant; if the user dismisses the
  // modal before the fetch lands we just discard the result.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next: Record<string, DiffEntry[]> = {}
      for (const check of blocked) {
        const files = uniqueBlockingFiles(check)
        if (files.length === 0) {
          next[check.repo.path] = []
          continue
        }
        try {
          const { diffs } = await rpc.autoUpdater.autoUpdater.getConflictDiffs({
            repoPath: check.repo.path,
            target: check.target,
            files,
          })
          if (cancelled) return
          next[check.repo.path] = diffs
        } catch (err) {
          console.warn("[auto-updater] getConflictDiffs failed:", err)
          if (cancelled) return
          next[check.repo.path] = []
        }
      }
      if (!cancelled) setDiffsByRepo(next)
    })()
    return () => {
      cancelled = true
    }
  }, [blocked, rpc])

  const copyPrompt = useCallback(async () => {
    setLoadingPrompt(true)
    try {
      const prompt = buildPrompt(blocked, diffsByRepo)
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error("[auto-updater] clipboard write failed:", err)
    } finally {
      setLoadingPrompt(false)
    }
  }, [blocked, diffsByRepo])

  return (
    <DialogContent className="sm:max-w-[480px] p-0 gap-0">
      <DialogHeader className="px-5 pt-5 pb-3">
        <DialogTitle className="text-[14px] font-semibold">
          Resolve conflicts to update
        </DialogTitle>
      </DialogHeader>

      <div className="max-h-[320px] overflow-y-auto px-5 pb-4">
        <ul className="flex flex-col gap-3">
          {blocked.map(check => {
            const files = uniqueBlockingFiles(check)
            return (
              <li key={check.repo.path} className="flex flex-col gap-1.5">
                <div className="text-[12px] font-medium text-foreground truncate">
                  {repoLabel(check.repo)}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {files.map(file => (
                    <li
                      key={file}
                      className="truncate font-mono text-[11px] text-muted-foreground"
                      title={file}
                    >
                      {file}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      </div>

      <DialogFooter className="px-5 py-3 border-t border-border bg-muted/30 rounded-b-xl">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 text-[13px]"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void copyPrompt()}
          disabled={loadingPrompt}
          className="h-8 gap-1.5 text-[13px]"
        >
          {copied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy prompt"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function uniqueBlockingFiles(check: AvailableCheck): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const f of [...check.dirtyFiles, ...check.conflicts]) {
    if (seen.has(f)) continue
    seen.add(f)
    out.push(f)
  }
  return out
}

function repoLabel(repo: PluginRepoRef): string {
  if (repo.plugins.length === 1) return repo.plugins[0]!.name
  return repo.displayName
}

/**
 * Compose the agent prompt. Format is deliberately plain text so
 * the receiving agent can apply edits without reasoning about
 * markdown structure — the file path delimits the unit of work
 * and the diff bodies are valid unified diffs that `git apply`
 * (or a model) can consume directly.
 */
function buildPrompt(
  blocked: AvailableCheck[],
  diffsByRepo: Record<string, DiffEntry[]>,
): string {
  const lines: string[] = []
  lines.push(
    "Resolve the following merge conflicts so the app can pull the latest plugin updates. For each file, the LOCAL block is what's on disk relative to HEAD, and the INCOMING block is what the upstream update would bring in. Reconcile them, keeping local intent where appropriate, and leave the working tree clean.",
  )
  lines.push("")
  for (const check of blocked) {
    const diffs = diffsByRepo[check.repo.path] ?? []
    lines.push(`# Repo: ${check.repo.path}`)
    lines.push(
      `# Branch: ${check.repo.branch ?? "?"} → ${check.remoteRef} @ ${check.target.slice(0, 7)}`,
    )
    lines.push("")
    if (diffs.length === 0) {
      lines.push("(no diff content available)")
      lines.push("")
      continue
    }
    for (const diff of diffs) {
      lines.push(`## ${diff.path}`)
      if (diff.local.trim()) {
        lines.push("### LOCAL (working tree vs HEAD)")
        lines.push("```diff")
        lines.push(diff.local.trimEnd())
        lines.push("```")
      }
      if (diff.incoming.trim()) {
        lines.push("### INCOMING (HEAD vs upstream target)")
        lines.push("```diff")
        lines.push(diff.incoming.trimEnd())
        lines.push("```")
      }
      if (!diff.local.trim() && !diff.incoming.trim()) {
        lines.push(
          diff.error
            ? `(diff unavailable: ${diff.error})`
            : "(no diff content)",
        )
      }
      lines.push("")
    }
  }
  return lines.join("\n")
}

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { useDb, useRpc } from "@zenbujs/core/react"
import { cn } from "@/lib/utils"

/**
 * `/worktree-handoff` slash-command panel. Brings the commits from
 * the current chat's worktree onto another worktree's branch,
 * with pre-flight conflict detection and a "let the agent resolve
 * it" escape hatch.
 *
 * The panel is a small state machine:
 *
 *   pickTarget  — list of OTHER worktrees in the same repo.
 *                 Keyboard nav (j/k + ArrowUp/Down), Enter selects.
 *   inspecting  — busy state while `rpc.app.gitHandoff.inspect`
 *                 fetches status + commits + conflict info.
 *   preview     — clean case. Shows the rev list + an optional
 *                 commit-message field for the source's dirty
 *                 changes. Enter applies.
 *   conflict    — conflict case. Lists conflicting files + a small
 *                 diff snippet. Two paths: "Resolve with agent"
 *                 (one-way; drops a prompt into the composer and
 *                 closes the panel) or back to target picker.
 *   applying    — busy while the cherry-pick + stash dance runs.
 *
 * Design choices worth noting:
 *
 *   1. Each stage owns its own keyboard handler — written as
 *      branches off the same container handler so the focus story
 *      stays simple (container is the sink; descendants bubble).
 *   2. We deliberately re-run `inspect` between picking a target
 *      and showing the preview (rather than trusting a cached
 *      result from the list step) — the cost is one git call and
 *      the benefit is that race conditions (user changes files in
 *      another tool between list-render and apply) get surfaced
 *      up front.
 *   3. The conflict-resolution prompt is built and emitted by the
 *      main side via `prepareAgentResolution`. We don't construct
 *      the text in the renderer because the main side has the
 *      authoritative git info already (and emitting an event from
 *      there reaches the Composer's subscription without any
 *      renderer-side IPC dance).
 *   4. The list excludes the current worktree (you can't hand off
 *      to yourself). Worktrees on the same branch as the source
 *      are still listed but dimmed — that's a valid-but-weird flow
 *      we don't want to silently hide.
 */

type InspectResult = Awaited<
  ReturnType<
    ReturnType<typeof useRpc>["app"]["gitHandoff"]["inspect"]
  >
>

export type WorktreeHandoffSelectorProps = {
  /** Chat id — used as the composerId for the agent-resolution
   * prompt event, so the right composer receives it. */
  chatId: string
  /** Current chat's scope (the *source* of the handoff). */
  sourceScopeId: string
  onCancel: () => void
  /** Called after a successful apply so the chat-pane can close
   * the panel + restore the composer. */
  onApplied: (args: { appliedCommits: number; warnings: string[] }) => void
  /** Called after the agent-resolution prompt has been emitted so
   * the panel can close (the composer will fill in via the
   * existing `appendComposerDraft` subscription). */
  onAgentResolutionRequested: () => void
}

type Stage =
  | { kind: "pickTarget" }
  | {
      kind: "inspecting"
      targetScopeId: string
    }
  | {
      kind: "preview"
      targetScopeId: string
      result: InspectResult
    }
  | {
      kind: "conflict"
      targetScopeId: string
      result: InspectResult
    }
  | {
      kind: "applying"
      targetScopeId: string
    }

export function WorktreeHandoffSelector({
  chatId,
  sourceScopeId,
  onCancel,
  onApplied,
  onAgentResolutionRequested,
}: WorktreeHandoffSelectorProps) {
  const rpc = useRpc()
  const sourceScope = useDb(root => root.app.scopes[sourceScopeId])
  const repo = useDb(root =>
    sourceScope?.repoId ? root.app.repos[sourceScope.repoId] : undefined,
  )

  // List of valid handoff candidates: every worktree of the same
  // repo, excluding the current one. We map worktree-path → scopeId
  // by looking through `app.scopes` for a scope with that
  // directory; worktrees without an existing scope still appear
  // (we'll materialize a scope on the fly when the user picks
  // them).
  const allScopes = useDb(root => root.app.scopes)
  const candidates = useMemo<
    Array<{
      scopeId: string | null
      worktreePath: string
      branch: string | null
      isMainWorktree: boolean
    }>
  >(() => {
    if (!repo || !sourceScope) return []
    return repo.worktrees
      .filter(w => w.path !== sourceScope.directory)
      .map(w => {
        // Try to find an existing scope inside the same workspace
        // that points at this worktree directory. If none exists,
        // `scopeId` is null and we'll fall back at pick-time.
        const existing = Object.values(allScopes).find(
          s =>
            s.workspaceId === sourceScope.workspaceId &&
            s.directory === w.path,
        )
        return {
          scopeId: existing?.id ?? null,
          worktreePath: w.path,
          branch: w.branch,
          isMainWorktree: w.path === repo.mainWorktreePath,
        }
      })
  }, [repo, sourceScope, allScopes])

  const [stage, setStage] = useState<Stage>({ kind: "pickTarget" })
  const [cursor, setCursor] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Commit message buffer for the preview stage. Held at the top
  // level so backing out to the picker and re-entering preserves
  // what the user typed.
  const [commitMessage, setCommitMessage] = useState("")
  const [hasFocus, setHasFocus] = useState(true)

  // Reset cursor when the candidate list changes shape.
  useEffect(() => {
    if (cursor >= candidates.length) {
      setCursor(Math.max(0, candidates.length - 1))
    }
  }, [candidates.length, cursor])

  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    containerRef.current?.focus()
  }, [])
  // Keep the cursor row scrolled into view.
  useLayoutEffect(() => {
    if (stage.kind !== "pickTarget") return
    const listEl = listRef.current
    if (!listEl) return
    const row = listEl.querySelector<HTMLElement>(
      `[data-row-index="${cursor}"]`,
    )
    if (row) row.scrollIntoView({ block: "nearest" })
  }, [cursor, stage.kind])

  // Scope-level guardrail.
  const cannotProceedReason: string | null = !sourceScope
    ? "Scope not found."
    : !sourceScope.repoId
      ? "This chat's working directory is not a git repository."
      : !repo
        ? "Repo metadata still syncing — try again in a moment."
        : candidates.length === 0
          ? "No other worktrees in this repo. Create one with /workspace first."
          : null

  // ---- stage transitions ----

  const startInspect = async (candidate: (typeof candidates)[number]) => {
    const targetScopeId = await ensureScopeForWorktree(candidate)
    if (!targetScopeId) return
    setStage({ kind: "inspecting", targetScopeId })
    setError(null)
    try {
      const result = await rpc.app.gitHandoff.inspect({
        sourceScopeId,
        targetScopeId,
      })
      if (!result.hasWork) {
        setError(
          `Nothing to hand off: ${candidate.branch ?? "target"} is already up to date with this branch.`,
        )
        setStage({ kind: "pickTarget" })
        return
      }
      setStage({
        kind: result.conflict ? "conflict" : "preview",
        targetScopeId,
        result,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage({ kind: "pickTarget" })
    }
  }

  /**
   * Make sure the picked worktree has a scope in the same workspace
   * (so the RPC layer can locate it). Materializes one on the fly
   * if needed. This mirrors the side-effect of `/workspace`:
   * picking a worktree without a scope creates the scope.
   *
   * NOTE: scope creation is a direct db.client.update via the
   * renderer's RPC layer; we do it through a tiny helper RPC if
   * one exists, otherwise we'd need to push this into a service.
   * For now, we use the existing `dbClient` pattern at the call
   * site (see chat-pane's worktree-creation flow for the canonical
   * shape). Since this component doesn't have access to dbClient
   * here, we keep this method simple: if there's no scope already,
   * we surface an error rather than auto-create. Worktrees that
   * have an associated chat already have a scope.
   */
  const ensureScopeForWorktree = async (
    candidate: (typeof candidates)[number],
  ): Promise<string | null> => {
    if (candidate.scopeId) return candidate.scopeId
    setError(
      `That worktree isn't materialized as a scope yet — open it from the sidebar first, then come back.`,
    )
    return null
  }

  const submitApply = async (s: Extract<Stage, { kind: "preview" }>) => {
    setStage({ kind: "applying", targetScopeId: s.targetScopeId })
    setError(null)
    try {
      const res = await rpc.app.gitHandoff.apply({
        sourceScopeId,
        targetScopeId: s.targetScopeId,
        sourceCommitMessage: commitMessage,
      })
      if (!res.ok) {
        setError(res.error)
        // Drop back to the preview so the user can see what they
        // picked + retry. Re-inspect to refresh state (commits may
        // have changed if the apply got partway through).
        setStage({
          kind: "preview",
          targetScopeId: s.targetScopeId,
          result: s.result,
        })
        return
      }
      onApplied({
        appliedCommits: res.appliedCommits,
        warnings: res.warnings,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage({
        kind: "preview",
        targetScopeId: s.targetScopeId,
        result: s.result,
      })
    }
  }

  const resolveWithAgent = async (
    s: Extract<Stage, { kind: "conflict" }>,
  ) => {
    setError(null)
    try {
      await rpc.app.gitHandoff.prepareAgentResolution({
        chatId,
        sourceScopeId,
        targetScopeId: s.targetScopeId,
      })
      onAgentResolutionRequested()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // ---- keyboard ----

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (stage.kind === "pickTarget") return onPickTargetKey(e)
    if (stage.kind === "preview") return onPreviewKey(e, stage)
    if (stage.kind === "conflict") return onConflictKey(e, stage)
    // inspecting / applying: only Escape works (and only to abort
    // visually — the in-flight RPC continues to run to completion
    // on the main side).
    if (e.key === "Escape") {
      e.preventDefault()
      onCancel()
    }
  }

  const onPickTargetKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault()
      onCancel()
      return
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault()
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault()
      setCursor(c => Math.min(candidates.length - 1, c + 1))
      return
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      const pick = candidates[cursor]
      if (!pick) return
      void startInspect(pick)
    }
  }

  const onPreviewKey = (
    e: KeyboardEvent<HTMLDivElement>,
    s: Extract<Stage, { kind: "preview" }>,
  ) => {
    if (e.key === "Escape") {
      e.preventDefault()
      setStage({ kind: "pickTarget" })
      return
    }
    // Enter applies — but ONLY when focus is on the container
    // (i.e. not the commit-message input). When it IS the input,
    // the input itself fires Enter and bubbles up; we still want
    // submit. Easiest: just always treat Enter as submit in preview.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void submitApply(s)
    }
  }

  const onConflictKey = (
    e: KeyboardEvent<HTMLDivElement>,
    s: Extract<Stage, { kind: "conflict" }>,
  ) => {
    if (e.key === "Escape") {
      e.preventDefault()
      setStage({ kind: "pickTarget" })
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      void resolveWithAgent(s)
    }
  }

  // ---- render ----

  return (
    <div className="mx-auto w-full max-w-[919px] px-2 pt-1 pb-2">
      <div
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onFocus={() => setHasFocus(true)}
        onBlur={e => {
          const next = e.relatedTarget as Node | null
          if (next && containerRef.current?.contains(next)) return
          setHasFocus(false)
        }}
        className={cn(
          "flex max-h-[60vh] min-h-0 flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg outline-none",
          hasFocus
            ? "border-primary/40 ring-1 ring-primary/30"
            : "border-border",
        )}
      >
        {cannotProceedReason ? (
          <FixedStateMessage
            title="Worktree handoff"
            body={cannotProceedReason}
            onCancel={onCancel}
          />
        ) : stage.kind === "pickTarget" ? (
          <PickTargetView
            candidates={candidates}
            cursor={cursor}
            onCursor={setCursor}
            onPick={i => {
              setCursor(i)
              const c = candidates[i]
              if (c) void startInspect(c)
            }}
            error={error}
            listRef={listRef}
          />
        ) : stage.kind === "inspecting" ? (
          <BusyView label="Inspecting handoff…" />
        ) : stage.kind === "preview" ? (
          <PreviewView
            result={stage.result}
            commitMessage={commitMessage}
            onCommitMessageChange={setCommitMessage}
            onConfirm={() => void submitApply(stage)}
            onBack={() => setStage({ kind: "pickTarget" })}
            error={error}
          />
        ) : stage.kind === "conflict" ? (
          <ConflictView
            result={stage.result}
            onResolveWithAgent={() => void resolveWithAgent(stage)}
            onBack={() => setStage({ kind: "pickTarget" })}
            error={error}
          />
        ) : (
          <BusyView label="Applying handoff…" />
        )}
      </div>
    </div>
  )
}

// ---- sub-views ----

function PickTargetView({
  candidates,
  cursor,
  onCursor,
  onPick,
  error,
  listRef,
}: {
  candidates: Array<{
    scopeId: string | null
    worktreePath: string
    branch: string | null
    isMainWorktree: boolean
  }>
  cursor: number
  onCursor: (i: number) => void
  onPick: (i: number) => void
  error: string | null
  listRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <>
      <div className="shrink-0 border-b border-border bg-muted/40 px-3 py-1.5">
        <div className="text-[11px] font-medium text-foreground">
          Pick a target worktree
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          ↑↓/jk: move &nbsp; ⏎: select &nbsp; esc: cancel
        </div>
      </div>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-auto px-1 py-1 font-mono text-[11px]"
      >
        {candidates.map((c, i) => (
          <div
            key={c.worktreePath}
            data-row-index={i}
            onMouseEnter={() => onCursor(i)}
            onClick={() => onPick(i)}
            className={cn(
              "flex items-baseline gap-2 rounded-sm px-2 py-1 cursor-pointer",
              i === cursor
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-foreground hover:bg-accent/40",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "w-3 shrink-0 text-center text-[10px]",
                i === cursor ? "text-primary" : "text-transparent",
              )}
            >
              ›
            </span>
            <span className="flex-1 truncate" title={c.worktreePath}>
              <span className="text-foreground">
                {c.branch ?? "(detached)"}
              </span>
              {c.isMainWorktree && (
                <span className="ml-1 text-[9.5px] uppercase tracking-wide text-muted-foreground">
                  main
                </span>
              )}
              {!c.scopeId && (
                <span className="ml-1 text-[9.5px] uppercase tracking-wide text-amber-500/80">
                  not opened
                </span>
              )}
              <span className="ml-2 text-muted-foreground">
                {c.worktreePath}
              </span>
            </span>
          </div>
        ))}
      </div>
      {error && (
        <div className="shrink-0 border-t border-border bg-muted/30 px-3 py-1 text-[11px] text-destructive">
          {error}
        </div>
      )}
    </>
  )
}

function PreviewView({
  result,
  commitMessage,
  onCommitMessageChange,
  onConfirm,
  onBack,
  error,
}: {
  result: InspectResult
  commitMessage: string
  onCommitMessageChange: (s: string) => void
  onConfirm: () => void
  onBack: () => void
  error: string | null
}) {
  return (
    <>
      <div className="shrink-0 border-b border-border bg-muted/40 px-3 py-1.5">
        <div className="text-[11px] font-medium text-foreground">
          Hand off to{" "}
          <span className="font-mono">{result.target.branch}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          ⏎: apply &nbsp; esc: back
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 flex flex-col gap-2">
        <div className="text-[11px] text-foreground">
          <span className="font-mono">{result.source.branch}</span>{" "}
          <span className="text-muted-foreground">→</span>{" "}
          <span className="font-mono">{result.target.branch}</span>
        </div>

        {result.source.dirty && (
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
              Commit message for pending changes ({result.source.dirtyFileCount}{" "}
              file{result.source.dirtyFileCount === 1 ? "" : "s"})
            </span>
            <input
              type="text"
              value={commitMessage}
              onChange={e => onCommitMessageChange(e.target.value)}
              placeholder="(auto-generated commit)"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
        )}

        {result.target.dirty && (
          <div className="text-[10.5px] text-muted-foreground">
            Target has {result.target.dirtyFileCount} uncommitted change
            {result.target.dirtyFileCount === 1 ? "" : "s"} — they'll be
            auto-stashed and popped back after the cherry-pick.
          </div>
        )}

        <div className="mt-1">
          <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground mb-1">
            Commits to apply ({result.commits.length})
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 flex flex-col gap-0.5 max-h-40 overflow-auto">
            {result.commits.map((c, i) => (
              <div
                key={c.sha + i}
                className="font-mono text-[11px] flex gap-2"
              >
                <span
                  className={cn(
                    "shrink-0",
                    c.sha === "PENDING"
                      ? "text-amber-500/80"
                      : "text-muted-foreground",
                  )}
                >
                  {c.shortSha}
                </span>
                <span className="truncate text-foreground" title={c.subject}>
                  {c.subject}
                </span>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="text-[11px] text-destructive whitespace-pre-wrap">
            {error}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border bg-muted/30 px-3 py-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <button
          type="button"
          onClick={onBack}
          className="hover:text-foreground"
        >
          ← back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="font-medium text-foreground"
        >
          apply ⏎
        </button>
      </div>
    </>
  )
}

function ConflictView({
  result,
  onResolveWithAgent,
  onBack,
  error,
}: {
  result: InspectResult
  onResolveWithAgent: () => void
  onBack: () => void
  error: string | null
}) {
  const conflict = result.conflict!
  return (
    <>
      <div className="shrink-0 border-b border-border bg-muted/40 px-3 py-1.5">
        <div className="text-[11px] font-medium text-foreground">
          Merge conflict detected
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          ⏎: resolve with agent &nbsp; esc: back
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 flex flex-col gap-2">
        <div className="text-[11px] text-foreground">
          Applying{" "}
          <span className="font-mono">{result.source.branch}</span> onto{" "}
          <span className="font-mono">{result.target.branch}</span> would
          conflict.
        </div>
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground mb-1">
            Conflicting files ({conflict.files.length})
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 flex flex-col gap-0.5 max-h-32 overflow-auto">
            {conflict.files.map(f => (
              <div key={f} className="font-mono text-[11px] truncate">
                {f}
              </div>
            ))}
          </div>
        </div>
        {conflict.diffPreview && (
          <div>
            <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground mb-1">
              Diff preview
            </div>
            <pre className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-[10.5px] font-mono overflow-auto max-h-40 whitespace-pre">
              {conflict.diffPreview}
            </pre>
          </div>
        )}
        {error && (
          <div className="text-[11px] text-destructive whitespace-pre-wrap">
            {error}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border bg-muted/30 px-3 py-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <button
          type="button"
          onClick={onBack}
          className="hover:text-foreground"
        >
          ← back
        </button>
        <button
          type="button"
          onClick={onResolveWithAgent}
          className="font-medium text-foreground"
        >
          resolve with agent ⏎
        </button>
      </div>
    </>
  )
}

function BusyView({ label }: { label: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-4 flex items-center justify-center">
      <span className="text-shimmer text-[11px]">{label}</span>
    </div>
  )
}

function FixedStateMessage({
  title,
  body,
  onCancel,
}: {
  title: string
  body: string
  onCancel: () => void
}) {
  return (
    <>
      <div className="shrink-0 border-b border-border bg-muted/40 px-3 py-1.5">
        <div className="text-[11px] font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          esc: close
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 text-[11px] text-foreground">
        {body}
      </div>
      <div className="shrink-0 border-t border-border bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="hover:text-foreground"
        >
          close
        </button>
      </div>
    </>
  )
}

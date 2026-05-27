import { useEffect, useMemo, useRef, useState } from "react"
import { Allotment } from "allotment"
import { useRpc } from "@zenbujs/core/react"
import { FileDiff as DiffsFileDiff } from "@pierre/diffs/react"
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"
import { cn } from "@/lib/utils"
import type { GitCommit } from "../types"

const DIFF_STYLE: React.CSSProperties = {
  "--diffs-light-bg": "var(--background)",
  "--diffs-dark-bg": "var(--background)",
  "--diffs-light": "var(--foreground)",
  "--diffs-dark": "var(--foreground)",
  "--diffs-bg-buffer-override": "var(--background)",
  "--diffs-bg-context-override": "var(--background)",
  "--diffs-bg-context-gutter-override": "var(--background)",
  "--diffs-bg-separator-override": "var(--border)",
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
  width: "100%",
  display: "block",
} as React.CSSProperties

/**
 * "History" tab — list of recent commits on the left, patch for
 * the selected commit on the right. Commit patches are fetched
 * lazily because they can be expensive on big merges.
 */
export function HistoryTab({
  directory,
  commits,
}: {
  directory: string
  commits: GitCommit[]
}) {
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    if (selected && commits.some(c => c.sha === selected)) return
    setSelected(commits[0]?.sha ?? null)
  }, [commits, selected])

  const commit = useMemo(
    () => commits.find(c => c.sha === selected) ?? null,
    [commits, selected],
  )

  return (
    <Allotment>
      <Allotment.Pane preferredSize={340} minSize={240} maxSize={520}>
        <CommitList
          commits={commits}
          selected={selected}
          onSelect={setSelected}
        />
      </Allotment.Pane>
      <Allotment.Pane minSize={300}>
        {commit ? (
          <CommitDetails key={commit.sha} directory={directory} commit={commit} />
        ) : (
          <Centered>No commits to display.</Centered>
        )}
      </Allotment.Pane>
    </Allotment>
  )
}

function CommitList({
  commits,
  selected,
  onSelect,
}: {
  commits: GitCommit[]
  selected: string | null
  onSelect: (sha: string) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-background">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b px-3 text-[11px] text-muted-foreground">
        <span>{commits.length} commits</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {commits.map(c => {
          const active = c.sha === selected
          return (
            <button
              key={c.sha}
              type="button"
              onClick={() => onSelect(c.sha)}
              className={cn(
                "flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-[12px]",
                active
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/40",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {c.subject || "(no message)"}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {c.shortSha}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">{c.authorName}</span>
                <span>·</span>
                <span>{formatDate(c.authorDate)}</span>
                {c.refs && (
                  <>
                    <span>·</span>
                    <span className="truncate">{c.refs}</span>
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CommitDetails({
  directory,
  commit,
}: {
  directory: string
  commit: GitCommit
}) {
  const rpc = useRpc()
  const [patch, setPatch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const themeType = useThemeType()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("unified")

  useEffect(() => {
    let cancelled = false
    setPatch(null)
    setError(null)
    rpc.app.pr
      .getCommitDiff({ directory, sha: commit.sha })
      .then(res => {
        if (cancelled) return
        setPatch(res.patch)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [commit.sha, directory, rpc])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (w: number) => setDiffStyle(w >= 920 ? "split" : "unified")
    update(el.clientWidth)
    const obs = new ResizeObserver(entries => {
      for (const e of entries) update(e.contentRect.width)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const fileDiffs = useMemo<FileDiffMetadata[]>(() => {
    if (!patch) return []
    try {
      const parsed = parsePatchFiles(patch)
      const out: FileDiffMetadata[] = []
      for (const p of parsed) out.push(...p.files)
      return out
    } catch {
      return []
    }
  }, [patch])

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full overflow-auto bg-background"
    >
      <div className="sticky top-0 z-10 border-b bg-background px-4 py-3">
        <div className="text-[13px] font-medium">{commit.subject}</div>
        {commit.body && (
          <pre className="mt-1 whitespace-pre-wrap text-[12px] text-muted-foreground">
            {commit.body.trim()}
          </pre>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="font-mono">{commit.sha}</span>
          <span>{commit.authorName}</span>
          <span>{new Date(commit.authorDate).toLocaleString()}</span>
          {commit.refs && <span className="font-mono">{commit.refs}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {error && (
          <div className="text-[12px] text-destructive">{error}</div>
        )}
        {patch == null && !error && (
          <div className="text-[12px] text-muted-foreground">Loading…</div>
        )}
        {fileDiffs.map(fileDiff => (
          <div
            key={fileDiff.name}
            className="overflow-hidden rounded border"
          >
            <DiffsFileDiff
              fileDiff={fileDiff}
              options={{
                disableFileHeader: false,
                theme: { dark: "pierre-dark", light: "pierre-light" },
                themeType,
                diffStyle,
              }}
              style={DIFF_STYLE}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
      {children}
    </div>
  )
}

function formatDate(ms: number): string {
  if (!ms) return ""
  const date = new Date(ms)
  const diff = Date.now() - ms
  const day = 24 * 3600 * 1000
  if (diff < day) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  }
  if (diff < 7 * day) {
    return date.toLocaleDateString([], { weekday: "short" })
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" })
}

function useThemeType(): "light" | "dark" {
  const get = () =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  const [type, setType] = useState<"light" | "dark">(get)
  useEffect(() => {
    const observer = new MutationObserver(() => setType(get()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [])
  return type
}

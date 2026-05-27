import { useEffect, useMemo, useRef, useState } from "react"
import { useRpc } from "@zenbujs/core/react"
import { FileDiff as DiffsFileDiff } from "@pierre/diffs/react"
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"
import { cn } from "@/lib/utils"
import type { GhCommit } from "../types"
import { ErrorBanner } from "./error-banner"

const DIFF_STYLE: React.CSSProperties = {
  "--diffs-light-bg": "var(--background)",
  "--diffs-dark-bg": "var(--background)",
  "--diffs-light": "var(--foreground)",
  "--diffs-dark": "var(--foreground)",
  "--diffs-bg-buffer-override": "var(--background)",
  "--diffs-bg-context-override": "var(--background)",
  "--diffs-bg-context-gutter-override": "var(--background)",
  "--diffs-bg-separator-override": "var(--border)",
  // Inherit the host's body font; no custom mono stack.
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
  width: "100%",
  display: "block",
} as React.CSSProperties

/**
 * Renders the diff for a single commit in the PR.
 *
 * Two variants, matching `PrCommitsList`:
 *   - `panel`  (default): scrolls internally, sticky commit header,
 *     resize-observed split/unified breakpoint. Used by the PR
 *     detail page where the diff lives in its own pane.
 *   - `inline`: lays out top-to-bottom inside a host scroll
 *     container; unified diff only (the column never gets wide
 *     enough for the side-by-side view to be useful). Used by
 *     the GitHub-style compose page.
 */
export function PrDiffViewer({
  directory,
  sha,
  commit,
  variant = "panel",
}: {
  directory: string
  sha: string
  commit: GhCommit | null
  variant?: "panel" | "inline"
}) {
  const rpc = useRpc()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [patch, setPatch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const themeType = useThemeType()
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("unified")

  useEffect(() => {
    let cancelled = false
    setPatch(null)
    setError(null)
    void rpc.app.github.getCommitDiff({ directory, sha }).then(res => {
      if (cancelled) return
      if (res.ok) {
        setPatch(res.patch)
      } else {
        setError(res.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [directory, rpc, sha])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (w: number) =>
      setDiffStyle(w >= 920 ? "split" : "unified")
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

  const inline = variant === "inline"
  const effectiveDiffStyle = inline ? "unified" : diffStyle
  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full bg-background",
        inline ? "" : "h-full min-h-0 overflow-auto",
      )}
    >
      {commit && !inline && (
        <div className="sticky top-0 z-10 border-b bg-background px-4 py-3">
          <div className="text-[13px] font-medium">
            {commit.subject || "(no message)"}
          </div>
          {commit.body && (
            <pre className="mt-1 whitespace-pre-wrap text-[12px] text-muted-foreground">
              {commit.body.trim()}
            </pre>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{commit.sha}</span>
            <span>{commit.authorName}</span>
            <span>{new Date(commit.authorDate).toLocaleString()}</span>
          </div>
        </div>
      )}
      <div className={inline ? "" : "p-2"}>
        {error ? (
          <div className={inline ? "p-3" : ""}>
            <ErrorBanner title="Could not load diff" detail={error} />
          </div>
        ) : patch == null ? null : fileDiffs.length === 0 ? (
          <div className="p-3 text-[12px] text-muted-foreground">
            No textual differences.
          </div>
        ) : (
          fileDiffs.map((fd, i) => (
            <div
              key={i}
              className={cn(
                "overflow-hidden",
                inline
                  ? "border-b last:border-b-0"
                  : "mb-3 rounded border",
              )}
            >
              <DiffsFileDiff
                fileDiff={fd}
                options={{
                  disableFileHeader: false,
                  themeType,
                  theme: { dark: "pierre-dark", light: "pierre-light" },
                  diffStyle: effectiveDiffStyle,
                }}
                style={DIFF_STYLE}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
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

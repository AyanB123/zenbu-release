import { useEffect, useMemo, useRef, useState } from "react"
import { useRpc } from "@zenbujs/core/react"
import { FileDiff as DiffsFileDiff } from "@pierre/diffs/react"
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"
import type { GitFileStatus } from "../types"

const DIFF_OPTIONS = {
  disableFileHeader: true,
  theme: { dark: "pierre-dark", light: "pierre-light" },
} as const

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

const SPLIT_BREAKPOINT_PX = 920

/**
 * Renders the diff for a single file. Fetches the patch on demand
 * (so the file list doesn't pay for diffs we never look at) and
 * picks unified vs split layout based on the available width.
 *
 * Untracked files don't have a real diff — we render them through
 * the same path but ask the backend to synthesize an
 * all-additions diff.
 */
export function DiffViewer({
  directory,
  file,
  staged,
}: {
  directory: string
  file: GitFileStatus
  staged: boolean
}) {
  const rpc = useRpc()
  const themeType = useThemeType()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [patch, setPatch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("split")

  useEffect(() => {
    let cancelled = false
    setPatch(null)
    setError(null)
    rpc.app.pr
      .getFileDiff({
        directory,
        path: file.path,
        staged,
        untracked: file.untracked,
      })
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
  }, [directory, file.path, file.untracked, rpc, staged])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (width: number) => {
      setDiffStyle(width >= SPLIT_BREAKPOINT_PX ? "split" : "unified")
    }
    update(el.clientWidth)
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) update(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fileDiff = useMemo<FileDiffMetadata | null>(() => {
    if (!patch) return null
    const parsed = parsePatchFiles(patch).flatMap(p => p.files)
    return parsed[0] ?? null
  }, [patch])

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full overflow-auto bg-background"
    >
      <div className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b bg-background px-3 text-[11.5px] text-muted-foreground">
        <span className="truncate font-mono">{file.path}</span>
        {file.binary && (
          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px]">
            binary
          </span>
        )}
      </div>
      <div className="p-2">
        {error ? (
          <div className="p-3 text-[12px] text-destructive">{error}</div>
        ) : patch == null ? (
          // Intentionally blank — the flash from "Loading…" → diff is
          // worse than a single blank frame on fast fetches.
          null
        ) : file.binary ? (
          <div className="p-3 text-[12px] text-muted-foreground">
            Binary file — no preview available.
          </div>
        ) : !fileDiff ? (
          <div className="p-3 text-[12px] text-muted-foreground">
            {file.code === "D" || file.code.includes("D")
              ? "File deleted."
              : "No textual differences."}
          </div>
        ) : (
          <div className="overflow-hidden rounded border">
            <DiffsFileDiff
              fileDiff={fileDiff}
              options={{ ...DIFF_OPTIONS, themeType, diffStyle }}
              style={DIFF_STYLE}
            />
          </div>
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

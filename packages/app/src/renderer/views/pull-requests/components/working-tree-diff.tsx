import { useEffect, useMemo, useRef, useState } from "react"
import { useRpc } from "@zenbujs/core/react"
import { FileDiff as DiffsFileDiff } from "@pierre/diffs/react"
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"
import { Spinner } from "@/components/ui/spinner"
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
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
  width: "100%",
  display: "block",
} as React.CSSProperties

/**
 * Renders the working-tree diff against HEAD \u2014 i.e. exactly the
 * changes the next `git add -A && git commit` would include.
 *
 * Lives under the commit composer in Phase 1 of the PR view so the
 * user can see *what they're about to commit* before they commit it.
 * GitHub Desktop's commit screen does the same; without it the
 * composer is asking the user to write a message blind.
 *
 * Reuses `getWorkingTreeSummary` (already called by the parent for
 * dirty-state detection) so this is essentially free \u2014 the service's
 * memoize hits the same in-flight promise.
 */
export function WorkingTreeDiff({ directory }: { directory: string }) {
  const rpc = useRpc()
  const [patch, setPatch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("unified")
  const themeType = useThemeType()

  useEffect(() => {
    let cancelled = false
    setPatch(null)
    setError(null)
    void rpc.app.github.getWorkingTreeSummary({ directory }).then(res => {
      if (cancelled) return
      if (res.ok) setPatch(res.patch)
      else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [directory, rpc])

  // Split-vs-unified breakpoint matches the rest of the PR view's
  // diff surfaces \u2014 920px is roughly where side-by-side hunks start
  // being more legible than a single column.
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

  if (error) {
    return <ErrorBanner title="Could not load diff" detail={error} />
  }
  if (patch == null) {
    return (
      <div className="flex h-24 items-center justify-center text-muted-foreground">
        <Spinner className="size-3" />
      </div>
    )
  }
  if (fileDiffs.length === 0) {
    // Working tree is clean (or the dirty state is purely staged
    // adds / mode changes with no textual diff). Either way, the
    // parent will close this phase as soon as `dirty` flips to
    // false, so we don't render an empty placeholder here.
    return null
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      {fileDiffs.map((fd, i) => (
        <div key={i} className="overflow-hidden rounded border">
          <DiffsFileDiff
            fileDiff={fd}
            options={{
              disableFileHeader: false,
              themeType,
              theme: { dark: "pierre-dark", light: "pierre-light" },
              diffStyle,
            }}
            style={DIFF_STYLE}
          />
        </div>
      ))}
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

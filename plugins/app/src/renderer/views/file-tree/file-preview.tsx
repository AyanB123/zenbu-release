import { useEffect, useState } from "react"
import { File as DiffsFile } from "@pierre/diffs/react"
import { useRpc } from "@zenbujs/core/react"

type State =
  | { kind: "loading" }
  | { kind: "binary" }
  | { kind: "error"; message: string }
  | { kind: "ready"; content: string; truncated: boolean }

export type FilePreviewProps = {
  directory: string
  path: string
}

const FILE_OPTIONS = {
  disableFileHeader: true,
  theme: { dark: "pierre-dark", light: "pierre-light" },
} as const

/**
 * Inline style applied to the diffs host element. The host is a custom
 * element with a shadow root; CSS variables defined here inherit through
 * the shadow boundary and are picked up by the diffs stylesheet's
 * fallback chain (`--diffs-*-override` → `--diffs-*` → defaults). That
 * lets us re-skin diffs with our own theme tokens without touching the
 * library.
 */
const DIFFS_STYLE: React.CSSProperties = {
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
  height: "100%",
} as React.CSSProperties

/**
 * Read-only file viewer powered by `@pierre/diffs`. It re-uses the same
 * Shiki-based syntax highlighting (and theming) that pairs with the
 * `@pierre/trees` file tree. Re-mounts when (directory, path) changes
 * via the `key` from the parent.
 */
export function FilePreview({ directory, path }: FilePreviewProps) {
  const rpc = useRpc()
  const [state, setState] = useState<State>({ kind: "loading" })
  const themeType = useThemeType()

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })
    rpc.app.fileTree
      .readFile({ directory, path })
      .then(res => {
        if (cancelled) return
        if (res.binary) {
          setState({ kind: "binary" })
          return
        }
        setState({
          kind: "ready",
          content: res.content,
          truncated: res.truncated,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        })
      })
    return () => {
      cancelled = true
    }
  }, [directory, path, rpc])

  if (state.kind === "loading") return <Notice>Loading…</Notice>
  if (state.kind === "binary") return <Notice>This file looks binary.</Notice>
  if (state.kind === "error") {
    return <Notice tone="error">{state.message}</Notice>
  }

  return (
    <div className="relative h-full min-h-0 w-full overflow-auto bg-background">
      {state.truncated ? (
        <div className="sticky top-0 z-10 border-b bg-background/90 px-3 py-1 text-[10px] uppercase tracking-wide text-amber-500 backdrop-blur">
          truncated preview
        </div>
      ) : null}
      <DiffsFile
        file={{ name: path, contents: state.content }}
        options={{ ...FILE_OPTIONS, themeType }}
        style={DIFFS_STYLE}
      />
    </div>
  )
}

function Notice({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "error"
}) {
  return (
    <div
      className={
        "flex h-full items-center justify-center p-4 text-center text-[12px] " +
        (tone === "error" ? "text-destructive" : "text-muted-foreground")
      }
    >
      {children}
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

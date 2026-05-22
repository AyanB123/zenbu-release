import { useDb, useViewArgs } from "@zenbujs/core/react"
import { useThemeSync } from "@/lib/theme"
import { GitClient } from "./components/git-client"

type PrViewArgs = {
  /** Scope directory passed by the host (sidebar, bottom panel, or
   * pane tab). When present, this is the source of truth and avoids
   * the iframe having to guess from `windowStates`, which is wrong
   * across multi-window setups. */
  directory?: string | null
  windowId?: string | null
  scopeId?: string | null
}

/**
 * Top-level entry for the "Git" view. The host (right sidebar /
 * bottom panel / tab) forwards the active scope's directory via
 * view args; we re-mount on directory change so child state from a
 * different repo doesn't leak across switches. As a fallback for
 * legacy mounts that don't pass args yet, we resolve from the db.
 */
export function PrApp() {
  useThemeSync()
  const argDirectory = useViewArgs<PrViewArgs>()?.directory ?? null
  const fallbackDirectory = useFallbackScopeDirectory(argDirectory == null)
  const directory = argDirectory ?? fallbackDirectory

  if (!directory) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
        No active workspace.
      </div>
    )
  }

  return <GitClient key={directory} directory={directory} />
}

/**
 * Last-resort directory resolver for hosts that haven't been updated
 * to forward args. Returns the first window's selected scope dir;
 * this is incorrect across multiple windows but is only consulted
 * when `args.directory` is missing.
 */
function useFallbackScopeDirectory(enabled: boolean): string | null {
  return useDb(root => {
    if (!enabled) return null
    const states = Object.values(root.app.windowStates)
    const scopeId =
      states.find(s => s.selectedScopeId != null)?.selectedScopeId ?? null
    if (!scopeId) return null
    return root.app.scopes[scopeId]?.directory ?? null
  })
}

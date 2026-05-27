import { useDb, useDbClient } from "@zenbujs/core/react"
import { useActiveVimMode, type VimMode } from "../store"

const MODE_LABEL: Record<VimMode, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  replace: "REPLACE",
}

const ITEM_CLASS =
  "inline-flex h-full items-center px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent/40 hover:text-foreground cursor-pointer select-none"

/**
 * Status-bar item rendering "VIM OFF" or the current mode label.
 * Click toggles `db.app.settings.vimMode`. Reads the active mode
 * from the cm-vim store.
 *
 * Inlines the styling (instead of reusing the host's `StatusBarItem`
 * component) so this plugin doesn't need to import host-internal
 * surfaces. The class names mirror the host's status-bar typography
 * conventions; if those change we can revisit.
 */
export function VimModeStatusItem() {
  const enabled = useDb(root => root.app.settings.vimMode)
  const mode = useActiveVimMode()
  const client = useDbClient()

  const toggle = () => {
    client.update(root => {
      root.app.settings.vimMode = !root.app.settings.vimMode
    })
  }

  if (!enabled) {
    return (
      <div
        className={ITEM_CLASS}
        title="Vim mode off — click to enable"
        onClick={toggle}
      >
        <span className="tracking-wider">VIM OFF</span>
      </div>
    )
  }

  const activeMode = mode ?? "insert"
  return (
    <div
      className={ITEM_CLASS}
      title="Vim mode on — click to disable"
      onClick={toggle}
    >
      <span className="tracking-wider">{MODE_LABEL[activeMode]}</span>
    </div>
  )
}

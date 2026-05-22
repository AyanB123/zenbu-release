import { useDb, useDbClient } from "@zenbujs/core/react"
import { useActiveVimMode, type VimMode } from "@/lib/vim-mode-store"
import { StatusBarItem } from "./status-bar-item"

const MODE_LABEL: Record<VimMode, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  replace: "REPLACE",
}

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
      <StatusBarItem title="Vim mode off — click to enable" onClick={toggle}>
        <span className="tracking-wider">VIM OFF</span>
      </StatusBarItem>
    )
  }

  const activeMode = mode ?? "insert"
  return (
    <StatusBarItem title="Vim mode on — click to disable" onClick={toggle}>
      <span className="tracking-wider">
        {MODE_LABEL[activeMode]}
      </span>
    </StatusBarItem>
  )
}

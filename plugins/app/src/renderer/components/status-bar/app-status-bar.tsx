import type { ComponentType } from "react"
import { useFunctions } from "@zenbujs/core/react"
import { ChatStatsStatusItem } from "./chat-stats-status-item"
import { ScopeInfoStatusItem } from "./scope-info-status-item"
import { StatusBar } from "./status-bar"

export type AppStatusBarProps = {
  /** Session driving the stats line. Threaded down from the owning
   * `ChatPane` so each pane's status bar reflects *its own* chat,
   * not whichever pane is window-active. */
  sessionId: string | null
}

/**
 * The right-side status-bar slot is an open extension point: any
 * plugin can drop a React component there by registering it under
 * `meta.kind = "status-bar.right-item"` in the function registry.
 * The vim-mode item lives in the `cm-vim` plugin and arrives via
 * that seam.
 */
export function AppStatusBar({ sessionId }: AppStatusBarProps) {
  const rightItems = useFunctions<ComponentType>({
    kind: "status-bar.right-item",
  })
  return (
    <StatusBar
      left={
        <>
          <ScopeInfoStatusItem sessionId={sessionId} />
          <ChatStatsStatusItem sessionId={sessionId} />
        </>
      }
      right={
        <>
          {rightItems.map(entry => {
            const Item = entry.fn
            return <Item key={entry.name} />
          })}
        </>
      }
    />
  )
}

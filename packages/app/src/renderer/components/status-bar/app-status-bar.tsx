import { ChatStatsStatusItem } from "./chat-stats-status-item"
import { StatusBar } from "./status-bar"
import { VimModeStatusItem } from "./vim-mode-status-item"

export type AppStatusBarProps = {
  /** Session driving the stats line. Threaded down from the owning
   * `ChatPane` so each pane's status bar reflects *its own* chat,
   * not whichever pane is window-active. */
  sessionId: string | null
}

export function AppStatusBar({ sessionId }: AppStatusBarProps) {
  return (
    <StatusBar
      left={<ChatStatsStatusItem sessionId={sessionId} />}
      right={<VimModeStatusItem />}
    />
  )
}

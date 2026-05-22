import { useCallback, useMemo, useRef, useState } from "react"
import type { MaterializedMessage } from "./lib/materialized-message"
import { useWindowedItems } from "./lib/use-windowed-items"
import { FindInChat } from "./find-in-chat"
import { Minimap } from "./minimap"
import { defaultMessageComponents } from "./messages"
import {
  MessageList,
  type LoadingStats,
  type MessageListHandle,
  type ScrollMetrics,
} from "./message-list"
import type { MessageComponents } from "./message-components"

export type ChatDisplayProps = {
  messages: MaterializedMessage[]
  streaming: boolean
  /** Live token / elapsed counters shown in the streaming footer.
   * Owned by chat-pane (it has the session + stats); chat-display
   * just forwards. */
  loadingStats: LoadingStats
  components?: Partial<MessageComponents>
  onPermissionSelect?: (requestId: string, optionId: string | "__cancel__") => void
  /** Fired when the user submits an in-place edit of a past user
   * message bubble. Forwarded into MessageList → UserMessage. */
  onEditSubmit?: (args: {
    userMessageIndex: number
    text: string
    displayText: string
    choice: import("./lib/branch-summary-choice").BranchSummaryChoice
  }) => void
  /** Fired when the user reverts to a past user message bubble. */
  onRevertSubmit?: (args: {
    userMessageIndex: number
    choice: import("./lib/branch-summary-choice").BranchSummaryChoice
  }) => void
  scrollToBottomRef?: React.MutableRefObject<(() => void) | null>
  initialWindow?: number
  batchSize?: number
}

export function ChatDisplay({
  messages: allMessages,
  streaming,
  loadingStats,
  components,
  onPermissionSelect,
  onEditSubmit,
  onRevertSubmit,
  scrollToBottomRef,
  initialWindow = 50,
  batchSize = 50,
}: ChatDisplayProps) {
  const mergedComponents = useMemo<MessageComponents>(
    () => ({ ...defaultMessageComponents, ...components }),
    [components],
  )

  const {
    items: messages,
    hasMoreBefore,
    hasMoreAfter,
    loadOlder,
    loadNewer,
    freezeTail,
    resumeTail,
  } = useWindowedItems({
    items: allMessages,
    initialWindow,
    batchSize,
  })

  const listRef = useRef<MessageListHandle>(null)
  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics | null>(null)

  if (scrollToBottomRef) {
    scrollToBottomRef.current = () => {
      resumeTail()
      listRef.current?.forceScrollToBottom()
    }
  }

  const scrollElRef = useMemo<React.RefObject<HTMLDivElement | null>>(
    () => ({
      get current() {
        return listRef.current?.getScrollElement() ?? null
      },
      set current(_) {},
    }),
    [],
  )

  const handleScrollTo = useCallback((scrollTop: number) => {
    listRef.current?.scrollTo(scrollTop)
  }, [])

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <FindInChat scrollRef={scrollElRef} contentVersion={messages.length} />
      <MessageList
        ref={listRef}
        messages={messages}
        loading={streaming}
        loadingStats={loadingStats}
        components={mergedComponents}
        onScrollMetrics={setScrollMetrics}
        hasMoreAbove={hasMoreBefore}
        hasMoreBelow={hasMoreAfter}
        onLoadOlder={loadOlder}
        onLoadNewer={loadNewer}
        onDetachedFromBottom={freezeTail}
        onReachedBottom={resumeTail}
        onPermissionSelect={onPermissionSelect}
        onEditSubmit={onEditSubmit}
        onRevertSubmit={onRevertSubmit}
      />
      <Minimap scrollMetrics={scrollMetrics} onScrollTo={handleScrollTo} />
    </div>
  )
}

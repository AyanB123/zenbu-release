import { useRef } from "react"
import { ArrowUpDownIcon } from "lucide-react"
import { useDb, useDbClient, useRpc } from "@zenbujs/core/react"
import { Button } from "@/components/ui/button"

/**
 * Sidebar footer control for choosing the sort key used to order
 * chat rows in the agent sidebar. Persisted in the global settings
 * record so the choice survives reloads and rides the replica
 * everywhere.
 *
 * Renders as a single icon button intended to live inside the
 * sidebar's `SidebarFooter` slot. Pops a native Electron menu so
 * it matches the rest of the app's context menus.
 */
export type ChatSortKey = "created" | "lastMessage"

const OPTIONS: { id: ChatSortKey; label: string; hint: string }[] = [
  { id: "lastMessage", label: "Recent activity", hint: "Last message sent" },
  { id: "created", label: "Date created", hint: "When the chat was opened" },
]

export function ChatSortMenu() {
  const sort = useDb(root => root.app.settings.sidebarChatSort)
  const dbClient = useDbClient()
  const rpc = useRpc()
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleClick = async () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    // Anchor to the top edge of the button so the menu pops up above
    // the sidebar footer rather than overlapping the trigger.
    const x = rect ? Math.round(rect.left) : undefined
    const y = rect ? Math.round(rect.top) : undefined
    const { chosenId } = await rpc.app.contextMenu.show({
      x,
      y,
      items: OPTIONS.map(opt => ({
        type: "checkbox" as const,
        id: opt.id,
        label: opt.label,
        sublabel: opt.hint,
        checked: opt.id === sort,
      })),
    })
    if (!chosenId) return
    const next = chosenId as ChatSortKey
    void dbClient.update(root => {
      root.app.settings.sidebarChatSort = next
    })
  }

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="icon-xs"
      className="hg-icon size-[22px] rounded bg-transparent text-muted-foreground hover:bg-transparent"
      aria-label="Sort chats"
      title="Sort chats"
      onClick={handleClick}
    >
      <ArrowUpDownIcon size={13} />
    </Button>
  )
}

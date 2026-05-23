import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type NewChatSplitButtonProps = {
  onNewChat: () => void
  onCreateWorktree?: () => void
  /** Optional. When provided, the dropdown shows an "Import
   * Worktrees" item that creates a placeholder chat for every
   * worktree of the active repo that doesn't already have one,
   * making them all appear as groups in the sidebar. */
  onImportWorktrees?: () => void
  /** Optional. When provided (sentinel workspace only), the
   * dropdown shows a "Create Plugin" item that opens the new-plugin
   * dialog. We surface it only on the sentinel workspace because
   * plugin worktrees only make sense relative to the app's own
   * source tree. */
  onCreatePlugin?: () => void
  /** Optional ⌘N-style shortcut hint shown under "New Chat" in the dropdown. */
  newChatShortcut?: string
}

/**
 * Split button rendered at the top of the agent sidebar.
 *
 * The big left half is the primary "New Chat" action. The thin right
 * half opens a dropdown that exposes secondary actions — currently
 * "New Chat" (for completeness / muscle memory) and "Create
 * Worktree", which mirrors the same action available from the
 * worktree-list panel.
 */
export function NewChatSplitButton({
  onNewChat,
  onCreateWorktree,
  onImportWorktrees,
  onCreatePlugin,
  newChatShortcut,
}: NewChatSplitButtonProps) {
  return (
    <div
      className={cn(
        "flex w-full items-stretch overflow-hidden rounded-md",
        "border border-border bg-input/40 text-sidebar-foreground",
        "shadow-xs",
      )}
    >
      <button
        type="button"
        onClick={onNewChat}
        className={cn(
          "flex h-7 flex-1 items-center justify-center px-2 text-[12px] font-medium",
          "transition-colors hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        New Chat
      </button>
      <div
        aria-hidden
        className="w-px self-stretch bg-border"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More chat options"
            className={cn(
              "flex h-7 w-7 items-center justify-center text-muted-foreground",
              "transition-colors hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <ChevronDownIcon />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem onSelect={onNewChat}>
            <span className="flex-1">New Chat</span>
            {newChatShortcut && (
              <span className="ml-3 text-[11px] text-muted-foreground">
                {newChatShortcut}
              </span>
            )}
          </DropdownMenuItem>
          {onCreateWorktree && (
            <DropdownMenuItem onSelect={onCreateWorktree}>
              Create Worktree
            </DropdownMenuItem>
          )}
          {onImportWorktrees && (
            <DropdownMenuItem onSelect={onImportWorktrees}>
              Import Worktrees
            </DropdownMenuItem>
          )}
          {onCreatePlugin && (
            <DropdownMenuItem onSelect={onCreatePlugin}>
              Create Plugin
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

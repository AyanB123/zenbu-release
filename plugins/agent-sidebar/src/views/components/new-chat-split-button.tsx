import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@zenbu/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type NewChatSplitButtonProps = {
  onNewChat: () => void
  onCreateWorktree?: () => void
  /**
   * Which action is primary (the big left button). Currently only
   * `"new-chat"` is supported; the prop is retained so callers
   * have a single place to set the priority if more primaries are
   * added later.
   */
  primaryAction?: "new-chat"
}

/**
 * Split button rendered at the top of the agent sidebar.
 *
 * The big left half is "New Chat". The thin right half opens a
 * dropdown that exposes secondary actions — currently just
 * "Create Worktree". ("Import Worktrees…" used to live here too;
 * it now lives on the command palette, registered by
 * `AgentSidebarActionsService`.)
 */
export function NewChatSplitButton({
  onNewChat,
  onCreateWorktree,
}: NewChatSplitButtonProps) {
  return (
    <div
      className={cn(
        "flex w-full items-stretch overflow-hidden rounded-md",
        "border border-border bg-background/40 text-sidebar-foreground transition-colors hover:bg-background/70",
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
            aria-label="More options"
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
          {onCreateWorktree && (
            <DropdownMenuItem onSelect={() => onCreateWorktree()}>
              Create Worktree
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

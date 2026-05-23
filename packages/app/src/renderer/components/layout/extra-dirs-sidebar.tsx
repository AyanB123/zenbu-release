import { useCallback, useMemo } from "react"
import { useDb, useDbClient, useRpc } from "@zenbujs/core/react"
import { useActiveScopeId } from "@/lib/window-state"

/**
 * Sidebar body for the "Extra directories" left-sidebar tab.
 *
 * Lists `scope.extraDirectories` for the currently-active scope (the
 * worktree the user is chatting against). Each entry uses the same
 * `SidebarRow` component the chat list / pi-sessions list use so the
 * three tabs feel identical in spacing, hover, and active treatment.
 *
 * Row actions live behind a single "\u2026" hover button that opens a
 * context menu. We deliberately don't fan three icons across the
 * right edge: only one of them (Remove) is destructive, and the
 * other two (Reveal, Copy path) are infrequent enough that a menu
 * keeps the row visually quiet at rest while still being one click
 * away from the action. Mirrors how the chat-row "More" button
 * surfaces session actions.
 *
 * Menu items:
 *   - "Reveal in file browser" \u2014 opens the path in the OS file
 *      browser via `DialogService.openInFileBrowser`. Uses
 *      `shell.openPath` (open the dir itself) rather than
 *      `showItemInFolder` (highlight inside parent) to match how
 *      the user thinks about a directory: "show me what's inside".
 *   - "Copy path" \u2014 writes the absolute path to the clipboard.
 *   - "Remove from session" \u2014 splices the path out of
 *      `scope.extraDirectories`. `SessionsService`'s scopes-
 *      subscription picks the change up, reloads the resource
 *      loader, and sends a quiet aside to pi so the agent learns
 *      the dir is gone.
 *
 * Empty + no-scope states are explicit so the tab never looks like
 * a missing feature.
 */
export function ExtraDirsSidebar() {
  const activeScopeId = useActiveScopeId()
  const dirs = useDb(root => {
    if (!activeScopeId) return null
    const scope = root.app.scopes[activeScopeId]
    if (!scope) return null
    return scope.extraDirectories
  })
  const dbClient = useDbClient()
  const rpc = useRpc()

  // Stable list reference for keys / rendering. We render in array
  // order so add/remove animations match what the user clicked.
  const rows = useMemo(() => dirs ?? [], [dirs])

  const handleRemove = useCallback(
    async (dir: string) => {
      if (!activeScopeId) return
      await dbClient.update(root => {
        const scope = root.app.scopes[activeScopeId]
        if (!scope) return
        scope.extraDirectories = scope.extraDirectories.filter(d => d !== dir)
      })
    },
    [activeScopeId, dbClient],
  )

  const handleReveal = useCallback(
    async (dir: string) => {
      try {
        const { error } = await rpc.app.dialog.openInFileBrowser({ path: dir })
        if (error) console.warn("[extra-dirs] openInFileBrowser:", error)
      } catch (err) {
        console.warn("[extra-dirs] openInFileBrowser threw:", err)
      }
    },
    [rpc],
  )

  const handleCopyPath = useCallback(async (dir: string) => {
    try {
      await navigator.clipboard.writeText(dir)
    } catch (err) {
      console.warn("[extra-dirs] clipboard.writeText failed:", err)
    }
  }, [])

  const handleAdd = useCallback(async () => {
    if (!activeScopeId) return
    try {
      const result = await rpc.app.dialog.pickFolder()
      if (result.cancelled) return
      const picked = result.path
      await dbClient.update(root => {
        const scope = root.app.scopes[activeScopeId]
        if (!scope) return
        // Reject duplicates (would no-op on the subscription side
        // anyway, but better to short-circuit here so the UI doesn't
        // flicker) and silently reject the scope's own primary
        // directory (it's already the cwd).
        if (scope.extraDirectories.includes(picked)) return
        if (scope.directory === picked) return
        scope.extraDirectories = [...scope.extraDirectories, picked]
      })
    } catch (err) {
      console.warn("[extra-dirs] pickFolder failed:", err)
    }
  }, [activeScopeId, dbClient, rpc])

  if (!activeScopeId) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
        Open a chat to see its extra directories.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="px-2 pt-2 pb-1">
        <div className="text-[12px] font-medium text-foreground">
          Extra directories
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map(dir => (
          <ExtraDirRow
            key={dir}
            path={dir}
            onOpenMenu={async e => {
              const rect = (
                e.currentTarget as HTMLButtonElement
              ).getBoundingClientRect()
              const { chosenId } = await rpc.app.contextMenu.show({
                x: Math.round(rect.right),
                y: Math.round(rect.bottom),
                items: [
                  {
                    id: "reveal",
                    label: "Reveal in file browser",
                    enabled: true,
                  },
                  {
                    id: "copy",
                    label: "Copy path",
                    enabled: true,
                  },
                  { type: "separator" },
                  {
                    id: "remove",
                    label: "Remove from session",
                    enabled: true,
                  },
                ],
              })
              if (chosenId === "reveal") {
                void handleReveal(dir)
              } else if (chosenId === "copy") {
                void handleCopyPath(dir)
              } else if (chosenId === "remove") {
                void handleRemove(dir)
              }
            }}
          />
        ))}
        <AddDirRow onClick={handleAdd} />
      </div>
    </div>
  )
}

/**
 * Last row in the extra-dirs list: an explicit "+ Add directory"
 * affordance that matches the visual footprint of the existing
 * directory rows (same height, same rounded border) so the list
 * reads as one continuous stack. Dashed border + muted text make
 * it clear this is an action, not a directory entry. The whole row
 * is clickable (unlike the directory rows, which are click-inert
 * with the menu behind the `\u2026` button) because there is no
 * ambiguity \u2014 there's only one possible action.
 */
function AddDirRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hg-row group relative flex min-h-[30px] min-w-0 cursor-default select-none items-center gap-2 overflow-hidden rounded-md border border-dashed border-border/60 py-1.5 pl-1.5 pr-2 text-[13px] text-muted-foreground hover:border-border"
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <PlusIcon />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">Add directory</span>
    </button>
  )
}

/**
 * Minimal row \u2014 deliberately *not* `<SidebarRow>` because that
 * component carries the `.hg-row` class whose `:hover` rule paints
 * `var(--accent)` across the whole row. That hover paint implies
 * the row body is clickable, and here it isn't (only the `\u2026`
 * button is). So we render a bare row with the same dimensions /
 * padding as the chat rows but no hover background. The `group`
 * class is still here so the `\u2026` button can use
 * `group-hover:opacity-100` to fade in on row hover.
 */
function ExtraDirRow({
  path,
  onOpenMenu,
}: {
  path: string
  onOpenMenu: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <div className="group relative flex min-h-[30px] min-w-0 items-center gap-2 overflow-hidden rounded-md border border-border/60 bg-foreground/[0.025] py-1.5 pl-1.5 pr-2 text-muted-foreground">
      <span className="min-w-0 flex-1 truncate text-[13px]" title={path}>
        {basename(path) || path}
      </span>
      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
        <RowActionButton title="Actions" onClick={onOpenMenu}>
          <MoreIcon />
        </RowActionButton>
      </span>
    </div>
  )
}

/**
 * Mirror of `agent-sidebar-pane`'s `ChatRowActionButton`. Kept local
 * to avoid reaching across the sidebar boundary for a 12-line
 * button \u2014 if a third caller shows up we'll hoist it into a shared
 * `sidebar-row-action.tsx`.
 */
function RowActionButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={e => {
        e.stopPropagation()
        onClick(e)
      }}
      onMouseDown={e => e.stopPropagation()}
      className="flex h-[20px] w-[20px] items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
    >
      {children}
    </button>
  )
}

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "")
  const idx = trimmed.lastIndexOf("/")
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  )
}

import { useCallback, useMemo, useState } from "react"
import { useDb, useRpc } from "@zenbujs/core/react"
import { ChevronRight, FilePlus, FolderOpen } from "lucide-react"
import { Button } from "@zenbu/ui/button"
import { useCreateWorkspaceFromDirectory } from "../hooks/use-create-workspace"
import type { Schema } from "../../main/schema"

type Busy = null | "open" | "new" | { kind: "recent"; id: string }

/**
 * Sanitize what the user types into the project-name field as they
 * type it. Replace runs of whitespace with a single hyphen so a
 * space immediately becomes the conventional separator, and
 * collapse adjacent dashes so a typo like "my -app" still reads
 * as "my-app". Leading hyphens are preserved on partial input
 * (the user might still be typing) but the create handler trims
 * them before hitting the filesystem.
 */
function normalizeProjectName(raw: string): string {
  return raw.replace(/\s+/g, "-").replace(/-{2,}/g, "-")
}
type Mode = "choose" | "new"

type RecentProject = Schema["recentProjects"][string]

// Capped low on purpose: the whole onboarding screen has to fit
// without scrolling at normal window sizes. The user can reach
// older projects through "Open project".
const RECENT_LIMIT = 8

export function EmptyWorkspaceScreen() {
  const rpc = useRpc()
  const createWorkspaceFromDirectory = useCreateWorkspaceFromDirectory()
  const [mode, setMode] = useState<Mode>("choose")
  // Just the project name (last path segment). The parent directory
  // is hidden behind "Advanced" so the common case is a single field.
  const [newName, setNewName] = useState("")
  // Defaults to `~/projects`. The main process resolves `~` when
  // actually creating the directory.
  const [newParent, setNewParent] = useState("projects")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)

  // `RecentProjectsService` (main process) populates this on every
  // boot by scanning VS Code / Cursor / Windsurf / Antigravity /
  // Trae caches under `~/Library/Application Support/...`. The
  // record is keyed by sha1(path) and pre-sorted by lastOpenedAt
  // descending; we still re-sort here so the renderer doesn't
  // assume insertion order.
  const recentsRecord = useDb(root => root.app.recentProjects)
  // Filter out projects the user is already using as a workspace
  // (matching any of the workspace's scope directories). No point
  // showing "Open project: foo" when the foo workspace is right
  // there in the rail.
  const existingDirs = useDb(root => {
    const dirs = new Set<string>()
    for (const scope of Object.values(root.app.scopes)) {
      // Archived scopes are soft-hidden from the sidebar/rail,
      // so let their directories re-appear in "Open recent" —
      // picking one will un-archive the matching scope (see
      // `useImportWorktrees` / the create-worktree helper) so
      // the user has an easy path back in.
      if (!scope.archived) {
        dirs.add(scope.directory)
      }
    }
    return dirs
  })
  const homeDir = useDb(root => root.app.env.homeDir)
  const recents = useMemo<RecentProject[]>(() => {
    return Object.values(recentsRecord)
      .filter(r => !existingDirs.has(r.path))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, RECENT_LIMIT)
  }, [recentsRecord, existingDirs])

  const handleOpenProject = useCallback(async () => {
    if (busy) return
    setError(null)
    // The native folder picker is modal on its own, so don't flip
    // `busy` until the user has actually picked a path. Otherwise
    // the whole onboarding screen dims while they're still in the
    // OS dialog, which feels janky.
    try {
      const picked = await rpc.app.dialog.pickFolder()
      if (picked.cancelled) return
      setBusy("open")
      await createWorkspaceFromDirectory(picked.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [busy, rpc, createWorkspaceFromDirectory])

  const handleCreateEmpty = useCallback(async () => {
    if (busy) return
    const name = newName.trim().replace(/^\/+/, "").replace(/\/+$/, "")
    if (!name) {
      setError("Enter a project name")
      return
    }
    const parent = newParent.trim().replace(/^\/+/, "").replace(/\/+$/, "")
    const relative = parent ? `${parent}/${name}` : name
    setError(null)
    setBusy("new")
    try {
      const result = await rpc.app.repos.createEmptyProject({
        relativePath: "~/" + relative,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      await createWorkspaceFromDirectory(result.directory)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [busy, newName, newParent, rpc, createWorkspaceFromDirectory])

  const handleOpenRecent = useCallback(
    async (project: RecentProject) => {
      if (busy) return
      setError(null)
      setBusy({ kind: "recent", id: project.id })
      try {
        await createWorkspaceFromDirectory(project.path)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [busy, createWorkspaceFromDirectory],
  )

  const goBack = useCallback(() => {
    if (busy !== null) return
    setError(null)
    setMode("choose")
  }, [busy])

  return (
    <div className="flex h-full w-full items-start justify-center overflow-hidden border-t border-b border-l bg-background px-10 pt-[14vh] pb-10">
      <div className="flex w-full max-w-[560px] flex-col gap-8">
        {mode === "choose" ? (
          <>
            <Section>
              <ActionList>
                <ActionRow
                  icon={<FilePlus className="h-[18px] w-[18px]" strokeWidth={1.5} />}
                  title="New project"
                  disabled={busy !== null}
                  onClick={() => {
                    setError(null)
                    setMode("new")
                  }}
                />
                <ActionRow
                  icon={<FolderOpen className="h-[18px] w-[18px]" strokeWidth={1.5} />}
                  title="Open folder"
                  disabled={busy !== null}
                  onClick={handleOpenProject}
                />
              </ActionList>
            </Section>

            {recents.length > 0 && (
              <Section title="Recent">
                <RecentProjectsList
                  recents={recents}
                  homeDir={homeDir}
                  busy={busy}
                  onOpen={handleOpenRecent}
                />
              </Section>
            )}
          </>
        ) : (
          <Section title="New project">
            <input
              autoFocus
              placeholder="my-app"
              value={newName}
              // Project names map to directory names. Spaces in
              // directory names are valid but a constant source of
              // shell-quoting bugs across the agent flow (git, pi,
              // and the various tool-call wrappers all treat a
              // space-containing path as multiple args unless the
              // caller remembers to quote). Auto-converting the
              // space the user just typed into a hyphen mirrors
              // the convention every Git host (`new-repo`) and
              // every package registry (`my-app`) already uses.
              // Collapsing runs of whitespace + dashes keeps a
              // fast-typed "my  cool   app" from becoming
              // `my--cool---app`.
              onChange={e => setNewName(normalizeProjectName(e.target.value))}
              onKeyDown={e => {
                if (e.key === "Enter") void handleCreateEmpty()
                if (e.key === "Escape") goBack()
              }}
              disabled={busy !== null}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="h-11 w-full rounded-md border border-input bg-transparent px-3.5 text-[14px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <AdvancedDisclosure
              open={advancedOpen}
              onToggle={() => setAdvancedOpen(o => !o)}
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-muted-foreground">
                  Parent folder
                </span>
                <PathInput
                  prefix="~/"
                  value={newParent}
                  onChange={setNewParent}
                  placeholder="projects"
                  disabled={busy !== null}
                  onSubmit={handleCreateEmpty}
                  onCancel={goBack}
                />
              </label>
            </AdvancedDisclosure>
            <FormActions
              // Label stays constant during submit; the button's
              // own `disabled` styling (dimmer + no-cursor) is the
              // loading affordance. Swapping the text to
              // "Creating…" shifts the button width and nudges the
              // adjacent Cancel — a layout flicker on a click the
              // user just made, which reads as the UI breaking
              // rather than reacting.
              primaryLabel="Create project"
              primaryDisabled={busy !== null || newName.trim().length === 0}
              onPrimary={handleCreateEmpty}
              onCancel={goBack}
              cancelDisabled={busy !== null}
            />
          </Section>
        )}

        {error ? (
          <div className="text-[12px] text-destructive">{error}</div>
        ) : null}
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      {title ? (
        <h2 className="px-0.5 text-[15px] font-semibold text-foreground">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  )
}

function AdvancedDisclosure({
  open,
  onToggle,
  children,
}: {
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-fit items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform ${
            open ? "rotate-90" : ""
          }`}
          strokeWidth={2}
        />
        Advanced
      </button>
      {open ? <div className="flex flex-col gap-2">{children}</div> : null}
    </div>
  )
}

function ActionList({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card/40 divide-y divide-border/60">
      {children}
    </div>
  )
}

function ActionRow({
  icon,
  title,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="flex shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover:text-foreground">
        {icon}
      </span>
      <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
        {title}
      </span>
    </button>
  )
}

function PathInput({
  prefix,
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  prefix: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex h-9 w-full items-stretch rounded-md border border-input bg-transparent focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
      <span className="flex items-center pl-3 pr-1 text-[13px] text-muted-foreground select-none">
        {prefix}
      </span>
      <input
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") onSubmit()
          if (e.key === "Escape") onCancel()
        }}
        disabled={disabled}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="h-full min-w-0 flex-1 rounded-r-md bg-transparent pr-3 text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  )
}

function FormActions({
  primaryLabel,
  primaryDisabled,
  onPrimary,
  onCancel,
  cancelDisabled,
}: {
  primaryLabel: string
  primaryDisabled: boolean
  onPrimary: () => void
  onCancel: () => void
  cancelDisabled: boolean
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
      >
        {primaryLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={onCancel}
        disabled={cancelDisabled}
      >
        Cancel
      </Button>
    </div>
  )
}

function RecentProjectsList({
  recents,
  homeDir,
  busy,
  onOpen,
}: {
  recents: RecentProject[]
  homeDir: string | null
  busy: Busy
  onOpen: (project: RecentProject) => void
}) {
  const someBusy = busy !== null
  const busyId = typeof busy === "object" && busy?.kind === "recent" ? busy.id : null
  return (
    <ul className="flex flex-col gap-0.5">
      {recents.map(project => (
        <li key={project.id}>
          <RecentProjectRow
            project={project}
            homeDir={homeDir}
            disabled={someBusy && busyId !== project.id}
            busy={busyId === project.id}
            onClick={() => onOpen(project)}
          />
        </li>
      ))}
    </ul>
  )
}

function RecentProjectRow({
  project,
  homeDir,
  disabled,
  busy,
  onClick,
}: {
  project: RecentProject
  homeDir: string | null
  disabled: boolean
  busy: boolean
  onClick: () => void
}) {
  // Collapse $HOME → ~ for display only. Leaves anything outside
  // $HOME as an absolute path so e.g. /tmp / network mounts read
  // naturally.
  const display =
    homeDir && project.path.startsWith(homeDir + "/")
      ? "~" + project.path.slice(homeDir.length)
      : project.path
  // The path looks much cleaner without the project name appended
  // at the end, since we already render that on the left.
  const parentPath = (() => {
    const idx = display.lastIndexOf("/")
    if (idx <= 0) return display
    return display.slice(0, idx)
  })()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="group flex w-full items-baseline gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none disabled:opacity-40"
    >
      <span className="shrink-0 truncate text-[13px] text-foreground/90 group-hover:text-foreground">
        {project.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
        {parentPath}
      </span>
    </button>
  )
}


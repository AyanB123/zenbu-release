import { useCallback, useState } from "react"
import { ArrowLeftIcon, FolderOpenIcon, GitBranchIcon } from "lucide-react"
import { useRpc } from "@zenbujs/core/react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { useCreateWorkspaceFromDirectory } from "../hooks/use-create-workspace"

type Busy = null | "open" | "url"

export function EmptyWorkspaceScreen() {
  const rpc = useRpc()
  const createWorkspaceFromDirectory = useCreateWorkspaceFromDirectory()
  const [mode, setMode] = useState<"choose" | "url">("choose")
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)

  const handleOpenProject = useCallback(async () => {
    if (busy) return
    setError(null)
    setBusy("open")
    try {
      const picked = await rpc.app.dialog.pickFolder()
      if (picked.cancelled) return
      await createWorkspaceFromDirectory(picked.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [busy, rpc, createWorkspaceFromDirectory])

  const handleCloneFromUrl = useCallback(async () => {
    if (busy) return
    const trimmed = url.trim()
    if (!trimmed) {
      setError("Enter a git URL")
      return
    }
    setError(null)
    setBusy("url")
    try {
      const picked = await rpc.app.dialog.pickFolder()
      if (picked.cancelled) {
        setBusy(null)
        return
      }
      const result = await rpc.app.repos.cloneFromUrl({
        url: trimmed,
        parentDir: picked.path,
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
  }, [busy, url, rpc, createWorkspaceFromDirectory])

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto border-t border-b border-l bg-background px-8 py-12">
      <div className="flex w-full max-w-[520px] flex-col gap-4">
        {mode === "choose" ? (
          <div className="grid grid-cols-2 gap-3">
            <ChoiceCard
              icon={<FolderOpenIcon />}
              title="Open project"
              disabled={busy !== null}
              onClick={handleOpenProject}
            />
            <ChoiceCard
              icon={<GitBranchIcon />}
              title="Clone GitHub repo"
              disabled={busy !== null}
              onClick={() => {
                setError(null)
                setMode("url")
              }}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setError(null)
                  setMode("choose")
                }}
                disabled={busy !== null}
                aria-label="Back"
              >
                <ArrowLeftIcon />
              </Button>
              <div className="text-sm font-medium">Clone GitHub repo</div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Input
                autoFocus
                placeholder="https://github.com/owner/repo.git"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") void handleCloneFromUrl()
                  if (e.key === "Escape" && busy === null) {
                    setError(null)
                    setMode("choose")
                  }
                }}
                disabled={busy !== null}
              />
              <Button
                size="sm"
                onClick={handleCloneFromUrl}
                disabled={busy !== null || url.trim().length === 0}
              >
                {busy === "url" ? "Cloning…" : "Clone"}
              </Button>
            </div>
          </div>
        )}
        {error ? (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ChoiceCard({
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
      className="group flex h-28 flex-col items-start justify-between rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex size-8 items-center justify-center rounded-md bg-muted text-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="text-sm font-medium">{title}</span>
    </button>
  )
}

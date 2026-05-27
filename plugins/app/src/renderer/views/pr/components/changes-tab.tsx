import { useEffect, useMemo, useState } from "react"
import { Allotment } from "allotment"
import type { GitFileStatus, GitStatus } from "../types"
import { ChangesFileList } from "./changes-file-list"
import { DiffViewer } from "./diff-viewer"
import { CommitForm } from "./commit-form"

/**
 * "Changes" tab — the day-to-day surface. Left pane lists modified
 * files with stage/unstage checkboxes, right pane shows the diff
 * for the currently selected file, bottom pane has the commit
 * composer.
 */
export function ChangesTab({
  directory,
  status,
  busy,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
}: {
  directory: string
  status: GitStatus | null
  busy: string | null
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (paths: string[]) => void
  onCommit: (message: string, body: string, onlyStaged: boolean) => void
}) {
  const files = status?.files ?? []

  // Track selection by path. Re-pick first file if the previous
  // selection vanished from the list (e.g. discarded).
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    if (selected && files.some(f => f.path === selected)) return
    setSelected(files[0]?.path ?? null)
  }, [files, selected])

  const activeFile = useMemo(
    () => files.find(f => f.path === selected) ?? null,
    [files, selected],
  )

  const stagedCount = files.filter(f => f.staged).length
  const onlyStaged = stagedCount > 0

  if (status == null) {
    return <Centered>Loading status…</Centered>
  }
  if (!status.isRepo) {
    return <Centered>This folder is not a git repository.</Centered>
  }

  return (
    <Allotment vertical>
      <Allotment.Pane minSize={120}>
        <Allotment>
          <Allotment.Pane preferredSize={300} minSize={200} maxSize={500}>
            <ChangesFileList
              files={files}
              selected={selected}
              onSelect={setSelected}
              onStage={onStage}
              onUnstage={onUnstage}
              onDiscard={onDiscard}
              disabled={!!busy}
            />
          </Allotment.Pane>
          <Allotment.Pane minSize={300}>
            <div className="relative h-full min-h-0">
              {activeFile ? (
                <DiffViewer
                  directory={directory}
                  file={activeFile}
                  staged={activeFile.staged && !activeFile.unstaged}
                />
              ) : (
                <Centered>
                  {files.length === 0
                    ? "No changes — working tree is clean."
                    : "Select a file to view its diff."}
                </Centered>
              )}
            </div>
          </Allotment.Pane>
        </Allotment>
      </Allotment.Pane>
      <Allotment.Pane preferredSize={170} minSize={120} maxSize={400}>
        <CommitForm
          onCommit={(msg, body) => onCommit(msg, body, onlyStaged)}
          disabled={!!busy}
          stagedCount={stagedCount}
          totalCount={files.length}
        />
      </Allotment.Pane>
    </Allotment>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
      {children}
    </div>
  )
}

// Help TS keep this exported even though it's only referenced once.
export type { GitFileStatus }

import { useMemo, useState } from "react"
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { GitFileStatus } from "../types"

/**
 * Compact, virtual-list-friendly list of changed files. Each row
 * has a stage checkbox (driven by the file's `staged` flag), the
 * file's status badge (M/A/D/R/U), the path, and a contextual menu
 * for discard.
 *
 * A header at the top toggles "stage all" so users can quickly
 * stage every file before committing.
 */
export function ChangesFileList({
  files,
  selected,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  disabled,
}: {
  files: GitFileStatus[]
  selected: string | null
  onSelect: (path: string) => void
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (paths: string[]) => void
  disabled?: boolean
}) {
  const [confirmDiscard, setConfirmDiscard] = useState<GitFileStatus | null>(
    null,
  )

  const stagedCount = useMemo(
    () => files.filter(f => f.staged).length,
    [files],
  )
  const allStaged = files.length > 0 && stagedCount === files.length
  const noneStaged = stagedCount === 0
  const headerState: boolean | "indeterminate" = allStaged
    ? true
    : noneStaged
      ? false
      : "indeterminate"

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-background">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b px-2 text-[11px] text-muted-foreground">
        <Checkbox
          checked={headerState}
          disabled={disabled || files.length === 0}
          onCheckedChange={value => {
            if (value === true) onStage(files.map(f => f.path))
            else onUnstage(files.map(f => f.path))
          }}
          className="size-3.5"
        />
        <span>
          {files.length === 0
            ? "No changes"
            : `${files.length} changed${stagedCount > 0 ? `, ${stagedCount} staged` : ""}`}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {files.map(file => {
          const active = file.path === selected
          return (
            <div
              key={file.path}
              data-active={active || undefined}
              className={cn(
                "group flex h-7 items-center gap-1.5 border-b border-transparent px-2 text-[12px]",
                active
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/40",
              )}
            >
              <Checkbox
                checked={file.staged && !file.unstaged ? true : file.staged ? "indeterminate" : false}
                disabled={disabled}
                onCheckedChange={value => {
                  if (value === true || value === "indeterminate") {
                    if (file.staged && !file.unstaged) onUnstage([file.path])
                    else onStage([file.path])
                  } else {
                    onUnstage([file.path])
                  }
                }}
                className="size-3.5 shrink-0"
              />
              <button
                type="button"
                onClick={() => onSelect(file.path)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <StatusBadge code={file.code} />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-mono text-[11.5px]",
                    file.code.includes("D") && "line-through opacity-70",
                  )}
                  title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                >
                  {prettyPath(file)}
                </span>
                {!file.binary && (file.additions > 0 || file.deletions > 0) && (
                  <span className="shrink-0 text-[10px] tabular-nums">
                    <span className="text-emerald-500">+{file.additions}</span>
                    <span className="ml-1 text-rose-500">−{file.deletions}</span>
                  </span>
                )}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                    <MoreHorizontalIcon className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-[12px]">
                  {file.staged ? (
                    <DropdownMenuItem onClick={() => onUnstage([file.path])}>
                      Unstage
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => onStage([file.path])}>
                      Stage
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmDiscard(file)}
                  >
                    Discard changes
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        })}
      </div>

      {confirmDiscard && (
        <DiscardConfirm
          file={confirmDiscard}
          onConfirm={() => {
            onDiscard([confirmDiscard.path])
            setConfirmDiscard(null)
          }}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
    </div>
  )
}

function prettyPath(file: GitFileStatus): string {
  if (file.oldPath && file.oldPath !== file.path) {
    return `${file.oldPath} → ${file.path}`
  }
  return file.path
}

function StatusBadge({ code }: { code: string }) {
  const { letter, tone, label } = describe(code)
  return (
    <span
      title={label}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-[9.5px] font-bold leading-none",
        tone,
      )}
    >
      {letter}
    </span>
  )
}

function describe(code: string): {
  letter: string
  label: string
  tone: string
} {
  if (code === "??") {
    return {
      letter: "U",
      label: "Untracked",
      tone: "bg-muted text-muted-foreground",
    }
  }
  const x = code[0]
  const y = code[1]
  const primary = x !== " " && x !== "?" ? x : y
  switch (primary) {
    case "A":
      return {
        letter: "A",
        label: "Added",
        tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      }
    case "M":
      return {
        letter: "M",
        label: "Modified",
        tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      }
    case "D":
      return {
        letter: "D",
        label: "Deleted",
        tone: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
      }
    case "R":
      return {
        letter: "R",
        label: "Renamed",
        tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
      }
    case "C":
      return {
        letter: "C",
        label: "Copied",
        tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
      }
    case "U":
      return {
        letter: "!",
        label: "Conflicted",
        tone: "bg-rose-500/30 text-rose-700 dark:text-rose-300",
      }
    default:
      return {
        letter: primary || "?",
        label: "Changed",
        tone: "bg-muted text-muted-foreground",
      }
  }
}

function DiscardConfirm({
  file,
  onConfirm,
  onCancel,
}: {
  file: GitFileStatus
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      role="dialog"
      className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4"
      onClick={onCancel}
    >
      <div
        className="w-[320px] rounded-md border bg-background p-3 shadow-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-1 text-[12px] font-medium">
          <ChevronRightIcon className="size-3 text-muted-foreground" />
          Discard changes
        </div>
        <p className="mb-3 text-[12px] text-muted-foreground">
          Permanently discard changes to{" "}
          <span className="font-mono">{file.path}</span>? This cannot be
          undone.
        </p>
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-1 text-[12px] hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-destructive px-2 py-1 text-[12px] font-medium text-destructive-foreground"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  )
}

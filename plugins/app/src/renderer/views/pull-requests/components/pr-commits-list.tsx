import { cn } from "@/lib/utils"
import type { GhCommit } from "../types"

/**
 * List of commits that would be included in the PR. Tracks the
 * currently-selected commit so the diff viewer can fetch its
 * patch lazily.
 *
 * Two variants:
 *   - `panel`  (default): standalone scrollable panel. Owns its
 *     own header + scroll. Used by the PR detail view in a split.
 *   - `inline`: lives inside a host scroll container. No own
 *     scroll, no own header. Used by the GitHub-style compose
 *     page where everything stacks in one column.
 */
export function PrCommitsList({
  commits,
  selected,
  onSelect,
  variant = "panel",
}: {
  commits: GhCommit[]
  selected: string | null
  onSelect: (sha: string) => void
  variant?: "panel" | "inline"
}) {
  if (variant === "inline") {
    return (
      <div className="flex flex-col bg-background">
        {commits.map(c => (
          <CommitRow
            key={c.sha}
            commit={c}
            active={c.sha === selected}
            onClick={() => onSelect(c.sha)}
          />
        ))}
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-background">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b px-3 text-[11px] text-muted-foreground">
        <span>{commits.length} {commits.length === 1 ? "commit" : "commits"}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {commits.map(c => (
          <CommitRow
            key={c.sha}
            commit={c}
            active={c.sha === selected}
            onClick={() => onSelect(c.sha)}
          />
        ))}
      </div>
    </div>
  )
}

function CommitRow({
  commit,
  active,
  onClick,
}: {
  commit: GhCommit
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-[12px] last:border-b-0",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {commit.subject || "(no message)"}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {commit.shortSha}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{commit.authorName}</span>
        <span>·</span>
        <span>{formatDate(commit.authorDate)}</span>
      </div>
    </button>
  )
}

function formatDate(ms: number): string {
  if (!ms) return ""
  const d = new Date(ms)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString()
}

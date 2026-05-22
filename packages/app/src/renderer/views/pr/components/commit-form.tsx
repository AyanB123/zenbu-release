import { useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Commit composer at the bottom of the Changes tab. Two inputs
 * (subject + optional body) and a single submit button. Disabled
 * until there's a non-empty subject.
 *
 * The parent decides whether the commit picks up staged-only or
 * all changes via the `onlyStaged` flag passed in `onCommit`.
 */
export function CommitForm({
  onCommit,
  disabled,
  stagedCount,
  totalCount,
}: {
  onCommit: (message: string, body: string) => void
  disabled?: boolean
  stagedCount: number
  totalCount: number
}) {
  const [message, setMessage] = useState("")
  const [body, setBody] = useState("")

  const canCommit =
    !disabled && message.trim().length > 0 && totalCount > 0

  const scope =
    stagedCount > 0
      ? `${stagedCount} staged file${stagedCount === 1 ? "" : "s"}`
      : totalCount > 0
        ? `all ${totalCount} change${totalCount === 1 ? "" : "s"}`
        : "nothing to commit"

  return (
    <form
      className="flex h-full min-h-0 flex-col gap-1.5 bg-background p-2"
      onSubmit={e => {
        e.preventDefault()
        if (!canCommit) return
        onCommit(message.trim(), body.trim())
        setMessage("")
        setBody("")
      }}
      onKeyDown={e => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCommit) {
          e.preventDefault()
          onCommit(message.trim(), body.trim())
          setMessage("")
          setBody("")
        }
      }}
    >
      <input
        value={message}
        onChange={e => setMessage(e.target.value)}
        disabled={disabled}
        placeholder="Summary (required)"
        className="rounded border bg-background px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        disabled={disabled}
        placeholder="Description (optional)"
        className="min-h-0 flex-1 resize-none rounded border bg-background px-2 py-1 font-mono text-[11.5px] outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          Will commit {scope}
        </span>
        <button
          type="submit"
          disabled={!canCommit}
          className={cn(
            "rounded px-3 py-1 text-[12px] font-medium",
            "bg-primary text-primary-foreground hover:opacity-90",
            "disabled:opacity-40",
          )}
        >
          Commit
        </button>
      </div>
    </form>
  )
}

import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

/**
 * The three pi-style options offered when navigating away from the
 * current branch:
 *
 *   - "none"          \u2014 just rewind, no summary entry
 *   - "default"       \u2014 use pi's built-in summarizer prompt
 *   - "custom"        \u2014 same, but the user provides extra prompt
 *
 * The dialog handles its own internal stage (pick option \u2192 maybe
 * type prompt) and reports back via `onConfirm` once the user has
 * finalized a choice.
 */
export type BranchSummaryChoice =
  | { kind: "none" }
  | { kind: "default" }
  | { kind: "custom"; customInstructions: string }

export type BranchSummaryDialogProps = {
  open: boolean
  /** Optional one-line preview of the entry the user is navigating
   * to. Surfaces in the dialog body so they can see what they're
   * branching from. */
  targetLabel?: string | null
  /** True while the navigate+summarize RPC is in flight. The dialog
   * stays open and shows a "Summarizing…" indicator; we don't allow
   * close-by-overlay-click or another option to be picked mid-call. */
  busy?: boolean
  onConfirm: (choice: BranchSummaryChoice) => void
  onCancel: () => void
}

/**
 * Mirrors pi's "Summarize branch?" prompt as a small modal. Two
 * stages: pick one of three options, then \u2014 only for "custom" \u2014
 * supply additional prompt text for the summarizer.
 */
export function BranchSummaryDialog({
  open,
  targetLabel,
  busy = false,
  onConfirm,
  onCancel,
}: BranchSummaryDialogProps) {
  const [stage, setStage] = useState<"choose" | "custom">("choose")
  const [customText, setCustomText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reset internal state whenever the dialog reopens. Without this,
  // a previous "custom" entry would still be sitting in the textarea
  // the next time the user navigates somewhere.
  useEffect(() => {
    if (!open) return
    setStage("choose")
    setCustomText("")
  }, [open])

  useEffect(() => {
    if (stage !== "custom") return
    // Defer to next tick so the textarea is actually mounted before
    // we try to focus it (radix mounts on open).
    const id = window.setTimeout(() => textareaRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [stage])

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (busy) return // can't dismiss while summarization is mid-flight
        if (!next) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Summarize branch?</DialogTitle>
        </DialogHeader>
        {targetLabel ? (
          <div className="text-[11px] text-muted-foreground">
            Navigating to:{" "}
            <span className="font-mono text-foreground">{targetLabel}</span>
          </div>
        ) : null}
        {busy ? (
          <BusyStage />
        ) : stage === "choose" ? (
          <ChooseStage
            onPick={choice => {
              if (choice === "custom") {
                setStage("custom")
                return
              }
              onConfirm({ kind: choice === "default" ? "default" : "none" })
            }}
            onCancel={onCancel}
          />
        ) : (
          <CustomStage
            textareaRef={textareaRef}
            value={customText}
            onChange={setCustomText}
            onBack={() => setStage("choose")}
            onSubmit={() =>
              onConfirm({
                kind: "custom",
                customInstructions: customText.trim(),
              })
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function BusyStage() {
  return (
    <div className="flex items-center gap-2 py-3 text-[12px] text-muted-foreground">
      <span className="text-shimmer">Summarizing…</span>
    </div>
  )
}

function ChooseStage({
  onPick,
  onCancel,
}: {
  onPick: (choice: "none" | "default" | "custom") => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <OptionRow
        title="No summary"
        description="Just rewind. Nothing gets persisted about the abandoned branch."
        onClick={() => onPick("none")}
      />
      <OptionRow
        title="Summarize"
        description="Ask the current model to capture the abandoned path so the agent has context when re-entering this branch."
        onClick={() => onPick("default")}
      />
      <OptionRow
        title="Summarize with custom prompt"
        description="Same as Summarize, but with extra steering for what to emphasize."
        onClick={() => onPick("custom")}
      />
      <div className="flex justify-end pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function OptionRow({
  title,
  description,
  onClick,
}: {
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-0.5 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-foreground/30 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="text-[12px] font-medium text-foreground">{title}</span>
      <span className="text-[11px] text-muted-foreground">{description}</span>
    </button>
  )
}

function CustomStage({
  textareaRef,
  value,
  onChange,
  onBack,
  onSubmit,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (s: string) => void
  onBack: () => void
  onSubmit: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[11px] text-muted-foreground" htmlFor="bs-custom">
        Additional instructions for the summarizer
      </label>
      <textarea
        id="bs-custom"
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={4}
        placeholder="e.g. focus on the files that were modified and which tools failed."
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault()
            onSubmit()
          }
        }}
        className="resize-y rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            ⌘↵ to summarize
          </span>
          <Button size="sm" onClick={onSubmit} disabled={value.trim().length === 0}>
            Summarize
          </Button>
        </div>
      </div>
    </div>
  )
}

import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react"
import { Button } from "@/components/ui/button"
import { Composer } from "@/components/composer/composer"
import type { ComposerSubmitPayload } from "@/components/composer/composer"
import type { UserMessageProps } from "../message-components"
import { FileIndexContext } from "../lib/file-index-context"
import { UserMessageImage } from "./user-message-image"
import {
  BranchSummaryPicker,
  type BranchSummaryChoice,
} from "../lib/branch-summary-choice"

/**
 * Read-only render of a past user message bubble, with two hover-
 * affordances tucked under the bubble footer (alongside copy):
 *
 *   - Edit (pencil): flip the same Composer instance from `readOnly`
 *     into a live editor seeded with the bubble's content. Pressing
 *     Enter captures the edit and reveals the summarize-choice
 *     picker; once the user picks None / Default / Custom, the
 *     parent `onEditSubmit` runs the branch-and-send flow.
 *
 *   - Revert (undo arrow): no editor stage. Goes straight to the
 *     summarize picker; once the user picks, `onRevertSubmit` runs
 *     the branch-only flow. The parent emits an `appendComposerDraft`
 *     event with the bubble text so the live composer picks it up
 *     for the user to tweak before resending.
 *
 * Both flows go through pi's branching primitive (`navigateTree`)
 * with a `BranchSummaryChoice`. The bubble itself is oblivious to
 * the underlying RPCs \u2014 the chat-pane wires `onEditSubmit` /
 * `onRevertSubmit` into the right main-process calls.
 *
 * Legacy fallback: messages persisted before the migration to
 * display-text don't contain `@blob:<id>` tokens, so their image
 * refs land in the separate `images` array. Detect that case and
 * fall back to the old inline-thumbnail strip.
 */
type Stage =
  | { kind: "idle" }
  /** Composer mounted as a live editor; waiting for the user to
   * submit (Enter) or cancel (Esc / blur). */
  | { kind: "editing" }
  /** Captured an edit payload + showing the summarize picker. The
   * payload is held in state so picking a summary choice still has
   * access to the text the user typed. */
  | {
      kind: "editChoosing"
      text: string
      displayText: string
    }
  /** Revert flow: no editor stage, summarize picker straight away. */
  | { kind: "revertChoosing" }
  /** A choice has been confirmed and the parent is working on it.
   * Held briefly so the picker can show a "Working\u2026" indicator
   * before the bubble re-renders (or, in the edit case, before the
   * session rebuilds and this materialized message goes away).
   * `flow` keeps the action-label stable across the transition. */
  | { kind: "busy"; flow: "edit" | "revert" }

export function UserMessage({
  content,
  images,
  userMessageIndex,
  onEditSubmit,
  onRevertSubmit,
}: UserMessageProps) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const [copied, setCopied] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: "idle" })
  // Tracks whether this React instance is still mounted. After an
  // edit/revert the materialized message list is rebuilt, but the
  // outer key is `user-${index}` so React reuses _this_ component
  // instance with new props. We use the ref to safely flip out of
  // the busy stage once the parent's async work resolves, instead
  // of getting stuck on a spinner forever.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const innerRef = useRef<HTMLDivElement>(null)
  // Bubble's outer chip \u2014 used as the focus boundary for the
  // auto-exit-on-blur effect below.
  const bubbleRef = useRef<HTMLDivElement>(null)
  const files = useContext(FileIndexContext)

  // Auto-revert to read-only when focus leaves the bubble while
  // we're in the live-editor stage. The CodeMirror editor lives
  // inside `bubbleRef`, so a `focusout` whose `relatedTarget` is
  // outside the chip means the user clicked away. We deliberately
  // ignore focusout events whose new focus target is still inside
  // the chip so clicking the inline action buttons doesn't kick us
  // out of edit mode. Skipped while the summarize picker is up:
  // its rows live in the same bubble, but the picker has its own
  // explicit cancel-on-Escape, so we don't want the focus dance to
  // collapse mid-pick.
  useEffect(() => {
    if (stage.kind !== "editing") return
    const el = bubbleRef.current
    if (!el) return
    const handleFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (next && el.contains(next)) return
      // Defer the idle-flip across a microtask + one rAF so a
      // synchronous state transition out of "editing" (e.g. the
      // submit path that swaps in the summarize picker) wins. Without
      // this, hitting Enter to submit the edit fires focusout while
      // the live CodeMirror DOM is being torn down (its key changes
      // so React unmounts it), the listener is still attached because
      // its effect cleanup runs _after_ DOM mutations, and the idle
      // flip would clobber the just-set `editChoosing` stage —
      // hiding the picker entirely. The functional setState below
      // makes it safe regardless: if we've already left editing, the
      // updater is a no-op.
      requestAnimationFrame(() => {
        setStage(prev => (prev.kind === "editing" ? { kind: "idle" } : prev))
      })
    }
    el.addEventListener("focusout", handleFocusOut)
    return () => el.removeEventListener("focusout", handleFocusOut)
  }, [stage.kind])

  useLayoutEffect(() => {
    const el = innerRef.current
    if (el) setOverflows(el.scrollHeight > 120)
  }, [content])

  const handleCopy = (e: MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(content).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleEdit = (e: MouseEvent) => {
    e.stopPropagation()
    if (userMessageIndex == null || !onEditSubmit) return
    // Expand so the user can see/edit the whole message even if it
    // was collapsed behind a fade.
    setExpanded(true)
    setStage({ kind: "editing" })
  }

  const handleRevert = (e: MouseEvent) => {
    e.stopPropagation()
    if (userMessageIndex == null || !onRevertSubmit) return
    setStage({ kind: "revertChoosing" })
  }

  const handleComposerSubmit = (payload: ComposerSubmitPayload) => {
    if (userMessageIndex == null || !onEditSubmit) return
    // Don't fire the parent yet \u2014 the user still needs to pick a
    // summary choice. Hold the captured text in state, swap the
    // editor for the picker.
    setStage({
      kind: "editChoosing",
      text: payload.text,
      displayText: payload.displayText,
    })
  }

  // Await the parent then flip back to idle. The reused-instance
  // case (edit on a user message at index N) means the bubble
  // sticks around with new `content`, so we _must_ reset state or
  // it'll show "Working…" forever. The mountedRef guard handles
  // the cases where React _did_ tear us down between submit and
  // resolve.
  const confirmEdit = async (choice: BranchSummaryChoice) => {
    if (stage.kind !== "editChoosing") return
    if (userMessageIndex == null || !onEditSubmit) return
    const { text, displayText } = stage
    setStage({ kind: "busy", flow: "edit" })
    try {
      await onEditSubmit({ userMessageIndex, text, displayText, choice })
    } finally {
      if (mountedRef.current) setStage({ kind: "idle" })
    }
  }

  const confirmRevert = async (choice: BranchSummaryChoice) => {
    if (userMessageIndex == null || !onRevertSubmit) return
    setStage({ kind: "busy", flow: "revert" })
    try {
      await onRevertSubmit({ userMessageIndex, choice })
    } finally {
      if (mountedRef.current) setStage({ kind: "idle" })
    }
  }

  // Legacy entries (pre-displayText) carry images via the separate
  // `images` array and don't have a `@blob:` token in their content.
  // For those, render inline thumbnails the old way so the message
  // doesn't lose its images.
  const hasInlineBlobToken =
    typeof content === "string" && content.includes("@blob:")
  const legacyImages =
    images && images.length > 0 && !hasInlineBlobToken ? images : null

  const canEdit = userMessageIndex != null && !!onEditSubmit
  const canRevert = userMessageIndex != null && !!onRevertSubmit
  const editing = stage.kind === "editing"
  const showingPicker =
    stage.kind === "editChoosing" || stage.kind === "revertChoosing"
  const busy = stage.kind === "busy"

  // React `key` on Composer forces a full unmount/remount when we
  // flip in/out of edit mode. The Composer reads `readOnly` once at
  // mount (it's baked into the CodeMirror extension set) so a prop
  // change alone wouldn't rebuild the editor.
  const composerInstanceKey = `user-msg-${editing ? "edit" : "view"}-${content.length}-${content.slice(0, 32)}`

  return (
    <div className="group/msg py-1">
      <div
        ref={bubbleRef}
        className="group w-full rounded-md border border-border bg-accent text-accent-foreground"
        style={{
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
        }}
      >
        <div
          className={`relative overflow-hidden ${
            expanded || editing || showingPicker || busy
              ? ""
              : "max-h-[120px]"
          }`}
        >
          <div ref={innerRef} className="user-message-body">
            <Composer
              key={composerInstanceKey}
              composerKey={composerInstanceKey}
              readOnly={!editing}
              // Stay chromeless even when editable so the live editor
              // inherits the bubble's `bg-accent` instead of stamping
              // a `bg-card` rectangle on top of it.
              embedded
              initialText={content}
              files={files}
              placeholder="Edit and press Enter \u2192 pick summary"
              onSubmit={editing ? handleComposerSubmit : NOOP_SUBMIT}
              // Pre-select the whole bubble on edit-mount so the
              // first keystroke replaces it — it's a clear visual
              // cue that you're now editing this message.
              selectAllOnMount={editing}
            />
            {legacyImages ? (
              <div className="mt-2 flex flex-wrap gap-2 px-3 pb-2">
                {legacyImages.map((ref, i) => (
                  <UserMessageImage
                    key={`${ref.blobId}-${i}`}
                    blobId={ref.blobId}
                    mimeType={ref.mimeType}
                  />
                ))}
              </div>
            ) : null}
            {showingPicker || busy ? (
              // The embedded variant of BranchSummaryPicker drops
              // its own chrome entirely (no header, no footer, no
              // border, no surface fill) so it reads as a list of
              // rows hanging directly off the bubble. The picker
              // itself paints the selected row — everything else
              // shares the bubble's `bg-accent`. No extra wrapping
              // div: nesting it any deeper just brings back the
              // "too many surfaces" feel we just removed.
              <BranchSummaryPicker
                variant="embedded"
                actionLabel={
                  (stage.kind === "editChoosing" ||
                    (stage.kind === "busy" && stage.flow === "edit"))
                    ? "branch + send edited message"
                    : "branch + drop text into composer"
                }
                busy={busy}
                onConfirm={choice => {
                  if (stage.kind === "editChoosing") void confirmEdit(choice)
                  else if (stage.kind === "revertChoosing")
                    void confirmRevert(choice)
                }}
                onCancel={() => setStage({ kind: "idle" })}
              />
            ) : null}
          </div>
          {!expanded && !editing && !showingPicker && !busy && overflows && (
            <div
              className="absolute inset-x-0 bottom-0 h-10"
              style={{
                background:
                  "linear-gradient(to top, var(--accent), transparent)",
              }}
            />
          )}
        </div>
        {overflows && !editing && !showingPicker && !busy && (
          <Button
            type="button"
            variant="ghost"
            onClick={e => {
              e.stopPropagation()
              setExpanded(v => !v)
            }}
            className="h-auto w-full pt-1.5 text-muted-foreground hover:bg-transparent hover:text-foreground"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <Chevron direction={expanded ? "up" : "down"} />
          </Button>
        )}
      </div>
      <div className="relative flex h-2 justify-end">
        <div className="absolute right-0 top-0 flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100">
          {editing || showingPicker ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={e => {
                e.stopPropagation()
                setStage({ kind: "idle" })
              }}
              className="gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              aria-label="Cancel"
              title="Cancel (Esc)"
            >
              <CancelIcon />
            </Button>
          ) : (
            <>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleEdit}
                  className="gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                  aria-label="Edit (branches the session)"
                  title="Edit \u2192 branch + send"
                >
                  <PencilIcon />
                </Button>
              )}
              {canRevert && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleRevert}
                  className="gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                  aria-label="Revert to this message"
                  title="Revert \u2192 branch + drop into composer"
                >
                  <UndoIcon />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={handleCopy}
                className="gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                aria-label="Copy"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Composer requires an onSubmit prop; in read-only mode the keymap is
// disabled so this never fires. Hoisted to a module constant so the
// reference stays stable across renders.
const NOOP_SUBMIT = () => {}

function Chevron({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === "down" ? (
        <path d="M3.5 5.5L7 9l3.5-3.5" />
      ) : (
        <path d="M3.5 9L7 5.5 10.5 9" />
      )}
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function UndoIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7" />
    </svg>
  )
}

function CancelIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  )
}

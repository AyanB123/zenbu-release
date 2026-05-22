import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Compartment, EditorState, Prec } from "@codemirror/state"
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
  drawSelection,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { vim, getCM, Vim } from "@replit/codemirror-vim"
import { useDb, useDbClient, useEvents } from "@zenbujs/core/react"
import type { ImageContent } from "@earendil-works/pi-ai"
import { setActiveVimMode, type VimMode } from "@/lib/vim-mode-store"
import { subscribeFocusComposer } from "@/lib/focus-composer"
import {
  dbClientField,
  fileIndexField,
  getPills,
  pillAtomicRanges,
  pillDecorations,
  setDbClientEffect,
  setFileIndexEffect,
} from "./cm/pill-field"
import { formatBlobMarker } from "./cm/pill-scan"
import { markdownDecorations, markdownTheme } from "./cm/markdown-field"
import { detectTrigger } from "./cm/typeahead"
import { FilePickerMenu } from "./file-picker-menu"
import { SlashCommandMenu } from "./slash-command-menu"
import { ComposerToolbar, type AgentConfig } from "./composer-toolbar"
import { rankEntries } from "./lib/fuzzy"
import { getImageBytes, putImage } from "./lib/image-cache"
import type { ComposerIntent, FileEntry, SlashCommand } from "./types"

export type ComposerSubmitPayload = {
  /** Final wire text shipped to the model. File pills are inlined as
   * `@<filePath>`; image pills are emitted as
   * `@blob:<id>{order=N, size=BYTES}` markers — same underlying token
   * as the input, with positional + size metadata appended so the
   * model can correlate the marker with the attached image parts. */
  text: string
  /** Verbatim composer doc text — the same value the user sees in the
   * input. Used for persistence and for re-rendering the user message
   * read-only with pill widgets. Image refs survive as `@blob:<id>`
   * (without metadata); file refs as `@<filePath>`. */
  displayText: string
  /** Image attachments in document order, ready to forward as
   * pi's `PromptOptions.images`. */
  images: ImageContent[]
  /** Image references for persistence/replay (blob refs survive across
   * reload; the bytes/base64 in `images` do not need to). Same order
   * as `images`. */
  imageRefs: { blobId: string; mimeType: string }[]
  /** User intent for this submission:
   *   default   — parent picks based on streaming state + the user's
   *               configured default send mode
   *   steer     — Mod+Enter, or `/steer` slash
   *   followUp  — `/queue` slash
   * The composer only resolves the override; whether to ship as a
   * prompt or enqueue is the parent's call. */
  intent: ComposerIntent
}

export type ComposerProps = {
  /** Unique key for the editor instance; remount when this changes. */
  composerKey?: string
  onSubmit: (payload: ComposerSubmitPayload) => void
  placeholder?: string
  /** Seeded doc text. Read once at mount only — the composer is
   * uncontrolled. Pair with `composerKey` to remount on chat switch. */
  initialText?: string
  /** Fired on every doc change with the full doc text. Use this to
   * persist drafts; the caller is responsible for debouncing. */
  onDraftChange?: (text: string) => void
  /** Static file list for the `@`-mention typeahead. */
  files?: FileEntry[]
  /** Static slash command list for the `/` typeahead. */
  slashCommands?: SlashCommand[]
  onSlashAction?: (action: string) => void
  agentConfigs?: AgentConfig[]
  currentAgentConfigId?: string
  onChangeAgentConfig?: (id: string) => void
  currentModel?: string
  onChangeModel?: (value: string) => void
  currentThinkingLevel?: string
  onChangeThinkingLevel?: (value: string) => void
  streaming?: boolean
  onInterrupt?: () => void
  /** When true, Enter inserts a newline instead of submitting and the
   * toolbar shows a lock button in place of the interrupt button. */
  locked?: boolean
  onUnlock?: () => void
  toolbarSlot?: ReactNode
  /** Read-only mode — disables editing, the keymap, the typeahead, the
   * paste handler, and the toolbar. Used by the user-message bubble to
   * re-render the persisted input with the same pill decorations the
   * user typed it with. */
  readOnly?: boolean
  /** Chromeless mount: skip the outer max-width wrapper, the rounded
   * border + `bg-card` background, and the toolbar. The composer
   * inherits its container's background and padding so it visually
   * fuses with the surrounding surface. Used by the user-message
   * bubble's inline-edit mode so the live editor stays on the
   * `bg-accent` chip instead of stamping its own `bg-card` rectangle
   * on top of it. Independent of `readOnly`: an embedded composer
   * can still be fully interactive. */
  embedded?: boolean
  /** Stable identifier for this composer instance. When set, the
   * composer subscribes to the `appendComposerDraft` event and
   * appends matching payloads to its doc (without clobbering the
   * current draft). Used by the user-message bubble's revert flow
   * to drop the past message's text into the live composer. */
  composerId?: string
  /** When true, the entire seeded doc is selected on mount so any
   * keystroke replaces it. Used by inline-edit flows (user-message
   * bubble, queued-message row) to make the "you're editing, type
   * to replace" affordance obvious. Ignored when `readOnly`. */
  selectAllOnMount?: boolean
}

const DEFAULT_PLACEHOLDER = "/ for commands, @ for context"
const MAX_FILE_RESULTS = 200
const MAX_SLASH_RESULTS = 50

type MenuAnchor = { left: number; top: number; bottom: number }
type FileMenuState = {
  kind: "file"
  options: FileEntry[]
  from: number
  to: number
  /** Current query string — used to detect "query changed, reset selection". */
  query: string
  anchor: MenuAnchor | null
}
type SlashMenuState = {
  kind: "slash"
  options: SlashCommand[]
  from: number
  to: number
  query: string
}
type MenuState = FileMenuState | SlashMenuState | null

/**
 * Get the viewport coordinate of a doc position. Returns null when CM
 * can't measure (e.g. position is offscreen). Used to anchor the file
 * picker menu to the caret.
 */
function caretAnchor(
  view: EditorView,
  pos: number,
): { left: number; top: number; bottom: number } | null {
  const coords = view.coordsAtPos(pos)
  if (!coords) return null
  return { left: coords.left, top: coords.top, bottom: coords.bottom }
}

/**
 * Walk pills in document order and lower the editor state into pi's
 * wire format.
 *
 * - File pills: the in-doc text is *already* `@<filePath>`, so we just
 *   copy the slice as-is. No splicing required.
 * - Image pills: the in-doc text is `@blob:<id>` (TODO(zenbu): blob-
 *   path placeholder). We replace each occurrence with a positional
 *   marker `[Image #N]` and emit an `ImageContent` part with the bytes
 *   from the renderer-local image cache.
 *
 * Synchronous because image bytes are guaranteed in the cache: the
 * paste handler calls `putImage` before adding the pill effect, so by
 * the time the user can press Enter the lookup is always a hit.
 */
type SerializedDoc = Omit<ComposerSubmitPayload, "intent">

function serializeForSubmit(state: EditorState): SerializedDoc {
  const doc = state.doc.toString()
  const pills = getPills(state).slice().sort((a, b) => a.from - b.from)
  if (pills.length === 0) {
    return { text: doc, displayText: doc, images: [], imageRefs: [] }
  }
  let text = ""
  let displayText = ""
  let cursor = 0
  const images: ImageContent[] = []
  const imageRefs: { blobId: string; mimeType: string }[] = []
  let imageN = 0
  for (const p of pills) {
    if (p.from > cursor) {
      const between = state.doc.sliceString(cursor, p.from)
      text += between
      displayText += between
    }
    if (p.kind === "file") {
      // Doc text already equals `@<filePath>`; pass through verbatim.
      const slice = state.doc.sliceString(p.from, p.to)
      text += slice
      displayText += slice
    } else {
      imageN++
      // Canonical display form: `@blob:<id>` (no metadata). The user
      // sees this in the composer and it's what we persist for replay.
      displayText += `@blob:${p.blobId}`
      const cached = getImageBytes(p.blobId)
      if (cached) {
        images.push({
          type: "image",
          data: bytesToBase64(cached.bytes),
          mimeType: cached.mimeType,
        })
        imageRefs.push({ blobId: p.blobId, mimeType: cached.mimeType })
        // Wire form: same token plus positional + size metadata. The
        // model uses `order` to correlate the marker with the matching
        // image part; `size` is informational.
        text += formatBlobMarker(p.blobId, {
          order: imageN,
          size: cached.bytes.byteLength,
        })
      } else {
        // Cache miss is unexpected — the paste handler always populates
        // before adding the pill. Log loudly and emit a bare marker so
        // the wire text still references the blob id.
        console.warn(`[composer] no cached bytes for blob ${p.blobId}`)
        text += `@blob:${p.blobId}`
      }
    }
    cursor = p.to
  }
  if (cursor < state.doc.length) {
    const tail = state.doc.sliceString(cursor)
    text += tail
    displayText += tail
  }
  return { text, displayText, images, imageRefs }
}

/** Browser-safe Uint8Array → base64. Chunked to avoid call-stack limits
 * on `String.fromCharCode.apply` for large images. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    const slice = bytes.subarray(i, i + chunk)
    binary += String.fromCharCode.apply(
      null,
      slice as unknown as number[],
    )
  }
  return btoa(binary)
}

function normalizeVimMode(raw: string | undefined): VimMode {
  if (!raw) return "normal"
  const base = raw.split(" ")[0]
  if (base === "insert" || base === "visual" || base === "replace") return base
  return "normal"
}

export function Composer({
  composerKey = "composer",
  onSubmit,
  placeholder = DEFAULT_PLACEHOLDER,
  initialText,
  onDraftChange,
  files = [],
  slashCommands = [],
  onSlashAction,
  agentConfigs,
  currentAgentConfigId,
  onChangeAgentConfig,
  currentModel,
  onChangeModel,
  currentThinkingLevel,
  onChangeThinkingLevel,
  streaming,
  onInterrupt,
  locked,
  onUnlock,
  toolbarSlot,
  readOnly,
  embedded,
  composerId,
  selectAllOnMount,
}: ComposerProps) {
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const embeddedRef = useRef(embedded)
  embeddedRef.current = embedded
  const selectAllOnMountRef = useRef(selectAllOnMount)
  selectAllOnMountRef.current = selectAllOnMount
  // Captured once per mount via refs. `initialText` is intentionally
  // not in the mount effect's deps — changing chats remounts via
  // `composerKey`, so the latest value is always read on fresh mount.
  const initialTextRef = useRef(initialText)
  initialTextRef.current = initialText
  const onDraftChangeRef = useRef(onDraftChange)
  onDraftChangeRef.current = onDraftChange
  // Tracks the last composerKey we actually acted on. We can't use
  // useEffect's deps alone to detect "key really changed": React's
  // <Activity> remounts effects on visibility toggles without
  // changing deps, which would otherwise run the reseed branch with
  // a stale initialTextRef and wipe the editor's preserved doc.
  const lastComposerKeyRef = useRef<string | null>(null)
  // Mirror `locked` into a ref so the Enter handler (defined once when
  // the editor mounts) always sees the latest value without rebuilding
  // the keymap on every render.
  const lockedRef = useRef(locked)
  lockedRef.current = locked
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const vimCompartmentRef = useRef<Compartment | null>(null)
  const vimModeCleanupRef = useRef<(() => void) | null>(null)
  const [menu, setMenu] = useState<MenuState>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const vimEnabled = useDb(root => root.app.settings.vimMode)
  const vimEnabledRef = useRef(vimEnabled)
  vimEnabledRef.current = vimEnabled

  const attachVimModeListener = (view: EditorView) => {
    vimModeCleanupRef.current?.()
    const cm = getCM(view)
    if (!cm) {
      vimModeCleanupRef.current = null
      return
    }
    setActiveVimMode(normalizeVimMode(cm.state.vim?.mode))
    const handler = (e: { mode: string }) => {
      setActiveVimMode(normalizeVimMode(e.mode))
    }
    cm.on("vim-mode-change", handler)
    vimModeCleanupRef.current = () => {
      cm.off("vim-mode-change", handler)
    }
  }

  const dbClient = useDbClient()
  const dbClientRef = useRef(dbClient)
  dbClientRef.current = dbClient
  // Kept in sync via a dispatched effect (see mount effect below)
  // so the image pill widget tree — which lives outside
  // <ZenbuProvider> — can hydrate blobs without `useDbClient`.
  const dbClientFieldRef = useRef(dbClient)
  dbClientFieldRef.current = dbClient

  const filesRef = useRef(files)
  const slashRef = useRef(slashCommands)
  const onSubmitRef = useRef(onSubmit)
  const onSlashActionRef = useRef(onSlashAction)
  const menuRef = useRef<MenuState>(menu)
  const selectedIndexRef = useRef(selectedIndex)
  filesRef.current = files
  slashRef.current = slashCommands
  onSubmitRef.current = onSubmit
  onSlashActionRef.current = onSlashAction
  menuRef.current = menu
  selectedIndexRef.current = selectedIndex

  const recomputeMenu = useMemo(
    () => (state: EditorState, view: EditorView | null) => {
      const trigger = detectTrigger(state)
      if (!trigger) {
        setMenu(null)
        setSelectedIndex(0)
        return
      }
      // Suppress the typeahead when the caret is inside an already-
      // recognized pill range. Without this, arrowing into a pill's
      // raw-text form (live preview) re-fires the menu with the
      // pill's contents as the query — noisy and useless. Boundary
      // at the left edge (`from`) is safe naturally because the @
      // is at the cursor, leaving nothing to walk back through.
      const head = state.selection.main.head
      const pills = getPills(state)
      for (const p of pills) {
        if (head > p.from && head <= p.to) {
          setMenu(null)
          setSelectedIndex(0)
          return
        }
      }
      const prev = menuRef.current
      // Same trigger run (same kind, same `@`/`/` position) AND same query
      // → user just moved the caret within the trigger region; preserve
      // their menu selection. Otherwise (query changed or trigger reset)
      // bounce selection to 0 so the top-ranked result is highlighted.
      const sameRun =
        prev != null &&
        prev.kind === trigger.kind &&
        prev.from === trigger.from &&
        prev.query === trigger.query

      if (trigger.kind === "file") {
        // Rank the full path; fuzzy.ts already biases the basename.
        const ranked = rankEntries(
          filesRef.current,
          trigger.query,
          f => f.path,
          MAX_FILE_RESULTS,
        )
        if (ranked.length === 0) {
          setMenu(null)
          setSelectedIndex(0)
          return
        }
        const anchor = view ? caretAnchor(view, trigger.from) : null
        setMenu({
          kind: "file",
          options: ranked.map(r => r.entry),
          from: trigger.from,
          to: trigger.to,
          query: trigger.query,
          anchor,
        })
        setSelectedIndex(
          sameRun ? i => Math.min(i, ranked.length - 1) : 0,
        )
      } else {
        const ranked = rankEntries(
          slashRef.current,
          trigger.query,
          c => `${c.label} ${c.id}`,
          MAX_SLASH_RESULTS,
        )
        if (ranked.length === 0) {
          setMenu(null)
          setSelectedIndex(0)
          return
        }
        setMenu({
          kind: "slash",
          options: ranked.map(r => r.entry),
          from: trigger.from,
          to: trigger.to,
          query: trigger.query,
        })
        setSelectedIndex(
          sameRun ? i => Math.min(i, ranked.length - 1) : 0,
        )
      }
    },
    [],
  )

  const insertFile = (entry: FileEntry, from: number, to: number) => {
    const view = viewRef.current
    if (!view) return
    // The doc just gets the canonical text — `@<filePath>` followed by a
    // space. Decoration is derived from the doc contents, so the pill
    // appears automatically. No side state to update.
    const text = `@${entry.path}`
    const pillTo = from + text.length
    view.dispatch({
      changes: { from, to, insert: `${text} ` },
      selection: { anchor: pillTo + 1 },
    })
    setMenu(null)
    setSelectedIndex(0)
    view.focus()
  }

  /**
   * Paste flow for an image: lift bytes off the clipboard, push them
   * into the shared image cache (so the widget renders sync), then
   * persist via `createBlob` and add the pill effect once we know the
   * blobId. The `@blob:<id>` placeholder is inserted at the caret in
   * the same transaction as the pill effect so undo/redo is one step.
   */
  const handleImagePaste = async (
    file: File,
    insertPos: number,
  ): Promise<void> => {
    const view = viewRef.current
    if (!view) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    const mimeType = file.type || "image/png"
    let blobId: string
    try {
      blobId = await dbClientRef.current.createBlob(bytes)
    } catch (err) {
      console.error("[composer] createBlob failed:", err)
      return
    }
    putImage(blobId, bytes, mimeType)

    const liveView = viewRef.current
    if (!liveView) return
    const text = `@blob:${blobId}`
    // Re-anchor at the live cursor; the user may have moved/typed during
    // the async createBlob. If they typed, we still insert at the live
    // caret rather than the original position — feels more natural.
    const head = Math.min(
      insertPos,
      liveView.state.doc.length,
      liveView.state.selection.main.head,
    )
    const pillTo = head + text.length
    // Trailing space so the next keystroke isn't glued to the pill.
    liveView.dispatch({
      changes: { from: head, insert: `${text} ` },
      selection: { anchor: pillTo + 1 },
    })
  }

  const handleSlash = (cmd: SlashCommand, from: number, to: number) => {
    const view = viewRef.current
    if (!view) return
    if (cmd.submitWith !== undefined) {
      // Strip the slash trigger from the doc, then submit immediately
      // with the requested intent. The user never sees a sticky mode
      // — picking the command IS the send.
      view.dispatch({ changes: { from, to, insert: "" } })
      setMenu(null)
      setSelectedIndex(0)
      submit(view, cmd.submitWith)
      return
    }
    if (cmd.action) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "" },
      })
      setMenu(null)
      setSelectedIndex(0)
      onSlashActionRef.current?.(cmd.action)
      view.focus()
      return
    }
    if (cmd.insertText) {
      view.dispatch({
        changes: { from, to, insert: cmd.insertText },
        selection: { anchor: from + cmd.insertText.length },
      })
    }
    setMenu(null)
    setSelectedIndex(0)
    view.focus()
  }

  const submit = (view: EditorView, override?: "steer" | "followUp") => {
    if (lockedRef.current) {
      // Locked composer: Enter falls through to "insert newline" so
      // the user can keep drafting without accidentally sending.
      view.dispatch(view.state.replaceSelection("\n"))
      return true
    }
    const payload = serializeForSubmit(view.state)
    if (payload.text.trim().length === 0 && payload.images.length === 0) {
      return true
    }
    const intent: ComposerIntent = override ?? "default"
    onSubmitRef.current({ ...payload, intent })
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "" },
    })
    return true
  }

  const navigateMenu = (delta: number): boolean => {
    const current = menuRef.current
    if (!current) return false
    const len = current.options.length
    setSelectedIndex(i => (i + delta + len) % len)
    return true
  }

  const selectActiveMenuItem = (): boolean => {
    const current = menuRef.current
    if (!current) return false
    const idx = Math.min(selectedIndexRef.current, current.options.length - 1)
    if (current.kind === "file") {
      insertFile(current.options[idx]!, current.from, current.to)
    } else {
      handleSlash(current.options[idx]!, current.from, current.to)
    }
    return true
  }

  const closeMenu = (): boolean => {
    if (!menuRef.current) return false
    setMenu(null)
    setSelectedIndex(0)
    return true
  }

  useEffect(() => {
    if (!hostRef.current) return

    const isReadOnly = readOnlyRef.current === true
    // Embedded composers borrow the readOnly bubble's tight padding +
    // collapsed min-height so the live editor doesn't stamp a tall
    // 74px rectangle on top of a snug user-message chip.
    const isCompact = isReadOnly || embeddedRef.current === true

    const composerKeymap = keymap.of([
      {
        key: "Enter",
        run: view => {
          if (selectActiveMenuItem()) return true
          return submit(view)
        },
        shift: () => false,
      },
      {
        key: "Mod-Enter",
        run: view => {
          // Steer override: interject mid-turn. Only meaningful when
          // streaming; when idle, parent treats it like a normal send.
          return submit(view, "steer")
        },
      },
      {
        key: "Shift-Enter",
        run: view => {
          view.dispatch(view.state.replaceSelection("\n"))
          return true
        },
      },
      { key: "ArrowDown", run: () => navigateMenu(1) },
      { key: "ArrowUp", run: () => navigateMenu(-1) },
      { key: "Ctrl-n", run: () => navigateMenu(1) },
      { key: "Ctrl-p", run: () => navigateMenu(-1) },
      { key: "Tab", run: () => selectActiveMenuItem() },
      { key: "Escape", run: () => closeMenu() },
    ])

    const updateListener = EditorView.updateListener.of(update => {
      // Doc edits can open, refine, or close the menu. Pure selection
      // changes (arrow keys, click-to-position) can only refine or
      // close an already-open menu — never spawn one. Without this
      // gate, arrowing into an existing `@something` would pop the
      // typeahead open even though the user is just navigating.
      if (update.docChanged) {
        recomputeMenu(update.state, update.view)
        // Notify owner so they can persist the draft. We pass the raw
        // doc string — pill structure re-derives from text on restore.
        const cb = onDraftChangeRef.current
        if (cb) {
          const text = update.state.doc.toString()
          console.log(
            `[composer] docChanged len=${text.length} userEvent=${update.transactions.some(t => t.isUserEvent("input") || t.isUserEvent("delete"))}`,
          )
          cb(text)
        }
      } else if (update.selectionSet && menuRef.current) {
        recomputeMenu(update.state, update.view)
      }
    })

    const pasteHandler = EditorView.domEventHandlers({
      paste: (event, view) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (let i = 0; i < items.length; i++) {
          const item = items[i]!
          if (item.kind !== "file") continue
          if (!item.type.startsWith("image/")) continue
          const file = item.getAsFile()
          if (!file) continue
          event.preventDefault()
          const insertPos = view.state.selection.main.head
          void handleImagePaste(file, insertPos)
          return true
        }
        return false
      },
    })

    const theme = EditorView.theme({
      "&": {
        fontSize: "14px",
        color: "inherit",
        backgroundColor: "transparent",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "1.5",
        maxHeight: "75vh",
        overflowY: "auto",
      },
      ".cm-content": {
        // Read-only (user-message bubble) and embedded (inline-edit on
        // a user-message bubble) both render inside a chip that
        // already provides visual padding, and a 74px min-height
        // makes one-line replies waste a ton of vertical space.
        // Shrink both for those cases; the standalone composer keeps
        // the original generous numbers.
        padding: isCompact ? "6px 10px" : "14px 20px",
        minHeight: isCompact ? "0" : "74px",
        caretColor: "currentColor",
      },
      ".cm-line": { padding: "0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "currentColor" },
      ".cm-selectionBackground, ::selection": {
        backgroundColor: "var(--accent)",
      },
      "&.cm-focused .cm-selectionBackground": {
        backgroundColor: "var(--accent)",
      },
      ".cm-fat-cursor": {
        background: "var(--foreground) !important",
        color: "var(--background) !important",
      },
      "&:not(.cm-focused) .cm-fat-cursor": {
        background: "none !important",
        outline: "solid 1px var(--foreground)",
      },
      ".cm-placeholder": {
        color: "var(--muted-foreground)",
      },
    })

    const vimCompartment = new Compartment()
    vimCompartmentRef.current = vimCompartment

    const seed = initialTextRef.current ?? ""
    const extensions = isReadOnly
      ? [
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          fileIndexField,
          dbClientField,
          pillDecorations,
          pillAtomicRanges,
          markdownDecorations,
          markdownTheme,
          EditorView.lineWrapping,
          theme,
        ]
      : [
          Prec.highest(composerKeymap),
          vimCompartment.of(vimEnabledRef.current ? vim() : []),
          history(),
          drawSelection(),
          fileIndexField,
          dbClientField,
          pillDecorations,
          pillAtomicRanges,
          markdownDecorations,
          markdownTheme,
          pasteHandler,
          keymap.of([
            ...defaultKeymap.filter(b => b.key !== "Enter"),
            ...historyKeymap,
          ]),
          cmPlaceholder(placeholder),
          EditorView.lineWrapping,
          updateListener,
          theme,
        ]
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: seed,
        // Place caret at end of seeded doc so the user can keep typing.
        selection: { anchor: seed.length },
        extensions,
      }),
    })

    viewRef.current = view
    // Inject the db client so image pill widgets can hydrate blobs
    // from the zenbu blob store on cache miss (e.g. restored drafts).
    view.dispatch({
      effects: setDbClientEffect.of(dbClientFieldRef.current),
    })
    if (!isReadOnly) {
      attachVimModeListener(view)
      view.focus()
      if (vimEnabledRef.current) {
        const cm = getCM(view)
        if (cm) Vim.handleKey(cm, "i", "user")
      }
      // Optionally select the whole seeded doc so the first
      // keystroke replaces it. Dispatched after focus so the
      // selection is visible (cm doesn't paint selections in
      // unfocused editors). Empty docs would produce an empty
      // selection — skip in that case.
      if (selectAllOnMountRef.current && seed.length > 0) {
        view.dispatch({
          selection: { anchor: 0, head: seed.length },
        })
      }
    }

    const onWindowFocus = () => {
      if (!isReadOnly) view.focus()
    }
    if (!isReadOnly) window.addEventListener("focus", onWindowFocus)

    return () => {
      if (!isReadOnly) window.removeEventListener("focus", onWindowFocus)
      vimModeCleanupRef.current?.()
      vimModeCleanupRef.current = null
      if (!isReadOnly) setActiveVimMode(null)
      view.destroy()
      viewRef.current = null
      vimCompartmentRef.current = null
    }
  }, [placeholder, recomputeMenu])

  useEffect(() => {
    if (readOnly) return
    const view = viewRef.current
    const compartment = vimCompartmentRef.current
    if (!view || !compartment) return
    view.dispatch({
      effects: compartment.reconfigure(vimEnabled ? vim() : []),
    })
    if (vimEnabled) {
      attachVimModeListener(view)
    } else {
      vimModeCleanupRef.current?.()
      vimModeCleanupRef.current = null
      setActiveVimMode(null)
    }
  }, [vimEnabled, readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    // Guard against <Activity> visibility toggles: this effect
    // re-mounts on every visible transition with the same
    // composerKey, which would otherwise clobber the preserved doc
    // with a stale `initialTextRef`. We only want to act when the
    // key actually changed from the last value we observed.
    const prevKey = lastComposerKeyRef.current
    lastComposerKeyRef.current = composerKey
    if (prevKey === composerKey) {
      console.log(
        `[composer] composerKey effect: skip (Activity remount or same key ${composerKey})`,
      )
      return
    }
    // composerKey changed (chat switch). Reset the editor to the new
    // chat's persisted draft. The EditorView itself is reused across
    // chat switches — only the doc is swapped — so we seed here
    // rather than depending on a fresh mount.
    const seed = initialTextRef.current ?? ""
    console.log(
      `[composer] composerKey effect: reseed ${prevKey ?? "<null>"}→${composerKey} seedLen=${seed.length}`,
    )
    // Skip the redundant first-mount run: the EditorView was already
    // constructed with `doc: seed`, so a same-string replace would
    // just fire the updateListener for no reason.
    if (view.state.doc.toString() === seed) {
      setMenu(null)
      setSelectedIndex(0)
      return
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: seed },
      selection: { anchor: seed.length },
    })
    setMenu(null)
    setSelectedIndex(0)
  }, [composerKey])

  // Push the latest file index into the editor state whenever the
  // surrounding `files` prop changes. The decoration computer reads
  // from this field to validate `@<path>` tokens.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const set = new Set<string>()
    for (const f of files) set.add(f.path)
    view.dispatch({ effects: setFileIndexEffect.of(set) })
  }, [files])

  // Subscribe to `appendComposerDraft` events: when a payload's
  // `composerId` matches ours, splice its text onto the end of the
  // current doc (with a separating newline if there's already
  // content). Targets the live EditorView directly so the caret
  // lands at the new end and a CodeMirror history entry is produced
  // (so the user can undo the append cleanly). No-op when we don't
  // have a `composerId` — callers that don't opt in stay inert.
  const events = useEvents()
  useEffect(() => {
    if (!composerId) return
    if (readOnly) return
    const off = events.app.appendComposerDraft.subscribe(payload => {
      if (payload.composerId !== composerId) return
      const view = viewRef.current
      if (!view) return
      const docLen = view.state.doc.length
      const existing = view.state.doc.toString()
      // Trim a trailing newline + prepend a blank line when there's
      // already content so the appended text starts on its own line
      // without doubling up blanks. Empty doc → just insert verbatim.
      const sep = docLen === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n"
      const insert = `${sep}${payload.text}`
      view.dispatch({
        changes: { from: docLen, insert },
        selection: { anchor: docLen + insert.length },
        scrollIntoView: true,
      })
      view.focus()
    })
    return off
  }, [events, composerId, readOnly])

  // External "please focus me" signal. Fired by surfaces that swap
  // the active tab's chat in place (sidebar "New Chat", ⌘N) — the
  // EditorView is reused across switches, so mount-time auto-focus
  // never runs. Dispatched on `window` to keep the hop renderer-only.
  useEffect(() => {
    if (!composerId) return
    if (readOnly) return
    return subscribeFocusComposer(composerId, () => {
      viewRef.current?.focus()
    })
  }, [composerId, readOnly])

  // Chromeless wrappers: same minimal shell as `readOnly`, just the
  // composer pasted onto whatever background the parent supplies.
  // Keeping the two flags independent lets the user-message bubble
  // use `embedded` to mean "no chrome" for both its read-only and
  // editable states.
  const chromeless = readOnly || embedded
  return (
    <div
      className={
        chromeless
          ? "w-full"
          : "mx-auto w-full max-w-[919px] px-2 pt-1 pb-2"
      }
    >
      <div
        className={
          chromeless
            ? "relative overflow-visible"
            : "relative overflow-visible rounded-md border border-border bg-card/85 text-card-foreground"
        }
      >
        <div className="relative">
          <div ref={hostRef} className="composer-cm" />
          {menu?.kind === "file" && (
            <FilePickerMenu
              options={menu.options}
              selectedIndex={selectedIndex}
              onSelect={option => insertFile(option, menu.from, menu.to)}
              onHover={setSelectedIndex}
              anchor={menu.anchor}
            />
          )}
          {menu?.kind === "slash" && (
            <SlashCommandMenu
              options={menu.options}
              selectedIndex={selectedIndex}
              onSelect={option => handleSlash(option, menu.from, menu.to)}
              onHover={setSelectedIndex}
            />
          )}
        </div>

        {chromeless ? null : (
          <ComposerToolbar
            agentConfigs={agentConfigs}
            currentAgentConfigId={currentAgentConfigId}
            onChangeAgentConfig={onChangeAgentConfig}
            currentModel={currentModel}
            onChangeModel={onChangeModel}
            currentThinkingLevel={currentThinkingLevel}
            onChangeThinkingLevel={onChangeThinkingLevel}
            streaming={streaming}
            onInterrupt={onInterrupt}
            locked={locked}
            onUnlock={onUnlock}
            slot={toolbarSlot}
          />
        )}
      </div>
    </div>
  )
}


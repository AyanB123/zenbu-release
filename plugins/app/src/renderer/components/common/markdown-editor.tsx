import { useEffect, useMemo, useRef, useState } from "react"
import { useInjections } from "@zenbujs/core/react"
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state"
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
  drawSelection,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { cn } from "@/lib/utils"
import {
  detectTrigger,
  type TriggerMatch,
  type TriggerOptions,
  type TypeaheadItem,
  type TypeaheadTrigger,
} from "./markdown-typeahead"
import { TypeaheadMenu } from "./typeahead-menu"

export type MarkdownEditorProps = {
  /** Current document text. */
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** Tailwind classes for the host element. The host already has a
   * sensible default (padding, border, focus-within ring); use this
   * for size overrides like `min-h-[120px]` or `flex-1`. */
  className?: string
  /** Match the `Textarea` API — callers using onKeyDown for things
   * like ⌘↩ to submit can pass it through. */
  onKeyDown?: (e: KeyboardEvent) => void
  autoFocus?: boolean
  /**
   * Optional typeahead triggers (e.g. `@mention`, `#issue`). The
   * editor watches the doc for these characters at word boundaries
   * and pops up a `<TypeaheadMenu>` with the items the trigger's
   * `fetch` returns. See `markdown-typeahead.ts` for the contract.
   *
   * Pass a stable reference; the editor rebinds its internal trigger
   * cache when this array's reference changes.
   */
  triggers?: readonly TypeaheadTrigger[]
}

type MenuState = {
  trigger: TypeaheadTrigger
  match: TriggerMatch
  items: TypeaheadItem[]
  loading: boolean
  anchor: { left: number; top: number; bottom: number } | null
}

/**
 * Lightweight CodeMirror-backed markdown input. Picks up
 * Obsidian-style live-preview decorations from the
 * `cm.markdown-extension` slot (cm-markdown plugin) so bold /
 * italic / code / strike / headings render inline as you type,
 * but strips the composer-specific machinery (file pills, image
 * pills, slash menu, vim mode, db client field, paste handlers).
 *
 * Optional typeahead triggers (passed via `triggers`) let callers add
 * `@mention` / `#issue`-style autocompletes. The editor owns the
 * trigger detection, caret-anchored popup, and keyboard handling;
 * callers only provide an async `fetch(query) => items` function and
 * a per-trigger empty-state label.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  className,
  onKeyDown,
  autoFocus,
  triggers,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // Markdown live-preview (and any other markdown CM extension)
  // from the `cm.markdown-extension` slot. Held in a compartment
  // so contributions can reconfigure without remounting.
  const contributed = useInjections<Extension>({
    kind: "cm.markdown-extension",
  })
  const mergedContributed = useMemo<readonly Extension[]>(
    () => contributed.map(e => e.value),
    [contributed],
  )
  const contributedRef = useRef<readonly Extension[]>(mergedContributed)
  contributedRef.current = mergedContributed
  const contributedCompRef = useRef<Compartment | null>(null)
  if (!contributedCompRef.current) {
    contributedCompRef.current = new Compartment()
  }

  // Keep callbacks fresh without rebuilding the view on every render.
  // Same trick `composer.tsx` uses for its update listener.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onKeyDownRef = useRef(onKeyDown)
  onKeyDownRef.current = onKeyDown
  const placeholderRef = useRef(placeholder ?? "")
  placeholderRef.current = placeholder ?? ""
  const placeholderCompRef = useRef<Compartment | null>(null)

  // Triggers are stored in a ref so the menu-detection code reads the
  // current config without us having to rebuild the editor every time
  // the parent passes a fresh array. The cache `fetch` returns is
  // owned by the trigger config; the editor just plumbs through.
  const triggersRef = useRef<readonly TypeaheadTrigger[]>(triggers ?? [])
  triggersRef.current = triggers ?? []
  const triggerCharsRef = useRef<readonly string[]>([])
  triggerCharsRef.current = useMemo(
    () => (triggers ?? []).map(t => t.char),
    [triggers],
  )
  // Flatten per-trigger detection options for `detectTrigger`. Keyed
  // by the trigger char so the detector can apply the right rule
  // without us re-walking the array on every keystroke.
  const triggerOptionsRef = useRef<TriggerOptions>({})
  triggerOptionsRef.current = useMemo(() => {
    const out: TriggerOptions = {}
    for (const t of triggers ?? []) {
      if (t.requireWhitespaceBefore) {
        out[t.char] = { requireWhitespaceBefore: true }
      }
    }
    return out
  }, [triggers])

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  // Live refs for keyboard handlers registered once into the keymap.
  const menuRef = useRef<MenuState | null>(menu)
  menuRef.current = menu
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex
  /** Increment-only sequence so an old in-flight `fetch` can't
   *  clobber the menu after a newer one already updated state. */
  const fetchSeqRef = useRef(0)

  // Mount once. Subsequent value / placeholder changes are pushed via
  // dispatch + reconfigure (see effects below).
  useEffect(() => {
    if (!hostRef.current) return
    const host = hostRef.current

    const theme = EditorView.theme({
      "&": {
        fontSize: "13px",
        lineHeight: "1.5",
        color: "var(--foreground)",
        background: "transparent",
        height: "100%",
      },
      "&.cm-focused": { outline: "none" },
      // CodeMirror's baseTheme sets `font-family: monospace` on
      // `.cm-scroller` (see @codemirror/view/dist/index.js,
      // baseTheme block). `.cm-content`, `.cm-line`,
      // `.cm-placeholder`, and every nested span inherit from
      // there, so one override on the scroller fixes every mono
      // leak at once.
      //
      // We need to *out-specificity* the baseTheme rule, not just
      // match it: themes added via `EditorView.theme()` and the
      // baseTheme can both end up at specificity (0,2,0), at which
      // point CSS source order decides, and CM's own ordering
      // doesn't reliably put user themes after baseTheme for this
      // selector. Setting `.cm-scroller` directly here resolves to
      // `.cm-editor.<themeID> .cm-scroller` = (0,3,0), which
      // unambiguously wins.
      ".cm-scroller": {
        padding: "8px 10px",
        overflow: "auto",
        fontFamily: "inherit",
      },
      ".cm-line": { padding: "0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "currentColor" },
      ".cm-selectionBackground, ::selection": {
        backgroundColor: "var(--accent)",
      },
      "&.cm-focused .cm-selectionBackground": {
        backgroundColor: "var(--accent)",
      },
      ".cm-placeholder": { color: "var(--muted-foreground)" },
    })

    const placeholderComp = new Compartment()
    placeholderCompRef.current = placeholderComp

    // Recompute the menu on any state change. Pure selection updates
    // can refine/close an open menu but never open a new one — that
    // matches the composer behaviour (arrowing into an `@something`
    // shouldn't pop the menu open).
    const recomputeMenu = (
      state: EditorState,
      view: EditorView,
      allowOpen: boolean,
    ) => {
      const chars = triggerCharsRef.current
      const trigger = chars.length
        ? detectTrigger(state, chars, triggerOptionsRef.current)
        : null
      if (!trigger) {
        if (menuRef.current) {
          setMenu(null)
          setSelectedIndex(0)
        }
        return
      }
      const config = triggersRef.current.find(t => t.char === trigger.char)
      if (!config) return
      const prev = menuRef.current
      const sameRun =
        prev != null &&
        prev.trigger === config &&
        prev.match.char === trigger.char &&
        prev.match.from === trigger.from
      if (!sameRun && !allowOpen) {
        // Selection-only update on a position that wasn't already
        // showing a menu — don't open one out of nowhere.
        return
      }

      const anchor = caretAnchor(view, trigger.from)
      const seq = ++fetchSeqRef.current
      setMenu({
        trigger: config,
        match: trigger,
        items: sameRun ? (prev?.items ?? []) : [],
        loading: true,
        anchor,
      })
      if (!sameRun) setSelectedIndex(0)

      config
        .fetch(trigger.query)
        .then(items => {
          if (fetchSeqRef.current !== seq) return
          // The trigger may have been cancelled while we waited.
          if (!menuRef.current) return
          setMenu(m =>
            m && m.match.from === trigger.from && m.match.char === trigger.char
              ? { ...m, items, loading: false }
              : m,
          )
          setSelectedIndex(idx => {
            if (items.length === 0) return 0
            return idx >= items.length ? 0 : idx
          })
        })
        .catch(() => {
          if (fetchSeqRef.current !== seq) return
          setMenu(m =>
            m && m.match.from === trigger.from && m.match.char === trigger.char
              ? { ...m, items: [], loading: false }
              : m,
          )
        })
    }

    const updateListener = EditorView.updateListener.of(update => {
      if (!update.docChanged && !update.selectionSet) return
      recomputeMenu(update.state, update.view, update.docChanged)
    })

    // Keyboard handlers for menu navigation. Registered with
    // `Prec.highest` so they win over CodeMirror's default `Tab`
    // (indent) and arrow handling whenever a menu is open. When no
    // menu is open the `run` callbacks return false and CM's
    // defaults take over.
    const navigate = (delta: number): boolean => {
      const current = menuRef.current
      if (!current || current.items.length === 0) return false
      const len = current.items.length
      setSelectedIndex(i => (i + delta + len) % len)
      return true
    }
    const accept = (): boolean => {
      const current = menuRef.current
      if (!current || current.items.length === 0) return false
      const item =
        current.items[
          Math.min(selectedIndexRef.current, current.items.length - 1)
        ]
      if (!item) return false
      const v = viewRef.current
      if (!v) return false
      v.dispatch({
        changes: {
          from: current.match.from,
          to: current.match.to,
          insert: item.insertText + " ",
        },
        selection: {
          anchor: current.match.from + item.insertText.length + 1,
        },
      })
      setMenu(null)
      setSelectedIndex(0)
      return true
    }
    const close = (): boolean => {
      if (!menuRef.current) return false
      setMenu(null)
      setSelectedIndex(0)
      return true
    }

    const menuKeymap = Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: () => navigate(1) },
        { key: "ArrowUp", run: () => navigate(-1) },
        { key: "Ctrl-n", run: () => navigate(1) },
        { key: "Ctrl-p", run: () => navigate(-1) },
        { key: "Enter", run: () => accept() },
        { key: "Tab", run: () => accept() },
        { key: "Escape", run: () => close() },
      ]),
    )

    const keyForwarder = EditorView.domEventHandlers({
      keydown(event) {
        onKeyDownRef.current?.(event)
        return false
      },
    })

    const extensions: Extension[] = [
      menuKeymap,
      history(),
      drawSelection(),
      contributedCompRef.current!.of(contributedRef.current as Extension[]),
      placeholderComp.of(cmPlaceholder(placeholderRef.current)),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      updateListener,
      keyForwarder,
      theme,
    ]

    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: value, extensions }),
    })
    viewRef.current = view

    if (autoFocus) view.focus()

    return () => {
      view.destroy()
      viewRef.current = null
      placeholderCompRef.current = null
    }
    // We only want to mount once. Subsequent `value` / `placeholder`
    // / `triggers` updates flow through their own effects / refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push controlled `value` changes into the doc when the caller
  // changes it from outside (programmatic set, e.g. "Generate with
  // AI" filling the body). Skip when the doc already matches — avoids
  // an infinite ping-pong with the update listener.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    const comp = placeholderCompRef.current
    if (!view || !comp) return
    view.dispatch({ effects: comp.reconfigure(cmPlaceholder(placeholder ?? "")) })
  }, [placeholder])

  useEffect(() => {
    const view = viewRef.current
    const comp = contributedCompRef.current
    if (!view || !comp) return
    view.dispatch({
      effects: comp.reconfigure(mergedContributed as Extension[]),
    })
  }, [mergedContributed])

  return (
    <>
      <div
        ref={hostRef}
        className={cn(
          // Visual parity with `<Textarea>` so callers can swap one for
          // the other without restyling. `focus-within` ring picks up
          // CodeMirror's internal focus state since the host div
          // itself is never the active element.
          "relative flex w-full overflow-hidden rounded border border-input bg-transparent text-sm shadow-xs transition-[color,box-shadow]",
          "focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring",
          className,
        )}
      />
      {menu && (
        <TypeaheadMenu
          items={menu.items}
          selectedIndex={selectedIndex}
          loading={menu.loading}
          emptyLabel={menu.trigger.emptyLabel}
          anchor={menu.anchor}
          onHover={setSelectedIndex}
          onSelect={item => {
            const v = viewRef.current
            if (!v) return
            v.dispatch({
              changes: {
                from: menu.match.from,
                to: menu.match.to,
                insert: item.insertText + " ",
              },
              selection: {
                anchor: menu.match.from + item.insertText.length + 1,
              },
            })
            setMenu(null)
            setSelectedIndex(0)
            v.focus()
          }}
        />
      )}
    </>
  )
}

function caretAnchor(
  view: EditorView,
  pos: number,
): { left: number; top: number; bottom: number } | null {
  const coords = view.coordsAtPos(pos)
  if (!coords) return null
  return { left: coords.left, top: coords.top, bottom: coords.bottom }
}

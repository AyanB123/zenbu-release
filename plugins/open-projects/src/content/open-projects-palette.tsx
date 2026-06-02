import {
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createRoot } from "react-dom/client"
import {
  useCollection,
  useDb,
  useEvents,
  useRpc,
  ZenbuProvider,
} from "@zenbujs/core/react"
import { Input } from "@zenbu/ui/input"
import { PaletteShell, PaletteRow } from "@zenbu/ui/palette"
import { useWindowId } from "@/lib/window-state/window-id"

/**
 * Open-projects palette.
 *
 * Index source: `db.openProjects.index.projects` (a collection
 * populated on boot by the utility-process scanner). We pull the
 * full collection up front via `useCollection`, then filter +
 * window in the renderer.
 *
 * Why a custom palette body (not `<Palette />` from `@zenbu/ui`):
 * the shared `Palette` renders every filtered item into a single
 * scrollable column. That's fine for the typical small palette
 * (recent workspaces, recent agents), but the project index can
 * easily hit a few thousand entries on a developer's `$HOME`.
 * We want to render the first ~80 and infinite-scroll the rest in.
 * `PaletteShell` + `PaletteRow` give us the same chrome with a
 * body we can take over.
 *
 * Activate path: `rpc.app.workspaces.createFromDirectory` \u2014 the
 * same RPC the legacy onboarding screen used. By the time it
 * resolves, the host has materialized a workspace + scope + chat
 * + pi session at the chosen folder and pointed the calling
 * window at it. The palette closes on activation.
 */

type ProjectEntry = {
  path: string
  name: string
  parent: string
  depth: number
  marker: string
}

/** How many rows we render on the first cut, and how many we add
 * each time the user scrolls past `INFINITE_SCROLL_TRIGGER_PX`
 * from the bottom. Tuned for a 360px-tall palette body \u2014 80 is
 * plenty more than fits on screen at once, so the infinite-scroll
 * effect kicks in only on real lists. */
const INITIAL_WINDOW = 80
const WINDOW_STEP = 80
const INFINITE_SCROLL_TRIGGER_PX = 240

function OpenProjectsPalette() {
  const events = useEvents()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const off = events.openProjects.togglePalette.subscribe(() => {
      setOpen(o => !o)
    })
    return () => off()
  }, [events])

  const close = useCallback(() => setOpen(false), [])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center pt-[12vh]"
      onClick={close}
    >
      <OpenProjectsPaletteBody onClose={close} />
    </div>
  )
}

function OpenProjectsPaletteBody({ onClose }: { onClose: () => void }) {
  const rpc = useRpc()
  const windowId = useWindowId()

  // Pull the index collection. `useCollection` subscribes on
  // mount and streams items as the worker publishes new batches,
  // so opening the palette while the scan is still running
  // shows results as they trickle in.
  const projectsRef = useDb(root => root.openProjects.index.projects)
  const { items: rawItems } = useCollection(projectsRef)
  const items = rawItems as ProjectEntry[]


  // MRU input for the unranked sort tiebreaker \u2014
  // `recentProjects` is the host's IDE-cache scrape (VS Code,
  // Cursor, etc.). We just want a Set<absolute path> we can look
  // up in for "this is a known recent project; float it up".
  const recentPathSet = useDb(root => {
    const set = new Set<string>()
    for (const r of Object.values(root.app.recentProjects)) {
      set.add(r.path)
    }
    return set
  })
  const recentLastOpenedAt = useDb(root => {
    const map = new Map<string, number>()
    for (const r of Object.values(root.app.recentProjects)) {
      map.set(r.path, r.lastOpenedAt)
    }
    return map
  })
  void recentPathSet // consumed via recentLastOpenedAt below

  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const [windowSize, setWindowSize] = useState(INITIAL_WINDOW)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  // Ref the *currently-selected* row threads onto. Plain ref
  // (not a querySelector lookup) so the scroll-into-view effect
  // doesn't have to walk the DOM on every selection change.
  const selectedRowRef = useRef<HTMLButtonElement | null>(null)
  const hover = useHoverIntent()

  // Focus the input the moment we mount.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // ---- filter + sort -------------------------------------------
  // We compute the full filtered+sorted list, then slice to the
  // visible window. Keyboard nav walks `filtered`, not the slice,
  // so arrowing past the end of the visible window auto-grows it
  // (see the scroll-into-view effect below).
  const filtered = useMemo(() => {
    // `sortFiltered` does its own normalize (lowercasing +
    // separator stripping), so we just pass the trimmed query
    // through. Empty after trim → unfiltered list.
    const q = query.trim()
    if (q.length === 0) {
      return sortUnfiltered(items, recentLastOpenedAt)
    }
    return sortFiltered(items, q, recentLastOpenedAt)
  }, [items, query, recentLastOpenedAt])

  // Reset the visible window + selection whenever the query
  // changes. The user's intent on typing is "show me the top
  // matches from the start", not "keep my scroll position".
  useEffect(() => {
    setWindowSize(INITIAL_WINDOW)
    setSelected(0)
  }, [query])

  // Clamp selection if the filtered list got shorter than where
  // we were sitting.
  useEffect(() => {
    if (selected >= filtered.length && filtered.length > 0) {
      setSelected(0)
    }
  }, [filtered.length, selected])

  // Auto-grow the window so the selected row is in the DOM. The
  // keyboard handler walks `filtered` (not the slice), so Ctrl-N
  // / ArrowDown can take the cursor past the visible edge — when
  // that happens we extend the window enough to render up to the
  // selected row + a small buffer.
  useEffect(() => {
    if (selected >= windowSize) {
      const needed = selected + 1
      setWindowSize(prev =>
        prev >= needed
          ? prev
          : prev + WINDOW_STEP * Math.ceil((needed - prev) / WINDOW_STEP),
      )
    }
  }, [selected, windowSize])

  const visible = useMemo(
    () => filtered.slice(0, windowSize),
    [filtered, windowSize],
  )

  // Scroll the selected row into view when the *selection*
  // changes. Deliberately NOT dependent on `visible` — if it
  // were, every infinite-scroll bump (which mutates `visible`)
  // would re-fire this and snap the scroll back to the selected
  // row, fighting the user's scroll wheel.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const row = selectedRowRef.current
    if (!scroller || !row) return
    const cRect = scroller.getBoundingClientRect()
    const rRect = row.getBoundingClientRect()
    const topDelta = rRect.top - cRect.top
    const bottomDelta = rRect.bottom - cRect.top
    if (topDelta < 0) {
      scroller.scrollTop += topDelta
    } else if (bottomDelta > scroller.clientHeight) {
      scroller.scrollTop += bottomDelta - scroller.clientHeight
    }
  }, [selected])

  // Infinite scroll: when the user nears the bottom, append the
  // next WINDOW_STEP items. Independent of the keyboard-driven
  // auto-grow above.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    if (windowSize >= filtered.length) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < INFINITE_SCROLL_TRIGGER_PX) {
      setWindowSize(prev =>
        prev >= filtered.length ? prev : prev + WINDOW_STEP,
      )
    }
  }, [windowSize, filtered.length])

  const setSelectedFromKeyboard = useCallback(
    (n: number | ((s: number) => number)) => {
      hover.resetToKeyboard()
      setSelected(n)
    },
    [hover],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      const len = filtered.length
      const plainCtrl =
        e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      if (e.key === "ArrowDown" || (plainCtrl && (e.key === "n" || e.key === "N"))) {
        e.preventDefault()
        if (len > 0) setSelectedFromKeyboard(s => (s + 1) % len)
        return
      }
      if (e.key === "ArrowUp" || (plainCtrl && (e.key === "p" || e.key === "P"))) {
        e.preventDefault()
        if (len > 0) setSelectedFromKeyboard(s => (s - 1 + len) % len)
        return
      }
      if (plainCtrl && (e.key === "d" || e.key === "D")) {
        e.preventDefault()
        if (len > 0) setSelectedFromKeyboard(s => Math.min(len - 1, s + 8))
        return
      }
      if (plainCtrl && (e.key === "u" || e.key === "U")) {
        e.preventDefault()
        if (len > 0) setSelectedFromKeyboard(s => Math.max(0, s - 8))
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        const item = filtered[selected]
        if (item) void activate(item)
      }
    },
    [filtered, selected, setSelectedFromKeyboard, onClose],
  )

  const activate = useCallback(
    async (entry: ProjectEntry) => {
      onClose()
      try {
        await rpc.app.workspaces.createFromDirectory({
          directory: entry.path,
          windowId,
        })
      } catch {
        // Swallow — a failed open just leaves the user where
        // they were.
      }
    },
    [rpc, windowId, onClose],
  )

  return (
    <PaletteShell
      header={
        <Input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Open project…"
          spellCheck={false}
          className="w-full rounded-none border-0 bg-transparent px-3 py-2 text-[13px] shadow-none focus-visible:ring-0"
        />
      }
    >
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        // Fixed height (not `max-h-`) so the popover doesn't pop
        // from a one-line "no projects found" placeholder to a
        // full 360px body when the index finishes loading. The
        // index can take a beat on cold start; locking the
        // height eliminates that single-frame layout shift.
        className="h-[360px] overflow-y-auto"
      >
        {/* No empty-state text at all — empty list, error,
          * mid-indexing, no matches … every case renders as a
          * blank rectangle inside the fixed-height scroller. The
          * input above is the only thing the user needs to see
          * when there are zero results. */}
        {visible.map((entry, i) => (
          <ProjectPaletteRow
            key={entry.path}
            entry={entry}
            isSelected={i === selected}
            rowRef={i === selected ? selectedRowRef : noopRef}
            onMouseMove={() => {
              if (hover.isActive()) setSelected(i)
            }}
            onActivate={() => void activate(entry)}
          />
        ))}
      </div>
    </PaletteShell>
  )
}

function ProjectPaletteRow({
  entry,
  isSelected,
  rowRef,
  onMouseMove,
  onActivate,
}: {
  entry: ProjectEntry
  isSelected: boolean
  rowRef: React.Ref<HTMLButtonElement>
  onMouseMove: () => void
  onActivate: () => void
}) {
  return (
    <PaletteRow
      isSelected={isSelected}
      rowRef={rowRef}
      onMouseMove={onMouseMove}
      onActivate={onActivate}
    >
      <span className="min-w-0 flex-1 truncate" title={entry.path}>
        <span className="text-popover-foreground">{entry.name}</span>
        <span className="ml-2 text-muted-foreground">
          {displayParent(entry.parent)}
        </span>
      </span>
    </PaletteRow>
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Sorting                                   */
/* -------------------------------------------------------------------------- */

/**
 * Unfiltered sort order (palette opens with empty query):
 *
 *   1. Recently opened in another IDE (per `db.app.recentProjects`)
 *      \u2014 highest `lastOpenedAt` wins.
 *   2. Shorter `depth` \u2014 keeps `~/code/foo` above
 *      `~/code/team/repo/foo`.
 *   3. Lexicographic on `name`.
 */
function sortUnfiltered(
  items: ProjectEntry[],
  lastOpenedAt: Map<string, number>,
): ProjectEntry[] {
  const out = items.slice()
  out.sort((a, b) => {
    const ta = lastOpenedAt.get(a.path)
    const tb = lastOpenedAt.get(b.path)
    if (ta != null || tb != null) {
      if (ta == null) return 1
      if (tb == null) return -1
      if (ta !== tb) return tb - ta
    }
    if (a.depth !== b.depth) return a.depth - b.depth
    return a.name.localeCompare(b.name)
  })
  return out
}

/**
 * Filtered sort order, given a query `q` (already lowercased):
 *
 *   1. Match bucket:
 *      a. basename startsWith q
 *      b. basename includes q
 *      c. path includes q
 *      d. subsequence in basename (typo / abbreviation
 *         tolerance: each char of the query appears in the
 *         basename in order),
 *      e. subsequence in path,
 *      f. (no match — dropped entirely)
 *   2. Inside the bucket, fall back to the unfiltered ordering.
 *
 * Both query and target strings are *normalized* before any of
 * the above so separator wiggles don't matter:
 *   `"my project"` → `"myproject"` (matches `"my-project"`)
 *   `"my_project"` → `"myproject"`
 *   `"my.proj"` → `"myproj"`
 * Subsequence then covers most typos *of the dropping-or-
 * inserting-a-char variety*, e.g. `"myproect"` still matches
 * `"my-project"` because m→y→p→r→o→e→c→t appears in
 * order. It deliberately won't match transposed adjacent chars
 * (`"myporject"`); we'd need real edit-distance for that, which
 * isn't worth the size today.
 */
function sortFiltered(
  items: ProjectEntry[],
  q: string,
  lastOpenedAt: Map<string, number>,
): ProjectEntry[] {
  type Bucketed = { entry: ProjectEntry; bucket: number }
  const qNorm = normalizeForMatch(q)
  // If the query collapses to nothing after normalization (e.g.
  // the user typed just a bunch of dashes), short-circuit
  // empty.
  if (qNorm.length === 0) return []
  const matched: Bucketed[] = []
  for (const entry of items) {
    const nameNorm = normalizeForMatch(entry.name)
    const pathNorm = normalizeForMatch(entry.path)
    if (nameNorm.startsWith(qNorm)) {
      matched.push({ entry, bucket: 0 })
    } else if (nameNorm.includes(qNorm)) {
      matched.push({ entry, bucket: 1 })
    } else if (pathNorm.includes(qNorm)) {
      matched.push({ entry, bucket: 2 })
    } else if (isSubsequence(qNorm, nameNorm)) {
      matched.push({ entry, bucket: 3 })
    } else if (isSubsequence(qNorm, pathNorm)) {
      matched.push({ entry, bucket: 4 })
    }
  }
  matched.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket
    const ta = lastOpenedAt.get(a.entry.path)
    const tb = lastOpenedAt.get(b.entry.path)
    if (ta != null || tb != null) {
      if (ta == null) return 1
      if (tb == null) return -1
      if (ta !== tb) return tb - ta
    }
    if (a.entry.depth !== b.entry.depth) return a.entry.depth - b.entry.depth
    return a.entry.name.localeCompare(b.entry.name)
  })
  return matched.map(m => m.entry)
}

/**
 * Collapse separators + lowercase. Treats whitespace, dashes,
 * underscores, dots, slashes (and backslashes for Windows-style
 * paths if any leak in) as equivalent and strips them all. This
 * is what makes `"my project"` match `"my-project"` and
 * `"openProjects"` match `"open-projects"` (after the lowercase
 * pass).
 */
function normalizeForMatch(s: string): string {
  // We also split camelCase into separator-less form by lowercasing
  // — `"openProjects"` → `"openprojects"` — because that's what
  // the user will type. We don't insert separators around case
  // changes; the strip below would just remove them anyway.
  return s.toLowerCase().replace(/[\s\-_./\\]+/g, "")
}

/**
 * True when every character of `needle` appears in `haystack` in
 * the same order (not necessarily contiguously). Both args are
 * expected to be normalized (lowercased, separator-stripped).
 *
 * Cheap: O(needle + haystack) and runs entirely on primitive
 * char codes. We re-run this per row on every keystroke, against
 * the (already pre-bucketed) miss list, so cheap matters.
 */
function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length === 0) return true
  if (needle.length > haystack.length) return false
  let i = 0
  for (let j = 0; j < haystack.length; j++) {
    if (haystack.charCodeAt(j) === needle.charCodeAt(i)) {
      i++
      if (i === needle.length) return true
    }
  }
  return false
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

const noopRef: React.Ref<HTMLButtonElement> = () => {}

/**
 * Collapse `$HOME` to `~` for display so paths read naturally.
 * We don't have `os.homedir()` over here in the renderer; we use
 * the same `app.env.homeDir` cache the rest of the renderer uses
 * via a synchronous closure. Stored in this module so we read it
 * once per palette render instead of once per row.
 */
let cachedHomeDir: string | null = null
function setHomeDir(h: string | null) {
  cachedHomeDir = h
}
function displayParent(parent: string): string {
  if (cachedHomeDir && parent.startsWith(cachedHomeDir + "/")) {
    return "~" + parent.slice(cachedHomeDir.length)
  }
  if (cachedHomeDir && parent === cachedHomeDir) {
    return "~"
  }
  return parent
}

/** Subscribes to `db.app.env.homeDir` so `displayParent` can
 * collapse paths without a `useDb` per row (which would re-fire
 * the row's render on unrelated env changes). */
function HomeDirSync() {
  const homeDir = useDb(root => root.app.env.homeDir)
  useEffect(() => {
    setHomeDir(homeDir ?? null)
  }, [homeDir])
  return null
}

/**
 * Gate hover-driven selection on real mouse movement. Layout
 * shifts when the palette mounts can synthesize `pointermove`
 * events at stationary coordinates; those would otherwise flip
 * the hover gate active before the user touched the mouse and
 * steal keyboard selection.
 */
function useHoverIntent() {
  const ref = useRef(false)
  useEffect(() => {
    ref.current = false
    let lastX: number | null = null
    let lastY: number | null = null
    const onMove = (e: PointerEvent) => {
      if (lastX !== null && e.clientX === lastX && e.clientY === lastY) return
      lastX = e.clientX
      lastY = e.clientY
      ref.current = true
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [])
  return useMemo(
    () => ({
      isActive: () => ref.current,
      resetToKeyboard: () => {
        ref.current = false
      },
    }),
    [],
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Mount                                     */
/* -------------------------------------------------------------------------- */

function mount() {
  if (document.body?.dataset.openProjectsPaletteMounted === "1") return
  if (document.body) document.body.dataset.openProjectsPaletteMounted = "1"

  const host = document.createElement("div")
  host.setAttribute("data-open-projects-palette", "1")
  document.body.appendChild(host)

  createRoot(host).render(
    <StrictMode>
      <ZenbuProvider>
        <HomeDirSync />
        <OpenProjectsPalette />
      </ZenbuProvider>
    </StrictMode>,
  )
}

mount()

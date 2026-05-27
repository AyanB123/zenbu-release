/**
 * `@zenbu/ui/list-nav`
 *
 * Declarative keyboard navigation for any list or tree in the
 * host. Three components and one hook:
 *
 *   - `<ListNav id>` — a focus scope with a single cursor. Mounts
 *     a wrapper with `data-zenbu-focus-context={id}`, registers
 *     the canonical eight shortcuts (j/k, h/l, Ctrl+d/Ctrl+u,
 *     Space, Enter) via the host's `listNav` service, and
 *     dispatches per-row behavior on arrival of the matching
 *     events.
 *   - `<ListNav.Branch>` — an expandable group. Owns `expanded`
 *     and `onToggle`; the primitive handles step-in / step-out /
 *     activate-on-branch automatically.
 *   - `<ListNav.Leaf>` — a row. `onActivate` is called by Space
 *     (and Enter, with `alt: true` so the consumer can branch).
 *
 * Composition is just "use more than one `<ListNav>`". The focus-
 * context system decides which `j` fires where. Cross-scope jumps
 * (e.g. right-arrow at the end of a column hops into the next
 * column) use the `onBoundary` prop together with the imperative
 * `useListNav(id).focus()` handle.
 *
 * The cursor itself is in a module-local store keyed by scopeId.
 * It's ephemeral interaction state — nothing about "which row the
 * keyboard cursor is parked on" deserves to persist across cold
 * launches.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { useEvents, useRpc } from "@zenbujs/core/react"

// ---- types ----------------------------------------------------------------

export type ListNavBinding = {
  key?: string
  code?: string
  meta?: boolean
  control?: boolean
  alt?: boolean
  shift?: boolean
}

export type ListNavActionKey =
  | "moveDown"
  | "moveUp"
  | "stepOut"
  | "stepIn"
  | "pageDown"
  | "pageUp"
  | "activate"
  | "activateAlt"

export type ListNavShortcutOverride =
  | false
  | { defaultBinding?: ListNavBinding | ListNavBinding[] }

export type ListNavBoundaryEdge = "start" | "end" | "left" | "right"

export type ListNavRowMeta = {
  id: string
  kind?: string
  isBranch: boolean
}

export type ListNavProps = {
  /** Stable scope id. Used as the focus-context id (so it forms
   *  the `when:` clause on every registered shortcut) and as the
   *  key for the cursor store + RPC registration. Convention:
   *  `<plugin>` for a sole list, `<plugin>.<region>` when there
   *  are multiple lists in one plugin. */
  id: string
  /** Human-readable label used as the settings-UI category for
   *  this scope's shortcuts. Falls back to `id`. */
  label?: string
  /** Seed the cursor when focus first lands on this list. If the
   *  row is currently rendered, this also takes precedence on
   *  remount (so re-opening a sidebar parks the cursor on the
   *  active item). */
  activeRowId?: string
  /** Per-action shortcut overrides. `false` drops the action;
   *  an object replaces (or augments) the default binding. */
  shortcuts?: Partial<Record<ListNavActionKey, ListNavShortcutOverride>>
  /** Catch-all activate handler. Usually you wire `onActivate`
   *  on a `<Leaf>` instead — this is for cases where the
   *  consumer wants one central dispatch. */
  onActivate?: (row: ListNavRowMeta & { alt: boolean }) => void
  /** Called when the cursor tries to leave the list. `start` and
   *  `end` fire from `moveUp` / `moveDown` past the edge.
   *  `left` and `right` fire from `stepOut` / `stepIn` when there
   *  is no branch to collapse / nothing to descend into. */
  onBoundary?: (edge: ListNavBoundaryEdge) => void
  /** Estimated row height in px, used for half-page math. */
  rowHeight?: number
  className?: string
  style?: React.CSSProperties
  children: ReactNode
}

export type ListNavHandle = {
  focus(): void
  setCursor(rowId: string | null): void
  getCursor(): string | null
}

// ---- cursor store (per scope) --------------------------------------------

type Listener = () => void

type ScopeStore = {
  rowId: string | null
  listeners: Set<Listener>
}

const stores = new Map<string, ScopeStore>()

function getStore(id: string): ScopeStore {
  let s = stores.get(id)
  if (!s) {
    s = { rowId: null, listeners: new Set() }
    stores.set(id, s)
  }
  return s
}

function getCursor(id: string): string | null {
  return getStore(id).rowId
}

function setCursor(id: string, rowId: string | null): void {
  const s = getStore(id)
  if (s.rowId === rowId) return
  s.rowId = rowId
  for (const l of s.listeners) l()
}

function subscribeCursor(id: string, l: Listener): () => void {
  const s = getStore(id)
  s.listeners.add(l)
  return () => {
    s.listeners.delete(l)
  }
}

// ---- imperative handle registry ------------------------------------------

const handles = new Map<string, ListNavHandle>()

/** Imperative access to a mounted `<ListNav>` by id. Returns a
 *  proxy that no-ops until the scope mounts, so it's safe to call
 *  unconditionally from `onBoundary` of a sibling scope. */
export function useListNav(id: string): ListNavHandle {
  return useMemo<ListNavHandle>(
    () => ({
      focus() {
        handles.get(id)?.focus()
      },
      setCursor(rowId: string | null) {
        handles.get(id)?.setCursor(rowId)
      },
      getCursor() {
        return handles.get(id)?.getCursor() ?? null
      },
    }),
    [id],
  )
}

// ---- internal context ----------------------------------------------------

type RowRegistration =
  | {
      kind: "leaf"
      id: string
      rowKind?: string
      onActivate?: (alt: boolean) => void
    }
  | {
      kind: "branch"
      id: string
      rowKind?: string
      expanded: boolean
      onToggle?: () => void
    }

type RegistryEntry = { current: RowRegistration }

type ListNavContextValue = {
  scopeId: string
  registry: Map<string, RegistryEntry>
}

const ListNavContext = createContext<ListNavContextValue | null>(null)

function useListNavContext(): ListNavContextValue {
  const ctx = useContext(ListNavContext)
  if (!ctx) {
    throw new Error(
      "<ListNav.Branch> / <ListNav.Leaf> must be rendered inside <ListNav>.",
    )
  }
  return ctx
}

// ---- helpers --------------------------------------------------------------

function findNearestScrollable(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null
  while (cur) {
    const style = getComputedStyle(cur)
    const oy = style.overflowY
    if (oy === "auto" || oy === "scroll" || oy === "overlay") {
      if (cur.scrollHeight > cur.clientHeight) return cur
    }
    cur = cur.parentElement
  }
  return null
}

function ensureInView(container: HTMLElement, row: HTMLElement): void {
  const cRect = container.getBoundingClientRect()
  const rRect = row.getBoundingClientRect()
  const topDelta = rRect.top - cRect.top
  const bottomDelta = rRect.bottom - cRect.top
  if (topDelta < 0) {
    container.scrollTop += topDelta
  } else if (bottomDelta > container.clientHeight) {
    container.scrollTop += bottomDelta - container.clientHeight
  }
}

/** Read the DOM in document order to get the currently-visible
 *  flat row list. Collapsed branches' children naturally drop out
 *  because the consumer doesn't render them. */
function readFlatRows(root: HTMLElement): string[] {
  const nodes = root.querySelectorAll<HTMLElement>("[data-list-nav-row-id]")
  const ids: string[] = []
  for (const n of nodes) {
    const id = n.dataset.listNavRowId
    if (id) ids.push(id)
  }
  return ids
}

function findRowEl(
  root: HTMLElement,
  rowId: string,
): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `[data-list-nav-row-id="${CSS.escape(rowId)}"]`,
  )
}

function nearestBranchAncestorId(el: HTMLElement): string | null {
  let cur: HTMLElement | null = el.parentElement
  while (cur) {
    if (cur.dataset.listNavBranchId) return cur.dataset.listNavBranchId
    cur = cur.parentElement
  }
  return null
}

// ---- <ListNav> -----------------------------------------------------------

export function ListNav(props: ListNavProps) {
  const {
    id,
    label,
    activeRowId,
    shortcuts,
    onActivate,
    onBoundary,
    rowHeight = 24,
    className,
    style,
    children,
  } = props

  const rpc = useRpc() as {
    app: {
      listNav: {
        registerScope: (args: {
          id: string
          label?: string
          shortcuts?: ListNavProps["shortcuts"]
        }) => Promise<void> | void
        unregisterScope: (args: { id: string }) => Promise<void> | void
      }
    }
  }
  const events = useEvents() as {
    app: {
      listNavMove: {
        subscribe: (
          cb: (e: { scopeId: string; dir: "up" | "down" }) => void,
        ) => () => void
      }
      listNavStep: {
        subscribe: (
          cb: (e: { scopeId: string; dir: "in" | "out" }) => void,
        ) => () => void
      }
      listNavPage: {
        subscribe: (
          cb: (e: { scopeId: string; dir: "up" | "down" }) => void,
        ) => () => void
      }
      listNavActivate: {
        subscribe: (
          cb: (e: { scopeId: string; alt: boolean }) => void,
        ) => () => void
      }
    }
  }

  const rootRef = useRef<HTMLDivElement | null>(null)
  const registry = useMemo(() => new Map<string, RegistryEntry>(), [])
  const contextValue = useMemo<ListNavContextValue>(
    () => ({ scopeId: id, registry }),
    [id, registry],
  )

  // --- shortcut registration -------------------------------------------
  //
  // Serialize the overrides to a stable string so registerScope only
  // re-runs when the override shape actually changes. The service
  // de-dupes idempotently, but a stable dep avoids burning RPCs every
  // render.
  const shortcutsKey = useMemo(
    () => JSON.stringify(shortcuts ?? null),
    [shortcuts],
  )
  useEffect(() => {
    let cancelled = false
    void Promise.resolve(
      rpc.app.listNav.registerScope({ id, label, shortcuts }),
    )
    return () => {
      cancelled = true
      void Promise.resolve(rpc.app.listNav.unregisterScope({ id }))
      void cancelled
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, label, shortcutsKey])

  // --- imperative handle ---------------------------------------------
  useEffect(() => {
    const handle: ListNavHandle = {
      focus() {
        rootRef.current?.focus({ preventScroll: true })
        // Seed cursor on first focus if empty.
        if (getCursor(id) == null) {
          const root = rootRef.current
          if (!root) return
          const rows = readFlatRows(root)
          if (rows.length === 0) return
          const seed =
            activeRowId && rows.includes(activeRowId)
              ? activeRowId
              : rows[0]!
          setCursor(id, seed)
        }
      },
      setCursor(rowId) {
        setCursor(id, rowId)
      },
      getCursor() {
        return getCursor(id)
      },
    }
    handles.set(id, handle)
    return () => {
      if (handles.get(id) === handle) handles.delete(id)
    }
  }, [id, activeRowId])

  // --- keep cursor valid against the live DOM ------------------------
  //
  // After every render, if the current row no longer exists (e.g. a
  // group was collapsed or a chat archived), park on the closest
  // surviving neighbour. Also seed from `activeRowId` the first time
  // we render with any rows visible.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const rows = readFlatRows(root)
    if (rows.length === 0) {
      if (getCursor(id) != null) setCursor(id, null)
      return
    }
    const cur = getCursor(id)
    if (cur == null) {
      // Seed only if the consumer told us about an active row; otherwise
      // wait for an explicit focus before parking on row 0.
      if (activeRowId && rows.includes(activeRowId)) {
        setCursor(id, activeRowId)
      }
      return
    }
    if (!rows.includes(cur)) {
      setCursor(id, rows[0]!)
    }
  })

  // --- scroll cursor into view ---------------------------------------
  useLayoutEffect(() => {
    const cur = getCursor(id)
    if (cur == null) return
    const root = rootRef.current
    if (!root) return
    const el = findRowEl(root, cur)
    if (!el) return
    const scroller =
      findNearestScrollable(el) ??
      (getComputedStyle(root).overflowY !== "visible" ? root : null)
    if (scroller) ensureInView(scroller, el)
    else el.scrollIntoView({ block: "nearest" })
  })

  // --- event handlers ------------------------------------------------

  const halfPageDelta = useCallback((): number => {
    const root = rootRef.current
    if (!root) return 10
    const scroller =
      findNearestScrollable(
        root.querySelector<HTMLElement>("[data-list-nav-row-id]") ?? root,
      ) ?? root
    const h = scroller.clientHeight
    if (h <= 0) return 10
    return Math.max(1, Math.floor(h / rowHeight / 2))
  }, [rowHeight])

  const moveBy = useCallback(
    (delta: number) => {
      const root = rootRef.current
      if (!root) return
      const rows = readFlatRows(root)
      if (rows.length === 0) return
      const cur = getCursor(id)
      if (cur == null) {
        setCursor(id, delta > 0 ? rows[0]! : rows[rows.length - 1]!)
        return
      }
      const idx = rows.indexOf(cur)
      if (idx === -1) {
        setCursor(id, rows[0]!)
        return
      }
      const next = idx + delta
      if (next < 0) {
        onBoundary?.("start")
        return
      }
      if (next > rows.length - 1) {
        onBoundary?.("end")
        return
      }
      setCursor(id, rows[next]!)
    },
    [id, onBoundary],
  )

  const stepOut = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const cur = getCursor(id)
    if (cur == null) return
    const el = findRowEl(root, cur)
    if (!el) return
    const entry = registry.get(cur)?.current
    if (entry?.kind === "branch") {
      // On an expanded branch: collapse. On a collapsed branch:
      // move up to parent branch if any, else boundary.
      if (entry.expanded) {
        entry.onToggle?.()
        return
      }
      const parent = nearestBranchAncestorId(el)
      if (parent) setCursor(id, parent)
      else onBoundary?.("left")
      return
    }
    // Leaf: jump to nearest branch ancestor.
    const parent = nearestBranchAncestorId(el)
    if (parent) {
      setCursor(id, parent)
      return
    }
    onBoundary?.("left")
  }, [id, registry, onBoundary])

  const stepIn = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const cur = getCursor(id)
    if (cur == null) return
    const entry = registry.get(cur)?.current
    if (entry?.kind === "branch") {
      if (!entry.expanded) {
        entry.onToggle?.()
        return
      }
      // Already expanded: move to first child (next row in flat list
      // that has us as the nearest branch ancestor).
      const branchEl = root.querySelector<HTMLElement>(
        `[data-list-nav-branch-id="${CSS.escape(cur)}"]`,
      )
      if (!branchEl) return
      const firstChild = branchEl.querySelector<HTMLElement>(
        "[data-list-nav-row-id]",
      )
      const firstChildId = firstChild?.dataset.listNavRowId
      if (firstChildId && firstChildId !== cur) {
        setCursor(id, firstChildId)
      } else {
        onBoundary?.("right")
      }
      return
    }
    // Leaf: nothing to step into.
    onBoundary?.("right")
  }, [id, registry, onBoundary])

  const activate = useCallback(
    (alt: boolean) => {
      const cur = getCursor(id)
      if (cur == null) return
      const entry = registry.get(cur)?.current
      if (!entry) return
      if (entry.kind === "leaf") {
        if (onActivate)
          onActivate({
            id: entry.id,
            kind: entry.rowKind,
            isBranch: false,
            alt,
          })
        entry.onActivate?.(alt)
        return
      }
      if (onActivate)
        onActivate({
          id: entry.id,
          kind: entry.rowKind,
          isBranch: true,
          alt,
        })
      entry.onToggle?.()
    },
    [id, registry, onActivate],
  )

  useEffect(() => {
    const offs: Array<() => void> = []
    offs.push(
      events.app.listNavMove.subscribe(e => {
        if (e.scopeId !== id) return
        rootRef.current?.focus({ preventScroll: true })
        moveBy(e.dir === "down" ? 1 : -1)
      }),
    )
    offs.push(
      events.app.listNavStep.subscribe(e => {
        if (e.scopeId !== id) return
        rootRef.current?.focus({ preventScroll: true })
        if (e.dir === "in") stepIn()
        else stepOut()
      }),
    )
    offs.push(
      events.app.listNavPage.subscribe(e => {
        if (e.scopeId !== id) return
        rootRef.current?.focus({ preventScroll: true })
        moveBy(e.dir === "down" ? halfPageDelta() : -halfPageDelta())
      }),
    )
    offs.push(
      events.app.listNavActivate.subscribe(e => {
        if (e.scopeId !== id) return
        activate(e.alt)
      }),
    )
    return () => {
      for (const off of offs) off()
    }
  }, [id, events, moveBy, stepIn, stepOut, halfPageDelta, activate])

  return (
    <ListNavContext.Provider value={contextValue}>
      <div
        ref={rootRef}
        tabIndex={-1}
        data-zenbu-focus-context={id}
        data-zenbu-list-nav=""
        className={className}
        style={style}
      >
        {children}
      </div>
    </ListNavContext.Provider>
  )
}

// ---- <ListNav.Leaf> ------------------------------------------------------

export type ListNavLeafProps = {
  id: string
  kind?: string
  onActivate?: (alt: boolean) => void
  className?: string
  children: ReactNode
}

function Leaf(props: ListNavLeafProps) {
  const { id, kind, onActivate, className, children } = props
  const ctx = useListNavContext()
  const reactKey = useId()

  // Keep the registry entry's `current` pointer stable; just mutate
  // fields so handlers always see latest props without forcing
  // re-registration.
  const entryRef = useRef<RegistryEntry>({
    current: { kind: "leaf", id, rowKind: kind, onActivate },
  })
  entryRef.current.current = {
    kind: "leaf",
    id,
    rowKind: kind,
    onActivate,
  }

  useEffect(() => {
    ctx.registry.set(id, entryRef.current)
    return () => {
      if (ctx.registry.get(id) === entryRef.current) {
        ctx.registry.delete(id)
      }
    }
  }, [ctx.registry, id])

  const isCursor = useSyncExternalStore(
    (cb: Listener) => subscribeCursor(ctx.scopeId, cb),
    () => getCursor(ctx.scopeId) === id,
    () => getCursor(ctx.scopeId) === id,
  )

  return (
    <div
      data-list-nav-row-id={id}
      data-list-nav-kind={kind}
      data-cursor-key={id}
      data-cursor-on={isCursor ? "" : undefined}
      data-react-key={reactKey}
      className={className}
    >
      {children}
    </div>
  )
}

// ---- <ListNav.Branch> ----------------------------------------------------

export type ListNavBranchProps = {
  id: string
  kind?: string
  expanded: boolean
  onToggle?: () => void
  /** The branch's own row (typically a header). Rendered at the
   *  top of the branch and treated as a focusable row in its own
   *  right. */
  header: ReactNode
  /** Visible only when `expanded` is true. */
  children?: ReactNode
  /** Wrapper className applied to the branch container. The
   *  header row carries its own `data-cursor-on` highlight. */
  className?: string
}

function Branch(props: ListNavBranchProps) {
  const {
    id,
    kind,
    expanded,
    onToggle,
    header,
    children,
    className,
  } = props
  const ctx = useListNavContext()

  const entryRef = useRef<RegistryEntry>({
    current: {
      kind: "branch",
      id,
      rowKind: kind,
      expanded,
      onToggle,
    },
  })
  entryRef.current.current = {
    kind: "branch",
    id,
    rowKind: kind,
    expanded,
    onToggle,
  }

  useEffect(() => {
    ctx.registry.set(id, entryRef.current)
    return () => {
      if (ctx.registry.get(id) === entryRef.current) {
        ctx.registry.delete(id)
      }
    }
  }, [ctx.registry, id])

  const isCursor = useSyncExternalStore(
    (cb: Listener) => subscribeCursor(ctx.scopeId, cb),
    () => getCursor(ctx.scopeId) === id,
    () => getCursor(ctx.scopeId) === id,
  )

  return (
    <div
      data-list-nav-branch-id={id}
      data-list-nav-kind={kind}
      className={className}
    >
      <div
        data-list-nav-row-id={id}
        data-list-nav-kind={kind}
        data-list-nav-leaf="false"
        data-cursor-key={id}
        data-cursor-on={isCursor ? "" : undefined}
      >
        {header}
      </div>
      {expanded ? children : null}
    </div>
  )
}

// Attach Branch + Leaf as static properties to mirror common React
// "namespace" components (e.g. `Dialog.Trigger`). The named exports
// below are for the rare consumer that prefers `import { Leaf }`.
ListNav.Branch = Branch
ListNav.Leaf = Leaf

export { Branch as ListNavBranch, Leaf as ListNavLeaf }

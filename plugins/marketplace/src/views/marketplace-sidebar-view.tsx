import { useEffect, useMemo, useRef, useState } from "react"
import {
  useDb,
  useDbClient,
  useEvents,
  useRpc,
} from "@zenbujs/core/react"
import type { DbClient } from "@zenbujs/core/react"
import { Button } from "@zenbu/ui/button"
import { Input } from "@zenbu/ui/input"
import { cn } from "@zenbu/ui/utils"
import { PLUGINS, SCREENSHOTS } from "./mock-data"
import type { MarketplacePlugin } from "./mock-data"

// Local copy of the host's sidebar-footer geometry constants — the
// app plugin's `SidebarFooter` lives under `@/components/...`,
// which isn't a path this plugin can reach. We re-create the same
// 44px footer + 24px gradient-fade pad so the bottom rows of the
// list dissolve under the "Create Plugin" button the same way they
// dissolve in the agent sidebar.
const SIDEBAR_FOOTER_HEIGHT = 44
const SIDEBAR_FOOTER_FADE = 24
const BODY_BOTTOM_PAD = SIDEBAR_FOOTER_HEIGHT + SIDEBAR_FOOTER_FADE

// Swap timing matches the deleted plugins-root sidebar's animation
// so the gesture feels identical.
const SWAP_MS = 220

const PLUGIN_NAME_RE = /^[a-z][a-z0-9-]*$/

/**
 * Marketplace left-sidebar view.
 *
 * Two list modes driven by the search input:
 *
 *  - **Idle (empty query)**: shows the user's *installed* plugins,
 *    sourced from `root.app.plugins` (the host's
 *    `PluginRegistryMirrorService` writes this). Icons hydrate
 *    through a plugin-local image cache mirroring the host's
 *    `image-cache.ts`.
 *  - **Searching (non-empty query)**: switches to the marketplace
 *    mock catalog, filtered against name / tagline / author / tags.
 *
 * Both modes route clicks through
 * `rpc.marketplace.marketplace.openDetailInPane`, which fires
 * `openViewInActivePane` with a *shared* `source: "marketplace"`
 * token. First click spawns a pane tab; subsequent clicks reuse
 * it (file-tree-sidebar pattern).
 *
 * Plus a third, modal-ish state:
 *
 *  - **Create**: a swap-pane (slides in from the right) reached
 *    from the bottom "Create Plugin" button. Three phases:
 *      1. name input
 *      2. running (spinner only)
 *      3. done (header morphs to the new plugin name + an "Open
 *         in Workspace" button). The done phase auto-opens the
 *         new plugin's worktree in a new BrowserWindow via
 *         `rpc.app.pluginsRootView.openPluginInNewWindow`, same
 *         RPC the old plugins-root sidebar used.
 */
export default function MarketplaceSidebarView() {
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const trimmed = query.trim()
  const isSearching = trimmed.length > 0

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden text-[13px]">
      <SwapPane active={!creating} side="list">
        <ListPane
          query={query}
          onQueryChange={setQuery}
          isSearching={isSearching}
          onNewPlugin={() => setCreating(true)}
        />
      </SwapPane>
      <SwapPane active={creating} side="create">
        <CreatePluginPane
          active={creating}
          onBack={() => setCreating(false)}
        />
      </SwapPane>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Swap-pane wrapper. Same shape as the old plugins-root sidebar:
// list lives offstage to the left when inactive, create lives
// offstage to the right.

function SwapPane({
  active,
  side,
  children,
}: {
  active: boolean
  side: "list" | "create"
  children: React.ReactNode
}) {
  const offsetPx = 12
  const translate = active ? 0 : side === "list" ? -offsetPx : offsetPx
  return (
    <div
      aria-hidden={!active}
      style={{
        transform: `translateX(${translate}px)`,
        opacity: active ? 1 : 0,
        transition: `opacity ${SWAP_MS}ms ease, transform ${SWAP_MS}ms ease`,
        pointerEvents: active ? "auto" : "none",
      }}
      className="absolute inset-0 flex min-h-0 min-w-0 flex-col"
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// List pane (the default surface — search + body + bottom footer).

function ListPane({
  query,
  onQueryChange,
  isSearching,
  onNewPlugin,
}: {
  query: string
  onQueryChange: (q: string) => void
  isSearching: boolean
  onNewPlugin: () => void
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div
        className="flex shrink-0 flex-col gap-1.5 px-1.5 pt-1.5 pb-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <SearchInput value={query} onChange={onQueryChange} />
      </div>
      <div
        className="relative min-h-0 flex-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div
          className="absolute inset-0 overflow-auto px-1.5"
          style={{ paddingBottom: BODY_BOTTOM_PAD }}
        >
          {isSearching ? (
            <MarketplaceResults query={query.trim()} />
          ) : (
            <InstalledList />
          )}
        </div>
        <SidebarFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onNewPlugin}
            className="h-8 w-full justify-center bg-transparent font-medium hover:bg-foreground/[0.04]"
          >
            Create Plugin
          </Button>
        </SidebarFooter>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Installed list (when search is empty).

type PluginEntry = {
  name: string
  dir: string
  kind?: "plugin" | "pi-extension"
  tag?: "core" | "pi" | null
}

type PluginIconRecord = {
  blobId: string
  mime: string
  sourcePath: string
  hash: string
}

function InstalledList() {
  const installed =
    (useDb(root => root.app.plugins) as PluginEntry[] | undefined) ?? []
  const icons =
    (useDb(root => root.app.pluginIcons) as
      | Record<string, PluginIconRecord>
      | undefined) ?? {}

  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-1.5 pt-1 pb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        Installed
      </div>
      {installed.length === 0 ? (
        <div className="px-2 py-6 text-center text-muted-foreground">
          No plugins installed.
        </div>
      ) : (
        installed.map(plugin => (
          <InstalledRow
            key={`${plugin.kind ?? "plugin"}:${plugin.name}`}
            plugin={plugin}
            icon={icons[plugin.name] ?? null}
          />
        ))
      )}
    </div>
  )
}

function InstalledRow({
  plugin,
  icon,
}: {
  plugin: PluginEntry
  icon: PluginIconRecord | null
}) {
  const rpc = useRpc()
  const onClick = () => {
    void rpc.marketplace.marketplace
      .openDetailInPane({ pluginId: plugin.name })
      .catch(err => {
        console.error(
          "[marketplace-sidebar] openDetailInPane failed:",
          err,
        )
      })
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full min-w-0 cursor-default select-none items-center gap-2",
        "rounded-md py-1.5 pl-1.5 pr-2 text-left text-sidebar-foreground",
        "hover:bg-foreground/[0.04]",
      )}
    >
      <InstalledIconSlot plugin={plugin} icon={icon} />
      <span className="min-w-0 flex-1 truncate">
        {prettifyName(plugin.name)}
      </span>
    </button>
  )
}

function InstalledIconSlot({
  plugin,
  icon,
}: {
  plugin: PluginEntry
  icon: PluginIconRecord | null
}) {
  // Pi extensions ship without an icon blob (they're single-file
  // `.ts` modules under `~/.pi/agent/extensions/`), so the icon
  // lookup always misses for them. Give them their own dedicated
  // glyph (the pi mark) so they're distinguishable at a glance
  // from regular zenbu plugins instead of all falling back to the
  // generic puzzle.
  if (plugin.kind === "pi-extension") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground">
        <PiIcon />
      </span>
    )
  }
  if (!icon) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
        <PuzzleIcon />
      </span>
    )
  }
  return <InstalledIconImage icon={icon} size={16} />
}

// Plugin-local image cache. Same shape as the host's
// `image-cache.ts` (single Map keyed by blobId; inflight de-dup
// for concurrent renders), inlined here so the marketplace plugin
// doesn't reach into the host's renderer source tree.
const imageCache = new Map<string, string>()
const imageInflight = new Map<string, Promise<string | null>>()

function getCachedImage(blobId: string): string | null {
  return imageCache.get(blobId) ?? null
}

async function hydratePluginIcon(
  blobId: string,
  mime: string,
  client: DbClient,
): Promise<string | null> {
  const have = imageCache.get(blobId)
  if (have) return have
  const pending = imageInflight.get(blobId)
  if (pending) return pending
  const p = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await (client as any).getBlobData(blobId)
      if (!data) return null
      const blob = new Blob([data as BlobPart], { type: mime })
      const url = URL.createObjectURL(blob)
      imageCache.set(blobId, url)
      return url
    } finally {
      imageInflight.delete(blobId)
    }
  })()
  imageInflight.set(blobId, p)
  return p
}

function InstalledIconImage({
  icon,
  size,
}: {
  icon: PluginIconRecord
  size: number
}) {
  const dbClient = useDbClient()
  const [url, setUrl] = useState<string | null>(() => getCachedImage(icon.blobId))
  useEffect(() => {
    let cancelled = false
    if (url) return
    void hydratePluginIcon(icon.blobId, icon.mime, dbClient).then(u => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [icon.blobId, icon.mime, dbClient, url])
  useEffect(() => {
    setUrl(getCachedImage(icon.blobId))
  }, [icon.blobId])
  const dim = `${size}px`
  if (!url) {
    return (
      <span
        className="flex shrink-0 items-center justify-center text-muted-foreground"
        style={{ width: dim, height: dim }}
      >
        <PuzzleIcon />
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-sm"
      style={{ width: dim, height: dim, objectFit: "contain" }}
      draggable={false}
    />
  )
}

function prettifyName(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// ---------------------------------------------------------------------------
// Marketplace results (when the user has typed a query).

function MarketplaceResults({ query }: { query: string }) {
  const rpc = useRpc()
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    const sorted = PLUGINS.slice().sort((a, b) => b.installs - a.installs)
    return sorted.filter(p =>
      [p.name, p.tagline, p.author, p.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
  }, [query])

  const openDetail = (plugin: MarketplacePlugin) => {
    void rpc.marketplace.marketplace
      .openDetailInPane({ pluginId: plugin.id })
      .catch(err => {
        console.error(
          "[marketplace-sidebar] openDetailInPane failed:",
          err,
        )
      })
  }

  if (filtered.length === 0) {
    return (
      <div className="px-2 py-6 text-center text-muted-foreground">
        No matches.
      </div>
    )
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {filtered.map(plugin => (
        <MarketplaceRow
          key={plugin.id}
          plugin={plugin}
          onClick={() => openDetail(plugin)}
        />
      ))}
    </ul>
  )
}

function MarketplaceRow({
  plugin,
  onClick,
}: {
  plugin: MarketplacePlugin
  onClick: () => void
}) {
  return (
    <li className="contents">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex w-full min-w-0 cursor-default select-none items-start gap-2.5 overflow-hidden",
          "rounded-md p-1.5 text-left text-sidebar-foreground",
          "hover:bg-foreground/[0.04]",
        )}
      >
        <MarketplaceThumb plugin={plugin} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="min-w-0 truncate text-[12.5px] font-semibold text-foreground">
              {plugin.name}
            </span>
            <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
              v{plugin.version}
            </span>
          </div>
          <p className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
            {plugin.tagline}
          </p>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span className="min-w-0 truncate">{plugin.author}</span>
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
            <span className="shrink-0 tabular-nums">
              {formatCount(plugin.installs)}
            </span>
          </div>
        </div>
      </button>
    </li>
  )
}

function MarketplaceThumb({ plugin }: { plugin: MarketplacePlugin }) {
  const screenshot = SCREENSHOTS[plugin.id]
  if (screenshot) {
    return (
      <div
        className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border/60"
        aria-hidden
      >
        <img
          src={screenshot}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    )
  }
  return (
    <div
      className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-white"
      style={{ background: plugin.color, fontSize: 16 }}
      aria-hidden
    >
      {plugin.glyph}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create-plugin pane.
//
// Three phases (same shape as the deleted plugins-root sidebar):
//   1. "name"    — name entry + Create button.
//   2. "running" — Creating… spinner (no per-step log).
//   3. "done"    — header morphs to the new plugin's name and the
//                  body becomes an "Open in Workspace" button.
//
// On entering "done" we auto-open the workspace once. The button
// stays available so the user can re-open it.

type CreatePhase =
  | { kind: "name" }
  | { kind: "running"; runId: string }
  | { kind: "done"; pluginName: string; pluginDir: string }

function normalizePluginName(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-")
}

function CreatePluginPane({
  active,
  onBack,
}: {
  active: boolean
  onBack: () => void
}) {
  const rpc = useRpc()
  const events = useEvents()
  const openedRef = useRef<string | null>(null)
  const [name, setName] = useState("")
  const [phase, setPhase] = useState<CreatePhase>({ kind: "name" })
  const [error, setError] = useState<string | null>(null)
  // Tracks the runId we're waiting on. Lives in a ref (not
  // `phase.runId`) because the event subscriber attaches on
  // pane-mount — *before* `handleSubmit` knows the runId — and
  // needs to filter incoming events without re-subscribing every
  // time `phase` flips.
  const currentRunId = useRef<string | null>(null)

  // Reset whenever the pane is re-entered. Stale errors from a
  // prior run would be confusing if the user backed out and came
  // back.
  useEffect(() => {
    if (!active) return
    setName("")
    setPhase({ kind: "name" })
    setError(null)
    openedRef.current = null
    currentRunId.current = null
    // Defer autofocus until the swap finishes so focus actually
    // lands once the pane is interactive (pointer-events flip with
    // `active`).
    const t = setTimeout(() => {
      const el = document.getElementById(
        "marketplace-plugin-name",
      ) as HTMLInputElement | null
      el?.focus()
    }, SWAP_MS)
    return () => clearTimeout(t)
  }, [active])

  // Subscribe to the done event as soon as the create pane is
  // active, *not* when `phase === "running"`. The service's
  // `run()` fires through `queueMicrotask` and can emit
  // `createPluginDone(ok: false)` faster than the IPC response
  // carrying our runId returns to the renderer (the fast-fail
  // path, e.g. "no plugin host workspace"). If the subscriber
  // attached on phase === "running", that early done event would
  // arrive before the subscription existed, leaving the UI stuck
  // on the spinner. Attaching on pane-mount means the subscriber
  // is always live by the time the service emits.
  useEffect(() => {
    if (!active) return
    // We *don't* subscribe to `createPluginProgress` here — the
    // surface is just a spinner + final status, so per-step logs
    // aren't shown to the user. The events still stream to the
    // main-process console (e.g. via `console` in `step()`), but
    // the renderer doesn't render them.
    const offDone = events.app.createPluginDone.subscribe(p => {
      if (p.runId !== currentRunId.current) return
      currentRunId.current = null
      if (!p.ok) {
        setError(p.error ?? "create-plugin failed")
        setPhase({ kind: "name" })
        return
      }
      if (p.pluginName && p.worktreePath) {
        setPhase({
          kind: "done",
          pluginName: p.pluginName,
          pluginDir: p.worktreePath,
        })
      }
    })
    return () => {
      offDone()
    }
  }, [active, events])

  // Auto-open the workspace as soon as we enter the "done" phase.
  // We can't go through a name-based lookup (the registry mirror
  // hasn't populated yet for a brand-new plugin); passing the
  // worktree path straight through skips it. `openedRef` guards
  // against the effect re-firing.
  useEffect(() => {
    if (phase.kind !== "done") return
    if (openedRef.current === phase.pluginName) return
    openedRef.current = phase.pluginName
    void rpc.app.pluginsRootView
      .openPluginInNewWindow({
        pluginName: phase.pluginName,
        pluginDir: phase.pluginDir,
      })
      .catch(err => {
        console.error(
          "[marketplace-sidebar] auto openPluginInNewWindow failed:",
          err,
        )
      })
  }, [phase, rpc])

  const trimmedName = name.replace(/^-+|-+$/g, "")
  const nameValid = PLUGIN_NAME_RE.test(trimmedName)
  const running = phase.kind === "running"
  const done = phase.kind === "done"
  const canSubmit = !running && !done && nameValid

  const headerLabel = done
    ? prettifyName((phase as { pluginName: string }).pluginName)
    : "Create plugin"

  const handleOpenWorkspace = () => {
    if (phase.kind !== "done") return
    void rpc.app.pluginsRootView
      .openPluginInNewWindow({
        pluginName: phase.pluginName,
        pluginDir: phase.pluginDir,
      })
      .catch(err => {
        console.error(
          "[marketplace-sidebar] openPluginInNewWindow failed:",
          err,
        )
      })
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSubmit) return
    setError(null)
    try {
      const { runId } = await rpc.app.createPlugin.createPlugin({
        name: trimmedName,
      })
      // Set the ref *before* the state update so any
      // already-queued progress event for this runId can match.
      // (The mount-time subscriber filters on this ref.)
      currentRunId.current = runId
      setPhase({ kind: "running", runId })
    } catch (err) {
      currentRunId.current = null
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <button
        type="button"
        onClick={running ? undefined : onBack}
        disabled={running}
        aria-label="Back to plugins"
        className="group grid w-full shrink-0 grid-cols-[20px_1fr_20px] items-center gap-2 px-2 py-2 text-left hover:bg-foreground/[0.04] disabled:opacity-60 disabled:hover:bg-transparent"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground group-hover:text-foreground"
          aria-hidden
        >
          <BackIcon />
        </span>
        <div className="flex min-w-0 items-center justify-center gap-2">
          {done && (
            <span
              className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-muted-foreground"
              aria-hidden
            >
              <PuzzleIcon />
            </span>
          )}
          <span className="min-w-0 truncate font-medium text-foreground">
            {headerLabel}
          </span>
        </div>
        <span aria-hidden />
      </button>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex flex-col gap-3 overflow-auto px-3 pb-3 pt-1">
          {done ? (
            <button
              type="button"
              onClick={handleOpenWorkspace}
              className="flex items-center justify-center rounded-md border border-border/60 px-2.5 py-1.5 font-medium text-foreground hover:bg-foreground/[0.04]"
            >
              Open in Workspace
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
              <label
                htmlFor="marketplace-plugin-name"
                className="px-0.5 text-[11px] font-medium text-muted-foreground"
              >
                Name
              </label>
              <Input
                id="marketplace-plugin-name"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setName(normalizePluginName(e.target.value))
                }
                placeholder="my-plugin"
                disabled={running}
                className="h-8 bg-transparent text-[13px]"
              />
              <Button
                type="submit"
                variant={canSubmit ? "default" : "outline"}
                disabled={!canSubmit}
                className="h-8 w-full justify-center font-medium"
              >
                {running ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner />
                    Creating…
                  </span>
                ) : (
                  "Create"
                )}
              </Button>
            </form>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11.5px] text-destructive whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar footer + small chrome bits, all inlined so this plugin
// doesn't reach into the host's renderer source tree.

function SidebarFooter({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0"
      style={{ height: SIDEBAR_FOOTER_HEIGHT + SIDEBAR_FOOTER_FADE }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: `linear-gradient(
            to bottom,
            color-mix(in srgb, var(--sidebar) 0%, transparent) 0%,
            color-mix(in srgb, var(--sidebar) 85%, transparent) ${SIDEBAR_FOOTER_FADE}px,
            var(--sidebar) ${SIDEBAR_FOOTER_FADE + 4}px,
            var(--sidebar) 100%
          )`,
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 flex items-end p-2"
        style={
          {
            height: SIDEBAR_FOOTER_HEIGHT,
            pointerEvents: "auto",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  )
}

function SearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-card/40 px-2 focus-within:bg-card">
      <SearchIcon />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search"
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        aria-label="Search"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        >
          <ClearIcon />
        </button>
      )}
    </div>
  )
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function PiIcon() {
  // Pi logo. Paths verbatim from the user-supplied SVG; `#fff` ->
  // `currentColor` so the glyph themes against the surrounding
  // text color in both light and dark mode.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 800 800"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"
      />
      <path d="M517.36 400 H634.72 V634.72 H517.36 Z" />
    </svg>
  )
}

function PuzzleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 2 12c0-.617.236-1.234.706-1.704L4.317 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.98.98 0 0 1 .276-.837l1.611-1.61a2.404 2.404 0 0 1 1.704-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
    </svg>
  )
}

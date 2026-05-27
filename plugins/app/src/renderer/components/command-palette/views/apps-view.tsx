import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useRpc } from "@zenbujs/core/react"
import { Button } from "@zenbu/ui/button"
import { Input } from "@zenbu/ui/input"
import { cn } from "@/lib/utils"
import { ensureRowInView } from "@/lib/ensure-row-in-view"
import { useHoverIntent } from "@/lib/hooks/use-hover-intent"
import { useArrowNav } from "../use-arrow-nav"
import type { CommandViewCtx } from "../types"

export function renderAppsView(ctx: CommandViewCtx) {
  return <AppsView ctx={ctx} />
}

type AppRow = {
  slug: string
  displayName: string
  version: string
  bundlePath: string | null
  sourceDir: string
}

function AppsView({ ctx }: { ctx: CommandViewCtx }) {
  const rpc = useRpc()
  const [apps, setApps] = useState<AppRow[]>([])
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const hover = useHoverIntent()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { rows } = await rpc.app.apps.list()
        if (!cancelled) setApps(rows)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rpc])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return apps
    return apps.filter(
      a =>
        a.displayName.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q),
    )
  }, [apps, query])

  useEffect(() => {
    if (selected >= filtered.length) setSelected(0)
  }, [filtered, selected])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const el = selectedRef.current
    if (scroller && el) ensureRowInView(scroller, el)
  }, [selected])

  const setSelectedFromKeyboard = (n: number | ((s: number) => number)) => {
    hover.resetToKeyboard()
    setSelected(n)
  }
  const handleArrow = useArrowNav(filtered.length, setSelectedFromKeyboard)

  const launchApp = async (app: AppRow) => {
    try {
      await rpc.app.apps.launch({ slug: app.slug })
      ctx.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (handleArrow(e)) return
    if (e.key === "Escape") {
      e.preventDefault()
      ctx.back()
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      const app = filtered[selected]
      if (app) void launchApp(app)
    }
  }

  return (
    <div className="flex flex-col">
      <Input
        ref={inputRef}
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          setSelected(0)
        }}
        onKeyDown={onKeyDown}
        placeholder="Search apps…"
        spellCheck={false}
        className="w-full rounded-none border-0 border-b bg-transparent px-3 py-2 text-[13px] shadow-none focus-visible:ring-0"
      />
      <div ref={scrollerRef} className="max-h-[420px] min-h-[120px] overflow-y-auto py-1">
        {error ? (
          <div className="px-3 py-6 text-center text-[12px] text-red-500">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            {apps.length === 0 ? "No apps in ~/.zenbu/apps yet." : "No matches."}
          </div>
        ) : (
          filtered.map((app, i) => (
            <AppRowItem
              key={app.slug}
              app={app}
              isSelected={i === selected}
              isFirst={i === 0}
              ref={i === selected ? selectedRef : null}
              onSelect={() => void launchApp(app)}
              onHover={() => {
                if (hover.isActive()) setSelected(i)
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}

const AppRowItem = (() => {
  type Props = {
    app: AppRow
    isSelected: boolean
    isFirst: boolean
    onSelect: () => void
    onHover: () => void
  }
  return (function AppRowItemComponent({
    ref,
    ...props
  }: Props & {
    ref?: React.RefObject<HTMLButtonElement | null> | null
  }) {
    const { app, isSelected, onSelect, onHover } = props
    const iconUrl = useAppIcon(app.slug, !!app.bundlePath)
    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        onMouseDown={e => {
          e.preventDefault()
          onSelect()
        }}
        onMouseMove={onHover}
        className={cn(
          "h-auto w-full justify-start gap-3 rounded-none px-3 py-2 text-left text-[13px] font-normal text-popover-foreground",
          isSelected && "bg-accent text-accent-foreground",
        )}
      >
        <AppIcon iconUrl={iconUrl} displayName={app.displayName} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px]">{app.displayName}</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {app.bundlePath ? "Launch" : "Source only — not installed"}
            {app.version && ` · v${app.version}`}
          </span>
        </span>
      </Button>
    )
  })
})()

function AppIcon({
  iconUrl,
  displayName,
}: {
  iconUrl: string | null | undefined
  displayName: string
}) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        draggable={false}
        className="size-7 shrink-0 rounded-md shadow-sm"
      />
    )
  }
  if (iconUrl === undefined) {
    return <div className="size-7 shrink-0 animate-pulse rounded-md bg-muted" />
  }
  const initial = (displayName.trim()[0] ?? "?").toUpperCase()
  return (
    <div
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold text-white shadow-sm"
      style={{ background: `hsl(${hashHue(displayName)} 65% 50%)` }}
    >
      {initial}
    </div>
  )
}

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

// ---------------------------------------------------------------------------
// Process-wide icon cache. The palette can re-mount as the user navigates
// in/out of the Apps view; keeping the cache outside React means we
// only hit the main process once per slug per app session.
// ---------------------------------------------------------------------------

type IconState = string | null | undefined
const iconCache: Record<string, IconState> = {}
const iconInflight = new Set<string>()
const iconListeners = new Set<() => void>()
let iconSnapshot: Record<string, IconState> = iconCache

function emitIcons() {
  iconSnapshot = { ...iconCache }
  for (const l of iconListeners) l()
}

function subscribeIcons(cb: () => void) {
  iconListeners.add(cb)
  return () => {
    iconListeners.delete(cb)
  }
}

function useAppIcon(slug: string, hasBundle: boolean): IconState {
  const rpc = useRpc()
  const icons = useSyncExternalStore(subscribeIcons, () => iconSnapshot)
  useEffect(() => {
    if (!hasBundle) {
      iconCache[slug] = null
      emitIcons()
      return
    }
    if (slug in iconCache) return
    if (iconInflight.has(slug)) return
    iconInflight.add(slug)
    rpc.app.apps.readIconPng({ slug }).then(
      ({ dataUrl }) => {
        iconInflight.delete(slug)
        iconCache[slug] = dataUrl ?? null
        emitIcons()
      },
      () => {
        iconInflight.delete(slug)
        iconCache[slug] = null
        emitIcons()
      },
    )
  }, [slug, hasBundle, rpc])
  return icons[slug]
}

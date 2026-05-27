import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "@zenbu/ui/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@zenbu/ui/dropdown-menu"
import { HoverTip } from "@zenbu/ui/hover-tip"
import { Palette, PaletteRow } from "@zenbu/ui/palette"
import {
  useDb,
  useDbClient,
  useEvents,
  useRpc,
  type ViewComponentProps,
} from "@zenbujs/core/react"
import type { InferSchemaRoot } from "@zenbujs/core/db"
import type openInSchema from "../main/schema"

type OpenInApp = InferSchemaRoot<typeof openInSchema>["apps"][string]

type TitleBarViewArgs = {
  workspaceId: string | null
  scopeId: string | null
  directory: string | null
}

/**
 * Sub-palette modes triggered by the three command-palette items
 * and the Cmd+Shift+O shortcut. The split button itself never
 * opens these — it's a one-click target with the chevron dropdown
 * for legacy mouse-driven discovery; the palettes below are the
 * keyboard-first surface.
 *
 *   - `open`       — pick an app and open the directory there
 *                    (does NOT touch the default).
 *   - `setDefault` — pick an app to become the persistent default
 *                    (does NOT open anything).
 */
type PaletteMode = "open" | "setDefault"

/**
 * Title-bar "Open in <App>" split button + sub-palette host.
 *
 * Primary click opens the current scope's directory in the user's
 * preferred app (`settings.defaultBundlePath`); the chevron pops a
 * dropdown of every other app NSWorkspace reported as a folder
 * opener so the user can re-route a single click or change the
 * default outright.
 *
 * Beyond the visible chrome, this component also hosts the
 * keyboard-driven surface for the plugin:
 *
 *   - Subscribes to `events.openIn.openDefault` (Cmd+Shift+O and
 *     the "Open in default" palette row) and triggers the openWith
 *     directly \u2014 no UI.
 *   - Subscribes to `events.openIn.openChoose` ("Open in\u2026") and
 *     `events.openIn.openSetDefault` ("Open in: Set default\u2026")
 *     and pops a `@zenbu/ui/palette` sub-palette listing every
 *     indexed app, with the activation behaviour switching on
 *     `PaletteMode`.
 *
 * Mounting this here keeps the renderer surface in one place: the
 * title bar already renders this view per workspace, so the
 * subscriptions live exactly where `directory` and the apps list
 * are already in scope. No extra content-script entrypoint to
 * inject.
 *
 * App icons are sourced from each bundle's `.icns` file (decoded
 * to PNG and stashed as a blob by the host's `OpenInService`), so
 * the dropdown matches the system Open-With menu visually without
 * the renderer needing direct disk access.
 *
 * Hides the visible button (but keeps the event subscribers
 * mounted!) when there's no scope directory \u2014 the picker
 * palettes still need to handle the shortcut/palette triggers,
 * they just gracefully no-op when there's nothing to open.
 */
export default function OpenInButtonView({
  args,
}: ViewComponentProps<TitleBarViewArgs>) {
  const directory = args?.directory ?? null
  const rpc = useRpc()
  const events = useEvents()
  const dbClient = useDbClient()
  // Read straight off this plugin's own DB section. The host no
  // longer carries `openInApps` or the `defaultOpenInBundlePath`
  // setting — they moved here in the same change that pulled the
  // button out of `plugins/app`.
  const appsRecord = useDb(root => root.openIn.apps)
  const defaultBundlePath = useDb(
    root => root.openIn.settings.defaultBundlePath,
  )
  const [open, setOpen] = useState(false)
  const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null)

  const apps = useMemo<OpenInApp[]>(() => {
    return Object.values(appsRecord).sort((a, b) => a.sortOrder - b.sortOrder)
  }, [appsRecord])

  // Resolve the current default app. Tolerate a stale persisted
  // bundlePath (e.g. user uninstalled their preferred IDE) by
  // falling back to the first available app.
  const defaultApp = useMemo<OpenInApp | null>(() => {
    if (apps.length === 0) return null
    const hit =
      defaultBundlePath != null
        ? apps.find(a => a.bundlePath === defaultBundlePath)
        : null
    return hit ?? apps[0]!
  }, [apps, defaultBundlePath])

  const setDefault = useCallback(
    (bundlePath: string) => {
      void dbClient.update(root => {
        root.openIn.settings.defaultBundlePath = bundlePath
      })
    },
    [dbClient],
  )

  const openWith = useCallback(
    async (bundlePath: string) => {
      if (!directory) return
      try {
        await rpc.openIn.openIn.openWith({ bundlePath, directory })
      } catch (err) {
        console.error("[open-in] openWith failed:", err)
      }
    },
    [rpc, directory],
  )

  // -------------------------------------------------------------------
  // Event subscriptions: shortcut + palette triggers.
  //
  // Three separate listeners (rather than one switch on a `kind`
  // payload field) so each event's intent is explicit at the
  // emit site and at the subscribe site. The picker-popping ones
  // are no-ops when `apps.length === 0` — we'd open an empty
  // palette otherwise, which is worse UX than silently doing
  // nothing.
  // -------------------------------------------------------------------
  useEffect(() => {
    const offDefault = events.openIn.openDefault.subscribe(() => {
      if (!directory || !defaultApp) return
      void openWith(defaultApp.bundlePath)
    })
    const offChoose = events.openIn.openChoose.subscribe(() => {
      if (apps.length === 0) return
      setPaletteMode("open")
    })
    const offSet = events.openIn.openSetDefault.subscribe(() => {
      if (apps.length === 0) return
      setPaletteMode("setDefault")
    })
    return () => {
      offDefault()
      offChoose()
      offSet()
    }
  }, [events, directory, defaultApp, openWith, apps.length])

  const closePalette = useCallback(() => setPaletteMode(null), [])

  const activatePaletteRow = useCallback(
    (app: OpenInApp) => {
      if (paletteMode === "open") {
        void openWith(app.bundlePath)
      } else if (paletteMode === "setDefault") {
        setDefault(app.bundlePath)
      }
      setPaletteMode(null)
    },
    [paletteMode, openWith, setDefault],
  )

  return (
    <>
      {directory && defaultApp && (
        <div className="inline-flex h-[22px] items-stretch overflow-hidden rounded-md border border-border bg-background/40 transition-colors hover:bg-background/70">
          <HoverTip label={`Open in ${defaultApp.name}`} setAriaLabel={false}>
            <button
              type="button"
              aria-label={`Open in ${defaultApp.name}`}
              onClick={() => void openWith(defaultApp.bundlePath)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2 text-[11px] font-medium leading-none text-muted-foreground transition-colors",
                "hover:bg-background/80 hover:text-foreground",
              )}
            >
              <OpenInAppIcon app={defaultApp} size={14} />
              <span className="max-w-[120px] truncate">{defaultApp.name}</span>
            </button>
          </HoverTip>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Choose Open in target"
                className={cn(
                  "inline-flex items-center justify-center border-l border-border px-1.5 text-muted-foreground transition-colors",
                  "hover:bg-background/80 hover:text-foreground",
                  "data-[state=open]:bg-background/80 data-[state=open]:text-foreground",
                )}
              >
                <ChevronDownIcon className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px] p-1">
              <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                Open in
              </DropdownMenuLabel>
              {apps.length === 0 ? (
                <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
                  No apps detected.
                </div>
              ) : (
                apps.map(app => {
                  const isPicked = app.bundlePath === defaultApp.bundlePath
                  return (
                    <DropdownMenuItem
                      key={app.id}
                      onSelect={e => {
                        e.preventDefault()
                        // Picking an item in the dropdown only
                        // *re-targets* the primary button — same
                        // split-button convention the host used.
                        setDefault(app.bundlePath)
                        setOpen(false)
                      }}
                      className={cn(
                        "gap-2",
                        isPicked &&
                          "bg-accent text-accent-foreground focus:bg-accent",
                      )}
                      aria-checked={isPicked}
                    >
                      <OpenInAppIcon app={app} size={16} />
                      <span className="flex-1 truncate text-[12px]">
                        {app.name}
                      </span>
                    </DropdownMenuItem>
                  )
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <OpenInPicker
        mode={paletteMode}
        apps={apps}
        canOpen={!!directory}
        onClose={closePalette}
        onActivate={activatePaletteRow}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Sub-palette. Uses the shared `@zenbu/ui/palette` primitive so the
// chrome (centered card, fuzzy search input, j/k & ↑↓ nav, scroll
// management, Escape to close) matches the host's Cmd+P palette.
//
// Two activation behaviours flow through one component because the
// UI is identical — only the verb on Enter differs.

function OpenInPicker({
  mode,
  apps,
  canOpen,
  onClose,
  onActivate,
}: {
  mode: PaletteMode | null
  apps: OpenInApp[]
  canOpen: boolean
  onClose: () => void
  onActivate: (app: OpenInApp) => void
}) {
  // `mode === "open"` requires a directory; the event subscriber
  // already gates `openChoose` on `apps.length > 0`, but the
  // directory can disappear between event and activation (e.g.
  // workspace switched mid-flight), so we render an explicit
  // empty state instead of silently no-op'ing.
  //
  // Mode is communicated entirely through the input placeholder —
  // no chatty footer, no right-side "default" badge.
  //
  // Per-row icons stay: the global command palette is label-only on
  // purpose, but a nested picker whose rows *are* the apps would
  // feel deliberately impoverished without the bundle icons next
  // to each name (same shape the system "Open With" menu uses).
  const placeholder =
    mode === "setDefault"
      ? "Set default app\u2026"
      : "Open in\u2026"

  return (
    <Palette
      open={mode !== null}
      onClose={onClose}
      items={apps}
      onActivate={onActivate}
      getKey={app => app.id}
      getFilterText={app => app.name}
      placeholder={placeholder}
      emptyMessage={
        mode === "open" && !canOpen
          ? "No directory in the active scope to open."
          : "No apps detected."
      }
      renderRow={({ item, isSelected, rowRef, onMouseMove, onActivate }) => (
        <PaletteRow
          key={item.id}
          isSelected={isSelected}
          rowRef={rowRef}
          onMouseMove={onMouseMove}
          onActivate={onActivate}
        >
          <OpenInAppIcon app={item} size={18} />
          <span className="truncate">{item.name}</span>
        </PaletteRow>
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Icon helper. Inlined here (was `OpenInAppIcon` + `useOpenInAppIconUrl` in
// the host) because we can't import from `@/` and the two together are
// ~50 lines.

function OpenInAppIcon({ app, size }: { app: OpenInApp; size: number }) {
  const url = useOpenInAppIconUrl(app.icon)
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="block rounded-[3px] object-contain"
        style={{ width: size, height: size }}
      />
    )
  }
  const letter = (app.name[0] ?? "?").toUpperCase()
  return (
    <div
      className="flex items-center justify-center rounded-[3px] bg-muted text-[10px] font-semibold text-muted-foreground"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {letter}
    </div>
  )
}

function useOpenInAppIconUrl(icon: OpenInApp["icon"]): string | null {
  const client = useDbClient()
  const [url, setUrl] = useState<string | null>(null)
  const blobId = icon?.blobId ?? null
  const mimeType = icon?.mimeType ?? "image/png"

  useEffect(() => {
    if (!blobId) {
      setUrl(null)
      return
    }
    let revoke: string | null = null
    let cancelled = false
    void (async () => {
      try {
        const data = await client.getBlobData(blobId)
        if (cancelled || !data) return
        const blob = new Blob([data as BlobPart], { type: mimeType })
        revoke = URL.createObjectURL(blob)
        setUrl(revoke)
      } catch (err) {
        console.error("[open-in-icon] failed to load blob:", err)
      }
    })()
    return () => {
      cancelled = true
      if (revoke) URL.revokeObjectURL(revoke)
      setUrl(null)
    }
  }, [client, blobId, mimeType])

  return url
}

import { useEffect, useMemo, useState } from "react"
import { ChevronDownIcon } from "lucide-react"
import { Streamdown } from "streamdown"
import {
  useDb,
  useDbClient,
  useRpc,
  useViewArgs,
} from "@zenbujs/core/react"
import { Button } from "@zenbu/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@zenbu/ui/dropdown-menu"
import { cn } from "@zenbu/ui/utils"
import { PLUGINS } from "./mock-data"
import type { MarketplacePlugin } from "./mock-data"

export type PluginDetailArgs = {
  pluginId?: string
  // Set by "Not installed" sidebar rows. Lets the view read
  // README from disk when the plugin isn't in `root.app.plugins`.
  // Ignored when `installedMatch` resolves.
  directory?: string
}

type InstalledPlugin = {
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

/**
 * Marketplace plugin-detail view.
 *
 * Two flavors driven by the source of the click:
 *
 *  - **Installed plugin** \u2014 the row in the marketplace sidebar's
 *    "Installed" list. `pluginId` is the registered plugin name;
 *    we look it up in `root.app.plugins` to get the on-disk
 *    directory, then read `README.md` from that directory via
 *    `rpc.app.fileTree.readFile` and render it through
 *    Streamdown (same renderer the chat uses). An "Open in
 *    Workspace" button at the bottom calls
 *    `rpc.app.pluginsRootView.openPluginInNewWindow` \u2014 same RPC
 *    the deleted plugins-root sidebar used.
 *
 *  - **Marketplace listing** \u2014 a row from the mock catalog.
 *    `pluginId` matches an entry in `PLUGINS`. We render the
 *    catalog's structured fields (name, version, author, tags,
 *    install count) and the mock `readme` body. No "Open in
 *    Workspace" (it isn't installed); no install button yet
 *    either \u2014 those affordances will come back once the real
 *    marketplace ships.
 *
 * Layout mirrors VS Code's extensions page: a fixed header band
 * (icon + identity + actions) over a scrollable Markdown body.
 */
export default function PluginDetailView() {
  const { pluginId, directory } = useViewArgs<PluginDetailArgs>() ?? {}

  const installed =
    (useDb(root => root.app.plugins) as InstalledPlugin[] | undefined) ?? []
  const icons =
    (useDb(root => root.app.pluginIcons) as
      | Record<string, PluginIconRecord>
      | undefined) ?? {}

  const installedMatch = useMemo<InstalledPlugin | null>(() => {
    if (!pluginId) return null
    return installed.find(p => p.name === pluginId) ?? null
  }, [installed, pluginId])

  const marketplaceMatch = useMemo<MarketplacePlugin | null>(() => {
    if (!pluginId) return null
    return PLUGINS.find(p => p.id === pluginId) ?? null
  }, [pluginId])

  if (!pluginId) {
    return (
      <EmptyState
        title="No plugin selected"
        body="Pick a plugin from the marketplace sidebar to see its details."
      />
    )
  }

  if (installedMatch) {
    return (
      <InstalledDetail
        plugin={installedMatch}
        icon={icons[installedMatch.name] ?? null}
      />
    )
  }

  if (marketplaceMatch) {
    return <MarketplaceDetail plugin={marketplaceMatch} />
  }

  // Not-installed path: render the same README-driven body as
  // the installed case using the directory hint from the sidebar.
  if (directory) {
    return (
      <InstalledDetail
        plugin={{ name: pluginId, dir: directory, kind: "plugin", tag: null }}
        icon={null}
      />
    )
  }

  return (
    <EmptyState
      title={prettify(pluginId)}
      body="This plugin isn't installed and isn't in the marketplace catalog."
    />
  )
}

// ---------------------------------------------------------------------------
// Installed plugin: read README + package.json from disk.

function InstalledDetail({
  plugin,
  icon,
}: {
  plugin: InstalledPlugin
  icon: PluginIconRecord | null
}) {
  const rpc = useRpc()
  const isPiExtension = plugin.kind === "pi-extension"
  const [readme, setReadme] = useState<string | null>(null)
  const [readmeError, setReadmeError] = useState<string | null>(null)
  const [pkg, setPkg] = useState<PackageMeta | null>(null)

  // Pi extensions are single-file `.ts` modules, not directories,
  // so there's no README / package.json to read. Skip the fetch
  // and surface a small "pi extension" body instead.
  //
  // The README + package.json read goes through the marketplace
  // service's own `readPluginDetail` (not the file-tree's generic
  // `readFile`) because the marketplace path treats missing
  // files as a normal `null` return rather than throwing —
  // every plugin without a README would otherwise spam
  // `[zenrpc] method execution failed: ENOENT` in the main
  // process log.
  useEffect(() => {
    if (isPiExtension) return
    let cancelled = false
    setReadme(null)
    setReadmeError(null)
    setPkg(null)
    void (async () => {
      try {
        const res = await rpc.marketplace.marketplace.readPluginDetail({
          directory: plugin.dir,
        })
        if (cancelled) return
        setReadme(res.readme ?? "")
        setPkg(res.pkg)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setReadmeError(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [plugin.dir, isPiExtension, rpc])

  const onOpenWorkspace = () => {
    void rpc.app.pluginsRootView
      .openPluginInNewWindow({
        pluginName: plugin.name,
        pluginDir: plugin.dir,
      })
      .catch(err => {
        console.error(
          "[plugin-detail] openPluginInNewWindow failed:",
          err,
        )
      })
  }

  return (
    <DetailLayout
      header={
        <DetailHeader
          icon={<HeaderIcon plugin={plugin} icon={icon} />}
          name={prettify(plugin.name)}
          slug={plugin.name}
          version={pkg?.version ?? null}
          author={pkg?.author ?? null}
          tagline={pkg?.description ?? null}
          action={
            isPiExtension ? null : (
              <OpenInWorkspaceButton
                pluginDir={plugin.dir}
                onOpen={onOpenWorkspace}
              />
            )
          }
        />
      }
    >
      {isPiExtension ? (
        <PiExtensionBody dir={plugin.dir} />
      ) : (
        <ReadmeBody readme={readme} error={readmeError} />
      )}
    </DetailLayout>
  )
}

// Mirrors the shape returned by
// `rpc.marketplace.marketplace.readPluginDetail`. Kept local so
// the view doesn't have to import service-internal types.
type PackageMeta = {
  version: string | null
  description: string | null
  author: string | null
}

function PiExtensionBody({ dir }: { dir: string }) {
  return (
    <div className="text-[13px] text-muted-foreground">
      Loaded from{" "}
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
        {dir}
      </code>
      .
    </div>
  )
}

function ReadmeBody({
  readme,
  error,
}: {
  readme: string | null
  error: string | null
}) {
  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive whitespace-pre-wrap">
        Failed to read README.md: {error}
      </div>
    )
  }
  if (readme === null) {
    return (
      <div className="text-[12.5px] text-muted-foreground">
        Loading README…
      </div>
    )
  }
  if (readme.trim().length === 0) {
    return (
      <div className="text-[12.5px] text-muted-foreground">
        No README.md in this plugin.
      </div>
    )
  }
  return <MarkdownBody source={readme} />
}

// ---------------------------------------------------------------------------
// Header action: "Open in Workspace" split button.
//
// Mirrors the shape of the title-bar's `open-in` split:
//   [  Open in Workspace  | ▾  ]
// Primary click opens the per-plugin workspace window; the chevron
// pops a small menu with a Copy path action so the user can grab
// the plugin source path without having to dig through the
// file-tree sidebar.

function OpenInWorkspaceButton({
  pluginDir,
  onOpen,
}: {
  pluginDir: string
  onOpen: () => void
}) {
  const rpc = useRpc()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const onCopyPath = () => {
    try {
      rpc.core.window.copyToClipboard(pluginDir)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch (err) {
      console.error("[plugin-detail] copyToClipboard failed:", err)
    }
    setOpen(false)
  }

  return (
    <div className="inline-flex h-8 items-stretch overflow-hidden rounded-md border border-border bg-background/40 transition-colors hover:bg-background/70">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open in Workspace"
        className="inline-flex items-center px-3 text-[12px] font-medium leading-none text-foreground transition-colors hover:bg-background/80"
      >
        Open in Workspace
      </button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More Open in Workspace actions"
            className={cn(
              "inline-flex items-center justify-center border-l border-border px-2 text-muted-foreground transition-colors",
              "hover:bg-background/80 hover:text-foreground",
              "data-[state=open]:bg-background/80 data-[state=open]:text-foreground",
            )}
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px] p-1">
          <DropdownMenuItem onSelect={onCopyPath} className="gap-2">
            <span className="flex-1 text-[12px]">
              {copied ? "Copied!" : "Copy path"}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Marketplace listing: render the mock catalog fields.

function MarketplaceDetail({ plugin }: { plugin: MarketplacePlugin }) {
  return (
    <DetailLayout
      header={
        <DetailHeader
          icon={<HeaderColorTile plugin={plugin} />}
          name={plugin.name}
          slug={plugin.slug}
          version={plugin.version}
          author={plugin.author}
          tagline={plugin.tagline}
          action={null}
        />
      }
    >
      <MarkdownBody source={plugin.readme} />
    </DetailLayout>
  )
}

// ---------------------------------------------------------------------------
// Header + layout shared between both flavors.

function DetailLayout({
  header,
  children,
}: {
  header: React.ReactNode
  children: React.ReactNode
}) {
  // The detail view lives in a pane that can be as narrow as
  // 260-ish px (split-left next to a chat) or as wide as the full
  // window. We previously reached for Tailwind v4 named container
  // queries (`@container/detail` + `@[480px]/detail:`) so layout
  // would respond to the *pane* width rather than the viewport,
  // but that syntax doesn't compile in this host's Tailwind
  // setup (see the same note on the deleted full-pane marketplace
  // view). Responsiveness instead comes from flex-wrap with
  // explicit basis hints inside `DetailHeader`.
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <div className="shrink-0 border-b border-border/60">
        <div className="mx-auto w-full max-w-[820px] px-4 py-4">
          {header}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-[820px] px-4 py-5">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailHeader({
  icon,
  name,
  slug,
  version,
  author,
  tagline,
  action,
}: {
  icon: React.ReactNode
  name: string
  slug: string
  version: string | null
  author: string | null
  tagline: string | null
  action: React.ReactNode | null
}) {
  // Responsive layout via plain flex-wrap. The icon-and-title
  // block claims `basis-[220px]` with `grow`, so on a wide pane
  // it fills the leftover space alongside the action button on
  // the same row. On a narrow pane, the action button can't fit
  // beside it (200+ for the title block + ~150 for the button +
  // gaps), so flex-wrap drops it onto its own row underneath —
  // no JS measurement / container query needed.
  //
  // `break-words` on the title + author and `break-all` on the
  // slug make sure unbreakable identifiers (`cmMarkdown`,
  // `markdown-preview`) hyphenate at the pane edge instead of
  // forcing the row wider than its parent.
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
      <div className="flex min-w-0 grow basis-[220px] items-start gap-3">
        <div className="shrink-0">{icon}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h1 className="min-w-0 break-words text-[18px] font-semibold tracking-tight text-foreground">
              {name}
            </h1>
            {version && (
              <span className="text-[12px] tabular-nums text-muted-foreground">
                v{version}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
            {author && <span className="min-w-0 break-words">{author}</span>}
            {author && <Dot />}
            <span className="min-w-0 break-all font-mono text-[11px]">
              {slug}
            </span>
          </div>
          {tagline && (
            <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-foreground/90">
              {tagline}
            </p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function Dot() {
  return (
    <span aria-hidden className="text-muted-foreground/40">
      ·
    </span>
  )
}

function HeaderIcon({
  plugin,
  icon,
}: {
  plugin: InstalledPlugin
  icon: PluginIconRecord | null
}) {
  // The marketplace sidebar already hydrates `root.app.pluginIcons`
  // into object URLs via its own image-cache. Re-using that cache
  // here would be ideal, but the cache is module-local to the
  // sidebar view. For the header we settle for a placeholder
  // tile if the icon hasn't been hydrated by the sidebar yet \u2014
  // by the time the user clicks through to detail, the sidebar
  // has almost always already loaded the icon.
  if (icon) {
    return (
      <div
        className={cn(
          "flex h-14 w-14 items-center justify-center overflow-hidden rounded-md",
          "border border-border/60 bg-card/40",
        )}
      >
        <PluginIconImg icon={icon} size={48} />
      </div>
    )
  }
  return (
    <div
      className={cn(
        "grid h-14 w-14 place-items-center rounded-md",
        "border border-border/60 bg-card/40 text-muted-foreground",
      )}
      aria-hidden
    >
      {plugin.kind === "pi-extension" ? <PiGlyph /> : <PuzzleGlyph />}
    </div>
  )
}

function PluginIconImg({
  icon,
  size,
}: {
  icon: PluginIconRecord
  size: number
}) {
  // Hydrate the icon blob through the shared DbClient. zenbu
  // coalesces concurrent reads on the same blob id, so even
  // though the marketplace sidebar already pulled this exact
  // blob, asking again is essentially free. Object URLs aren't
  // revoked (same model as the host's `image-cache.ts`);
  // detail-view turnover is low enough that the leak is bounded
  // by the number of plugins clicked through in a session.
  const dbClient = useDbClient()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setUrl(null)
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await (dbClient as any).getBlobData(icon.blobId)
        if (cancelled || !data) return
        const blob = new Blob([data as BlobPart], { type: icon.mime })
        setUrl(URL.createObjectURL(blob))
      } catch {
        // best-effort; fall back to a blank tile.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [icon.blobId, icon.mime, dbClient])
  if (!url) {
    return <PuzzleGlyph />
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain" }}
      draggable={false}
    />
  )
}

function HeaderColorTile({ plugin }: { plugin: MarketplacePlugin }) {
  return (
    <div
      className="grid h-14 w-14 place-items-center rounded-md text-white"
      style={{ background: plugin.color, fontSize: 28 }}
      aria-hidden
    >
      {plugin.glyph}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Markdown body. Streamdown is the same renderer the chat uses.

function MarkdownBody({ source }: { source: string }) {
  // `break-words` here is the same defensive fix the header uses:
  // README bodies often contain long unbreakable tokens (code
  // identifiers, URLs, file paths) that would otherwise force the
  // surrounding paragraph wider than the pane and trigger a
  // horizontal scrollbar inside the view. With `break-words`
  // those tokens hyphenate at the pane edge instead.
  return (
    <div className="break-words text-[13.5px] leading-relaxed text-foreground/90">
      <Streamdown>{source}</Streamdown>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers.

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background text-foreground">
      <div className="flex max-w-[340px] flex-col items-center gap-2 px-6 text-center">
        <h1 className="text-[15px] font-semibold">{title}</h1>
        <p className="text-[12.5px] text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}

function prettify(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function PuzzleGlyph() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 2 12c0-.617.236-1.234.706-1.704L4.317 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.98.98 0 0 1 .276-.837l1.611-1.61a2.404 2.404 0 0 1 1.704-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
    </svg>
  )
}

function PiGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 800 800" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"
      />
      <path d="M517.36 400 H634.72 V634.72 H517.36 Z" />
    </svg>
  )
}

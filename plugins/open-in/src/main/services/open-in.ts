import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Service } from "@zenbujs/core/runtime"
import {
  DbService,
  RpcService,
  ShortcutsService,
  ViewRegistryService,
} from "@zenbujs/core/services"
import type { InferSchemaRoot } from "@zenbujs/core/db"
import openInSchema from "../schema"

const IS_MAC = process.platform === "darwin"

const here = path.dirname(fileURLToPath(import.meta.url))
const VIEW_SOURCE = path.resolve(here, "../../views/open-in-button-view.tsx")
const VIEW_TYPE = "open-in-button"

const execFileP = promisify(execFile)

type OpenInApp = InferSchemaRoot<typeof openInSchema>["apps"][string]

/** Apps that NSWorkspace tends to list but that aren't useful "open
 * in" targets for a code project (image viewers, archive utility,
 * etc.). Filtered out so the dropdown only shows things a developer
 * would plausibly want to use. We do this here \u2014 not in the
 * NSWorkspace query \u2014 because the query result is still useful
 * for debugging.
 *
 * Matched against the bundle's basename (without `.app`)
 * case-insensitively. */
const HIDDEN_APP_BASENAMES = new Set(
  [
    "QuickTime Player",
    "Archive Utility",
    "Books",
    "Preview",
    "Photos",
    "TextEdit", // too generic
  ].map(s => s.toLowerCase()),
)

/** Path to a JXA script we shell out to enumerate apps that can
 * open a folder URL. Written into `os.tmpdir()` once per boot and
 * reused for subsequent queries; cheaper than re-emitting the
 * script every call and means stack traces from `osascript`
 * point at a stable path.
 *
 * The script uses NSWorkspace's
 * `URLsForApplicationsToOpenURL`, which is the modern
 * (10.15+) replacement for `LSCopyApplicationURLsForURL` and the
 * same API Finder's "Open With" submenu reads. It returns
 * everything Launch Services knows about, in the order Launch
 * Services thinks is most relevant (user-preferred handler first,
 * then declared handlers). */
let osascriptPath: string | null = null

function ensureOsascript(): string {
  if (osascriptPath && fs.existsSync(osascriptPath)) return osascriptPath
  const p = path.join(
    os.tmpdir(),
    `zenbu-open-in-${process.pid}.scpt.js`,
  )
  fs.writeFileSync(
    p,
    `ObjC.import('Foundation')
ObjC.import('AppKit')
function run(argv) {
  const dirPath = argv[0] || '/'
  const url = $.NSURL.fileURLWithPath(dirPath)
  const ws = $.NSWorkspace.sharedWorkspace
  const arr = ws.URLsForApplicationsToOpenURL(url)
  if (!arr) return JSON.stringify([])
  const out = []
  const n = arr.count
  for (let i = 0; i < n; i++) {
    const u = arr.objectAtIndex(i)
    out.push(ObjC.unwrap(u.path))
  }
  return JSON.stringify(out)
}
`,
  )
  osascriptPath = p
  return p
}

/**
 * Indexes installed macOS applications that can open a folder URL
 * and exposes them as "Open in X" targets for the title-bar
 * Open-in button.
 *
 * Strategy:
 *   1. On boot, ask NSWorkspace (via JXA) for the list of apps
 *      registered as folder openers for the user's home directory.
 *      That returns the same set Finder's Open-With menu shows.
 *   2. For each result, read `Info.plist` for the display name +
 *      bundle id, and extract the icon from the bundle's `.icns`
 *      file via `sips` into a PNG blob stored in our DB.
 *   3. Rewrite `root.app.openInApps` in one update so removed
 *      apps disappear automatically across boots.
 *
 * Indexing happens inside `evaluate()` so the dropdown has data
 * the moment the UI mounts. Per the project guideline ("indexing
 * is in the evaluate and fast"), we don't await blocking icon
 * extraction before the first DB write \u2014 we publish app names
 * first (so the dropdown can show letter-avatar rows immediately)
 * then patch in icons as they finish converting.
 */
/**
 * Plugin-owned open-in service. Moved from `plugins/app` so that
 * the title-bar button surface and the data backing it are owned
 * by the same plugin. Same indexing + icon-extraction strategy as
 * before — only the DB shape changed:
 *
 *   - `root.app.openInApps`               → `root.openIn.apps`
 *   - `root.app.settings.defaultOpenInBundlePath`
 *                                          → `root.openIn.settings.defaultBundlePath`
 *   - `root.app.settings.finderDefaultMigrated`
 *                                          → `root.openIn.settings.finderDefaultMigrated`
 *
 * The host's `app` schema migration `0046` drops the old keys.
 */
export class OpenInService extends Service.create({
  key: "openIn",
  deps: {
    db: DbService,
    rpc: RpcService,
    shortcuts: ShortcutsService,
    viewRegistry: ViewRegistryService,
    // String-keyed handle to `plugins/app`'s `PaletteActionsService`.
    // Resolved at runtime so we don't have to import a host-private
    // class \u2014 same trick `searchRecentWorkspaces` uses.
    paletteActions: "paletteActions",
  },
}) {
  evaluate() {
    // Register the title-bar component view alongside the indexer
    // so the plugin only has one main-process service to wire.
    this.setup("register-view", () => {
      void this.ctx.viewRegistry.registerView({
        type: VIEW_TYPE,
        rendering: "component",
        source: { modulePath: VIEW_SOURCE },
        meta: {
          kind: "title-bar",
          titleBarOrder: 1,
          label: "Open in",
        },
      })
      return () => {
        void this.ctx.viewRegistry.unregisterView(VIEW_TYPE)
      }
    })

    // --- Keyboard shortcut: Cmd+Shift+O \u2192 emit `openDefault`. ----------
    //
    // The renderer-side title-bar view subscribes to this event and
    // does the actual openWith using the current scope's directory +
    // the user's preferred app. We deliberately don't try to resolve
    // the directory in the main process here: shortcut handlers
    // don't get window context, but the title-bar view is mounted
    // per-window and already has `directory` in its args.
    this.setup("register-shortcut", () =>
      this.ctx.shortcuts.register({
        id: "openIn.openDefault",
        name: "Open in Default App",
        category: "Open In",
        description:
          "Open the active scope's directory in the preferred macOS app (set via the title-bar split button's chevron menu).",
        defaultBinding: IS_MAC
          ? { meta: true, shift: true, key: "o" }
          : { control: true, shift: true, key: "o" },
        handler: () => {
          this.ctx.rpc.emit.openIn.openDefault({ source: "shortcut" })
        },
      }),
    )

    // --- Command-palette actions ----------------------------------------
    //
    // Three rows, all backed by RPC methods on this service that just
    // fan out to the same events the keyboard shortcut emits:
    //
    //   1. "Open in\u2026"             \u2192 picker that opens (no default change)
    //   2. "Open in default"        \u2192 same as Cmd+Shift+O
    //   3. "Open in: Set default"   \u2192 picker that updates `defaultBundlePath`
    //
    // Picker UI lives in the renderer (`open-in-button-view.tsx`)
    // because that's where `directory` / db state already are, and
    // because the palette primitives are renderer-only.
    this.setup("register-palette-actions", () => {
      const reg = this.ctx.paletteActions as {
        register: (spec: unknown) => Promise<unknown>
        unregister: (a: { id: string }) => Promise<unknown>
      }
      const modHint = IS_MAC ? "\u2318\u21e7O" : "Ctrl+Shift+O"
      const rows: Array<{
        id: string
        label: string
        hint?: string
        method: "paletteOpenChoose" | "paletteOpenDefault" | "paletteOpenSetDefault"
      }> = [
        {
          id: "openIn.openChoose",
          label: "Open in\u2026",
          method: "paletteOpenChoose",
        },
        {
          id: "openIn.openDefault",
          label: "Open in default",
          hint: modHint,
          method: "paletteOpenDefault",
        },
        {
          id: "openIn.setDefault",
          label: "Open in: Set default\u2026",
          method: "paletteOpenSetDefault",
        },
      ]
      // No `icon` field — the palette is label-only by design now.
      // (The per-app picker that pops on "Open in\u2026" / "Set
      // default\u2026" still renders bundle icons inline because
      // those rows *are* the apps; the global palette rows that
      // *trigger* the picker stay text-only like everything else.)
      for (const r of rows) {
        void reg.register({
          id: r.id,
          label: r.label,
          hint: r.hint ?? null,
          group: "Open In",
          rpc: {
            plugin: "openIn",
            service: "openIn",
            method: r.method,
          },
        })
      }
      return () => {
        for (const r of rows) {
          void reg.unregister({ id: r.id }).catch(() => {})
        }
      }
    })

    // Skip the JXA path on non-macOS \u2014 there's no equivalent
    // protocol-level "apps that open this" registry on Linux that
    // we can query without bundling extra deps. The button will
    // still render but with an empty dropdown.
    if (process.platform !== "darwin") return
    // Fire-and-forget: scanning installed openers via JXA +
    // readBundleMeta takes 1.5-2.5s. The renderer shows letter-avatar
    // fallbacks while this populates and re-renders on the DB update,
    // so blocking boot here just delays first paint.
    void this.refresh().catch(err =>
      console.warn("[open-in] initial refresh failed:", err),
    )
  }

  // --- Palette dispatch handlers --------------------------------------
  //
  // The renderer dispatches these via
  // `rpc.openIn.openIn.<method>({ windowId })`. We forward to the
  // matching event so palette + shortcut share one renderer-side
  // code path (button view subscribes; pops the picker / opens the
  // default). Return `{ ok: true }` for symmetry with other plugin
  // palette handlers.

  async paletteOpenChoose(_args: {
    windowId: string
  }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.openIn.openChoose({ source: "palette" })
    return { ok: true }
  }

  async paletteOpenDefault(_args: {
    windowId: string
  }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.openIn.openDefault({ source: "palette" })
    return { ok: true }
  }

  async paletteOpenSetDefault(_args: {
    windowId: string
  }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.openIn.openSetDefault({ source: "palette" })
    return { ok: true }
  }

  /** Re-scan installed openers + refresh icons. Wipes the previous
   * `openInApps` record. Exposed via RPC so the renderer can
   * trigger a refresh from the dropdown's "Refresh" affordance if
   * we add one later. */
  async refresh(): Promise<{ count: number }> {
    if (process.platform !== "darwin") return { count: 0 }
    const probeDir = process.cwd() // any real directory works; cwd is guaranteed to exist
    const bundlePaths = await queryFolderOpeners(probeDir)
    const filtered = bundlePaths.filter(p => {
      const base = path.basename(p, ".app").toLowerCase()
      return !HIDDEN_APP_BASENAMES.has(base)
    })

    // First pass: write metadata WITHOUT icons so the renderer can
    // populate the dropdown immediately. We then patch icons in
    // serially below \u2014 sips takes ~30ms per app and we don't
    // want the whole list blocked on the slowest icon.
    const now = Date.now()
    const stubs: OpenInApp[] = []
    for (let i = 0; i < filtered.length; i++) {
      const bundlePath = filtered[i]!
      const id = hashPath(bundlePath)
      const meta = await readBundleMeta(bundlePath)
      stubs.push({
        id,
        bundlePath,
        name: meta.name,
        bundleId: meta.bundleId,
        icon: null,
        indexedAt: now,
        sortOrder: i,
      })
    }

    // Carry over previously-extracted icons by bundlePath so the
    // renderer doesn't flash to letter-avatars on every boot
    // before sips catches up.
    const prev = this.ctx.db.client.readRoot().openIn.apps
    const prevByPath = new Map<string, OpenInApp>()
    for (const row of Object.values(prev)) prevByPath.set(row.bundlePath, row)

    const next: Record<string, OpenInApp> = {}
    for (const stub of stubs) {
      const carried = prevByPath.get(stub.bundlePath)
      next[stub.id] = {
        ...stub,
        // Keep the old icon while we re-extract; we overwrite
        // below when the new one is ready.
        icon: carried?.icon ?? null,
      }
    }

    await this.ctx.db.client.update(root => {
      root.openIn.apps = next
      const settings = root.openIn.settings
      // Pick a sensible default the first time we run.
      if (settings.defaultBundlePath == null) {
        const def = pickDefaultBundlePath(stubs)
        if (def) settings.defaultBundlePath = def
      } else {
        // If the previously-chosen default no longer exists (app
        // uninstalled between boots), clear it so the renderer
        // falls back to the preferred-order pick.
        const stillExists = stubs.some(
          s => s.bundlePath === settings.defaultBundlePath,
        )
        if (!stillExists) {
          const def = pickDefaultBundlePath(stubs)
          settings.defaultBundlePath = def
        }
      }
      // One-shot reset for existing installs (carried over from
      // the host's previous heuristic): the first time we boot
      // post-migration, force Finder as the default. Explicit
      // dropdown picks are honoured forever after.
      if (!settings.finderDefaultMigrated) {
        const finder = stubs.find(
          s => path.basename(s.bundlePath, ".app").toLowerCase() === "finder",
        )
        if (finder) {
          settings.defaultBundlePath = finder.bundlePath
        }
        settings.finderDefaultMigrated = true
      }
    })

    // Second pass: extract icons one at a time. Sequential rather
    // than `Promise.all` so we don't spawn N sips processes and
    // tank the user's machine right after boot.
    for (const stub of stubs) {
      try {
        const png = await extractIconPng(stub.bundlePath)
        if (!png) continue
        const blobId = await this.ctx.db.client.createBlob(png, true)
        // Re-read inside the update so we don't accidentally
        // overwrite a concurrent change (the user could click the
        // refresh button while we're extracting).
        await this.ctx.db.client.update(root => {
          const row = root.openIn.apps[stub.id]
          if (!row || row.bundlePath !== stub.bundlePath) return
          // Free the previous blob if we had one carried over.
          const prevBlobId = row.icon?.blobId ?? null
          row.icon = { blobId, mimeType: "image/png" }
          if (prevBlobId && prevBlobId !== blobId) {
            // Best-effort blob cleanup. We deliberately don't
            // await this inside the update body.
            void this.ctx.db.client.deleteBlob(prevBlobId).catch(() => {})
          }
        })
      } catch (err) {
        console.warn(
          "[open-in] icon extraction failed for",
          stub.bundlePath,
          err,
        )
      }
    }

    return { count: stubs.length }
  }

  /** Open the given directory (or current scope, resolved by the
   * caller) in the requested app. The argument is the absolute
   * bundle path \u2014 we don't take a bundle id because two installs
   * of the same app (e.g. /Applications/Code.app and a sandbox
   * version under ~/Applications) share an id but are distinct
   * targets in the user's view. */
  async openWith(args: { bundlePath: string; directory: string }) {
    if (!args.directory) throw new Error("directory is required")
    if (!fs.existsSync(args.directory)) {
      throw new Error(`Directory does not exist: ${args.directory}`)
    }
    if (!fs.existsSync(args.bundlePath)) {
      throw new Error(`Application does not exist: ${args.bundlePath}`)
    }
    // `shell.openPath` runs the user's default handler, which is
    // the wrong thing here \u2014 we want a *specific* app. Use the
    // `open -a <bundle>` CLI; it routes through Launch Services
    // the same way Finder's "Open With" does, including respecting
    // single-instance apps.
    try {
      await execFileP("open", ["-a", args.bundlePath, args.directory])
    } catch (err) {
      throw new Error(
        `Failed to open ${args.directory} in ${path.basename(args.bundlePath)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }
}

/* ---------- internals ---------- */

async function queryFolderOpeners(dir: string): Promise<string[]> {
  const scriptPath = ensureOsascript()
  try {
    const { stdout } = await execFileP("osascript", [
      "-l",
      "JavaScript",
      scriptPath,
      dir,
    ])
    const trimmed = stdout.trim()
    if (!trimmed) return []
    const parsed: unknown = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    for (const v of parsed) {
      if (typeof v !== "string") continue
      if (!v.toLowerCase().endsWith(".app")) continue
      out.push(v)
    }
    return out
  } catch (err) {
    console.warn(
      "[open-in] osascript query failed:",
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

async function readBundleMeta(
  bundlePath: string,
): Promise<{ name: string; bundleId: string }> {
  const fallbackName = path.basename(bundlePath, ".app")
  const plistPath = path.join(bundlePath, "Contents", "Info.plist")
  if (!fs.existsSync(plistPath)) {
    return { name: fallbackName, bundleId: "" }
  }
  // Read display name + bundle id via `defaults read`. `plutil
  // -convert json -o -` would work too, but `defaults` is the
  // canonical reader and handles both binary and XML plists
  // transparently. We tolerate either being missing.
  const name = (
    (await readDefaults(plistPath, "CFBundleDisplayName")) ??
    (await readDefaults(plistPath, "CFBundleName")) ??
    fallbackName
  ).trim()
  const bundleId =
    (await readDefaults(plistPath, "CFBundleIdentifier"))?.trim() ?? ""
  return { name: name || fallbackName, bundleId }
}

async function readDefaults(
  plistPath: string,
  key: string,
): Promise<string | null> {
  try {
    // `defaults read` wants a path with no extension; pass the
    // full path including `.plist` and it still works on modern
    // macOS, but be defensive and strip the trailing `.plist` so
    // older macOS versions don't double-append.
    const stripped = plistPath.endsWith(".plist")
      ? plistPath.slice(0, -".plist".length)
      : plistPath
    const { stdout } = await execFileP("defaults", [
      "read",
      stripped,
      key,
    ])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Find the bundle's `.icns` file and convert it to a 128px PNG.
 * Returns null when there's no icon, the conversion fails, or
 * we're not on macOS (sips is mac-only). */
async function extractIconPng(bundlePath: string): Promise<Uint8Array | null> {
  if (process.platform !== "darwin") return null
  const icns = findIcnsInBundle(bundlePath)
  if (!icns) return null
  const tmp = path.join(
    os.tmpdir(),
    `zenbu-open-in-icon-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.png`,
  )
  try {
    await execFileP("sips", [
      "-s",
      "format",
      "png",
      "-Z",
      "128",
      icns,
      "--out",
      tmp,
    ])
    const buf = await fs.promises.readFile(tmp)
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  } finally {
    fs.promises.unlink(tmp).catch(() => {})
  }
}

/** Same lookup heuristic as `apps.ts::findIcnsInBundle`. Most
 * bundles have one `.icns` in `Contents/Resources/`; electron-
 * builder apps occasionally name it after the app id rather than
 * `icon.icns`, so we scan instead of guessing. */
function findIcnsInBundle(bundlePath: string): string | null {
  const resources = path.join(bundlePath, "Contents", "Resources")
  if (!fs.existsSync(resources)) return null
  // Prefer the icon referenced by Info.plist when present. The
  // bundle may ship multiple `.icns` files (one per document
  // type), and the top-level CFBundleIconFile is the
  // app's primary icon.
  const plistIcon = readCFBundleIconFileSync(bundlePath)
  if (plistIcon) {
    const candidate = plistIcon.endsWith(".icns")
      ? plistIcon
      : `${plistIcon}.icns`
    const full = path.join(resources, candidate)
    if (fs.existsSync(full)) return full
  }
  let entries: string[]
  try {
    entries = fs.readdirSync(resources)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry.toLowerCase().endsWith(".icns")) {
      return path.join(resources, entry)
    }
  }
  return null
}

function readCFBundleIconFileSync(bundlePath: string): string | null {
  const plistPath = path.join(bundlePath, "Contents", "Info.plist")
  if (!fs.existsSync(plistPath)) return null
  try {
    const stripped = plistPath.slice(0, -".plist".length)
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process")
    const out = execFileSync("defaults", [
      "read",
      stripped,
      "CFBundleIconFile",
    ])
    return out.toString().trim() || null
  } catch {
    return null
  }
}

/** Pick a sensible first-boot default. Heuristic: always prefer
 * Finder when it's in the list \u2014 it's the universal
 * "reveal this folder" target on macOS, and NSWorkspace already
 * surfaces it at the top of the folder-opener list for any
 * directory URL. Falls back to the first available app when
 * Finder isn't reported (non-standard macOS installs, future
 * non-darwin platforms, etc.). */
function pickDefaultBundlePath(stubs: OpenInApp[]): string | null {
  if (stubs.length === 0) return null
  const finder = stubs.find(
    s => path.basename(s.bundlePath, ".app").toLowerCase() === "finder",
  )
  return (finder ?? stubs[0]!).bundlePath
}

function hashPath(p: string): string {
  return crypto.createHash("sha1").update(p).digest("hex").slice(0, 16)
}

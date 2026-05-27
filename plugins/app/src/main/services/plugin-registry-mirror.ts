import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Service } from "@zenbujs/core/runtime"
import { DbService } from "@zenbujs/core/services"
import {
  getConfig,
  subscribeConfig,
  type ConfigSnapshot,
} from "@zenbujs/core/runtime"

/**
 * Where pi-agent picks up user extensions on boot. We index the
 * same directory so they appear in the plugins sidebar with a
 * `"pi"` tag. `extensions-disabled/` is mirrored too — we treat
 * disabled extensions as "installed but turned off"; once we have
 * a UI to toggle them we'll surface that, but until then they
 * still show up in the list.
 */
const PI_EXTENSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "extensions")
const PI_EXTENSIONS_DISABLED_DIR = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "extensions-disabled",
)

/**
 * Directory the host considers "the repo". Anything inside
 * `<HOST_REPO_ROOT>/plugins/` is treated as a core plugin and
 * gets the `"core"` tag.
 *
 * Resolved from `process.cwd()`: in dev this is the monorepo
 * root, in a packaged build it's wherever the app boots from.
 * Good enough — the tag is informational.
 */
const HOST_REPO_ROOT = process.cwd()
const HOST_PLUGINS_DIR = path.join(HOST_REPO_ROOT, "plugins")

/**
 * Convention: each plugin may ship an icon at one of these
 * locations, in priority order. PNG wins because that's the
 * format the icon-gen pipeline produces today; SVG fallbacks
 * are accepted for plugins that want to ship vector marks.
 */
const ICON_CANDIDATES = [
  "assets/icon.png",
  "assets/icon.svg",
  "icon.svg",
  "icon.png",
] as const

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

/** Hard ceiling — favicon-style marks fit comfortably under this. */
const MAX_ICON_BYTES = 1024 * 1024

type PluginKind = "plugin" | "pi-extension"
type PluginTag = "core" | "pi" | null
type PluginListing = {
  name: string
  dir: string
  kind: PluginKind
  tag: PluginTag
}
type IconRecord = {
  blobId: string
  mime: string
  sourcePath: string
  hash: string
}
type DiscoveredIcon = {
  bytes: Buffer
  mime: string
  sourcePath: string
  hash: string
}

/**
 * Build the unified listing array from a config snapshot plus the
 * pi-extensions directory. Sorted case-insensitively by name so
 * the sidebar lands alphabetic without the renderer having to
 * re-sort.
 */
function buildListings(snapshot: ConfigSnapshot): PluginListing[] {
  const fromPlugins: PluginListing[] = snapshot.plugins.map(p => ({
    name: p.name,
    dir: p.dir,
    kind: "plugin",
    tag: isCorePluginDir(p.dir) ? "core" : null,
  }))
  const fromPi: PluginListing[] = readPiExtensions()
  return [...fromPlugins, ...fromPi].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  )
}

function isCorePluginDir(pluginDir: string): boolean {
  const resolved = path.resolve(pluginDir)
  // Trailing separator so we don't false-match a sibling of
  // `plugins/` named e.g. `plugins-attic/`.
  return resolved.startsWith(HOST_PLUGINS_DIR + path.sep)
}

function readPiExtensions(): PluginListing[] {
  const out: PluginListing[] = []
  for (const dir of [PI_EXTENSIONS_DIR, PI_EXTENSIONS_DISABLED_DIR]) {
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith(".ts")) continue
      const abs = path.join(dir, entry)
      try {
        const stat = fs.statSync(abs)
        if (!stat.isFile()) continue
      } catch {
        continue
      }
      const name = entry.replace(/\.ts$/, "")
      out.push({ name, dir: abs, kind: "pi-extension", tag: "pi" })
    }
  }
  return out
}

function listingsEqual(a: PluginListing[], b: PluginListing[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (
      x.name !== y.name ||
      x.dir !== y.dir ||
      x.kind !== y.kind ||
      x.tag !== y.tag
    ) {
      return false
    }
  }
  return true
}

function discoverIcon(pluginDir: string): DiscoveredIcon | null {
  for (const rel of ICON_CANDIDATES) {
    const abs = path.join(pluginDir, rel)
    let stat: fs.Stats
    try {
      stat = fs.statSync(abs)
    } catch {
      continue
    }
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ICON_BYTES) {
      continue
    }
    let bytes: Buffer
    try {
      bytes = fs.readFileSync(abs)
    } catch {
      continue
    }
    const mime =
      MIME_BY_EXT[path.extname(abs).toLowerCase()] ??
      "application/octet-stream"
    const hash = crypto.createHash("sha1").update(bytes).digest("hex")
    return { bytes, mime, sourcePath: abs, hash }
  }
  return null
}

/**
 * Mirrors the host's resolved plugin list + icon files into the
 * app DB. Lives inside `app` (not its own plugin) because the
 * plugins root view consumes it directly and there's no value in
 * a separate plugin boundary.
 *
 * Three jobs, all gated on equality / hash to avoid churn:
 *
 *  1. **Plugin list.** `getConfig().plugins` → `root.app.plugins`,
 *     sorted by name.
 *  2. **Icon indexing.** For each plugin, look for `assets/icon.png`
 *     (or SVG fallback), hash the bytes, mint a blob iff the hash
 *     changed, drop the previous blob. Stale icons (plugin gone,
 *     or file deleted) get cleaned up too.
 *  3. **Subscription.** `subscribeConfig` keeps the mirror in
 *     sync with edits to `zenbu.config.ts` / `zenbu.plugin.ts`
 *     without requiring a re-evaluate.
 *
 * The initial fire of `subscribeConfig` handles boot — we don't
 * also need an up-front sync.
 */
export class PluginRegistryMirrorService extends Service.create({
  key: "pluginRegistryMirror",
  deps: { db: DbService },
}) {
  evaluate() {
    this.setup("mirror-plugin-registry", () => {
      const unsubscribe = subscribeConfig(snapshot => {
        void this.syncFromSnapshot(snapshot)
      })
      // Belt-and-braces: drive one extra sync from the current
      // snapshot in case anything raced.
      void this.syncFromSnapshot(getConfig())
      return unsubscribe
    })
  }

  private async syncFromSnapshot(snapshot: ConfigSnapshot): Promise<void> {
    const next = buildListings(snapshot)

    // Discover icons on disk before opening a DB update — we don't
    // want to hold an update transaction while reading files. Pi
    // extensions don't have an `assets/` directory; they're single
    // .ts files. Skip icon discovery for them — the sidebar's
    // built-in puzzle glyph fallback covers it.
    const discovered = new Map<string, DiscoveredIcon | null>()
    for (const p of next) {
      if (p.kind !== "plugin") {
        discovered.set(p.name, null)
        continue
      }
      try {
        discovered.set(p.name, discoverIcon(p.dir))
      } catch (err) {
        console.error(
          `[plugin-registry-mirror] icon discovery failed for ${p.name}:`,
          err,
        )
        discovered.set(p.name, null)
      }
    }

    const rootSnapshot = this.ctx.db.client.readRoot()
    const prevIcons = (rootSnapshot.app.pluginIcons ?? {}) as Record<
      string,
      IconRecord
    >

    // Diff: which blobs need creating, which need retiring.
    const blobsToCreate: Array<{
      name: string
      bytes: Buffer
      mime: string
      sourcePath: string
      hash: string
    }> = []
    const blobIdsToDelete: string[] = []

    for (const p of next) {
      const want = discovered.get(p.name) ?? null
      const have = prevIcons[p.name] ?? null
      if (!want) {
        if (have) blobIdsToDelete.push(have.blobId)
        continue
      }
      if (have && have.hash === want.hash) continue
      if (have) blobIdsToDelete.push(have.blobId)
      blobsToCreate.push({
        name: p.name,
        bytes: want.bytes,
        mime: want.mime,
        sourcePath: want.sourcePath,
        hash: want.hash,
      })
    }
    // Drop blobs for plugins that vanished entirely.
    const nextNames = new Set(next.map(p => p.name))
    for (const name of Object.keys(prevIcons)) {
      if (!nextNames.has(name)) {
        const rec = prevIcons[name]
        if (rec) blobIdsToDelete.push(rec.blobId)
      }
    }

    const created: Array<{ name: string; record: IconRecord }> = []
    for (const job of blobsToCreate) {
      try {
        const blobId = await this.ctx.db.client.createBlob(
          new Uint8Array(job.bytes),
          true,
        )
        created.push({
          name: job.name,
          record: {
            blobId,
            mime: job.mime,
            sourcePath: job.sourcePath,
            hash: job.hash,
          },
        })
      } catch (err) {
        console.error(
          `[plugin-registry-mirror] createBlob failed for ${job.name}:`,
          err,
        )
      }
    }

    // Single atomic write covers the plugin list + icon map.
    await this.ctx.db.client.update(root => {
      const prev = root.app.plugins as PluginListing[]
      if (!listingsEqual(prev, next)) {
        root.app.plugins = next
      }
      const icons = root.app.pluginIcons as Record<string, IconRecord>
      for (const name of Object.keys(icons)) {
        if (!nextNames.has(name)) {
          delete icons[name]
          continue
        }
        if (discovered.get(name) == null) {
          delete icons[name]
        }
      }
      for (const c of created) {
        icons[c.name] = c.record
      }
    })

    // Fire-and-forget blob retirement.
    for (const blobId of blobIdsToDelete) {
      void this.ctx.db.client.deleteBlob(blobId).catch((err: unknown) => {
        console.error("[plugin-registry-mirror] deleteBlob failed:", err)
      })
    }
  }
}

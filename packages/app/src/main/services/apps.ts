import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import { shell } from "electron"
import { Service } from "@zenbujs/core/runtime"

const execFileP = promisify(execFile)

const APPS_ROOT = path.join(os.homedir(), ".zenbu", "apps")

export type AppEntry = {
  slug: string
  displayName: string
  version: string
  sourceDir: string
  bundlePath: string | null
}

/**
 * Scans `~/.zenbu/apps` for scaffolded zenbu apps and exposes simple
 * lookup / launch / icon-read RPC methods. The list is computed on
 * demand — we don't mirror it into the DB the way cza-gui does because
 * the command palette is a transient view and re-scanning is cheap.
 */
export class AppsService extends Service.create({
  key: "apps",
}) {
  /**
   * One row per directory under `~/.zenbu/apps` that contains a
   * `package.json`. `displayName` falls back to the slug when the
   * package's `name` field is missing.
   */
  async list(): Promise<{ rows: AppEntry[] }> {
    if (!fs.existsSync(APPS_ROOT)) return { rows: [] }
    const slugs = await fs.promises.readdir(APPS_ROOT)
    const rows: AppEntry[] = []
    for (const slug of slugs) {
      const sourceDir = path.join(APPS_ROOT, slug)
      try {
        const stat = await fs.promises.stat(sourceDir)
        if (!stat.isDirectory()) continue
      } catch {
        continue
      }
      const pkgPath = path.join(sourceDir, "package.json")
      let displayName = slug
      let version = ""
      try {
        const raw = await fs.promises.readFile(pkgPath, "utf-8")
        const pkg = JSON.parse(raw) as { name?: string; version?: string }
        if (typeof pkg.name === "string" && pkg.name.length > 0) {
          displayName = pkg.name
        }
        if (typeof pkg.version === "string") version = pkg.version
      } catch {
        continue
      }
      rows.push({
        slug,
        displayName,
        version,
        sourceDir,
        bundlePath: resolveBundlePath(displayName),
      })
    }
    rows.sort((a, b) => a.displayName.localeCompare(b.displayName))
    return { rows }
  }

  /**
   * Launches the given app's `.app` bundle via Launch Services. Throws
   * when no bundle exists yet (the source is scaffolded but the user
   * hasn't built / installed the .app).
   */
  async launch(args: { slug: string }) {
    const row = await this.find(args.slug)
    if (!row) throw new Error(`Unknown app: ${args.slug}`)
    if (!row.bundlePath) {
      throw new Error(`No installed bundle for ${row.displayName}.`)
    }
    const err = await shell.openPath(row.bundlePath)
    if (err) throw new Error(err)
  }

  /**
   * Decodes the bundle's `.icns` icon to a PNG data URL using macOS's
   * built-in `sips`. Returns `null` when there's no bundle or no icon
   * file (or we're not on macOS). Errors are swallowed and reported as
   * `null` so the renderer can fall back to a letter avatar.
   */
  async readIconPng(args: { slug: string }): Promise<{ dataUrl: string | null }> {
    if (process.platform !== "darwin") return { dataUrl: null }
    const row = await this.find(args.slug)
    if (!row?.bundlePath) return { dataUrl: null }
    try {
      const icns = findIcnsInBundle(row.bundlePath)
      if (!icns) return { dataUrl: null }
      const tmp = path.join(
        os.tmpdir(),
        `zenbu-icon-${row.slug}-${Date.now()}.png`,
      )
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
      await fs.promises.unlink(tmp).catch(() => {})
      const b64 = buf.toString("base64")
      return { dataUrl: `data:image/png;base64,${b64}` }
    } catch (err) {
      console.warn("[apps] readIconPng failed for", args.slug, err)
      return { dataUrl: null }
    }
  }

  private async find(slug: string): Promise<AppEntry | null> {
    const { rows } = await this.list()
    return rows.find(r => r.slug === slug) ?? null
  }
}

/**
 * Same fallback rule as `create-zenbu-app/desktop`: prefer
 * `/Applications/<displayName>.app`, otherwise `~/Applications/...`.
 * Returns `null` when neither bundle exists yet.
 */
function resolveBundlePath(displayName: string): string | null {
  const candidates = [
    path.join("/Applications", `${displayName}.app`),
    path.join(os.homedir(), "Applications", `${displayName}.app`),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Walks the bundle's `Contents/Resources/` for the first `.icns` file.
 * Most bundles have exactly one and call it `icon.icns`, but
 * electron-builder occasionally names it after the app (e.g. `app.icns`),
 * so we scan instead of guessing.
 */
function findIcnsInBundle(bundlePath: string): string | null {
  const resources = path.join(bundlePath, "Contents", "Resources")
  if (!fs.existsSync(resources)) return null
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

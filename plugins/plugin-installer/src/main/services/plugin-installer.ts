import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnWithInstallHangGuard } from "@zenbujs/core/install-guard"
import { Service } from "@zenbujs/core/runtime"
import { RpcService } from "@zenbujs/core/services"

/**
 * Plugin-installer main service.
 *
 * Owns three responsibilities:
 *  1. Registers a command-palette action ("Install plugin from
 *     GitHub…"). The action's RPC handler is `openPrompt`, which
 *     just emits an event the content-script modal listens for.
 *  2. The `install` RPC: clone → `pnpm install` → patch
 *     `zenbu.local.ts`. Progress is streamed via events.
 *  3. The local-config transform itself (see `patchLocalPlugins`).
 *
 * We talk to the host's `paletteActions` service by string key so we
 * don't have to import its class (and pull its types into our
 * dependsOn graph just for one register/unregister call).
 */
const PLUGINS_HOME = path.join(os.homedir(), ".zenbu", "plugins")
const INTERNAL_PATHS_JSON = path.join(
  os.homedir(),
  ".zenbu",
  ".internal",
  "paths.json",
)

export class PluginInstallerService extends Service.create({
  key: "pluginInstaller",
  deps: {
    rpc: RpcService,
    // String-keyed dep — service is exposed by the host's `app`
    // plugin; we don't want to take a typed dependency on its class
    // just to call register/unregister.
    paletteActions: "paletteActions",
  },
}) {
  evaluate() {
    this.setup("register-palette-action", () => {
      const reg = this.ctx.paletteActions as {
        register: (spec: unknown) => Promise<unknown>
        unregister: (a: { id: string }) => Promise<unknown>
      }
      const id = "plugin-installer:install"
      void reg.register({
        id,
        label: "Install plugin from git repo…",
        hint: "install",
        // No `icon` field — the palette is label-only by design now.
        group: "Plugins",
        rpc: {
          plugin: "pluginInstaller",
          service: "pluginInstaller",
          method: "openPrompt",
        },
      })
      return () => {
        void reg.unregister({ id })
      }
    })

    this.setup("inject-modal", () =>
      this.injectContentScript({
        view: "entrypoint",
        modulePath: "src/content/installer-modal.tsx",
      }),
    )
  }

  /**
   * Palette-action RPC handler. The renderer dispatch always passes
   * `{ windowId }`, which we forward so a multi-window setup can
   * (in the future) target the originating window.
   */
  async openPrompt(args: { windowId: string }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.pluginInstaller.openPrompt({ windowId: args.windowId })
    return { ok: true }
  }

  /**
   * Clone + install + register. Reports progress through events.
   *
   * The caller can keep calling this if the URL is wrong / the
   * clone fails — we always clean up a half-created plugin
   * directory on error so the next attempt starts from scratch.
   */
  async install(args: { url: string }): Promise<{
    ok: true
    name: string
    path: string
  }> {
    const url = args.url.trim()
    if (!url) throw new Error("Empty URL.")

    const name = derivePluginName(url)
    if (!name) throw new Error(`Could not derive a plugin name from "${url}".`)

    const dest = path.join(PLUGINS_HOME, name)
    const cleanupOnError = async () => {
      try {
        await fsp.rm(dest, { recursive: true, force: true })
      } catch {}
    }

    try {
      await fsp.mkdir(PLUGINS_HOME, { recursive: true })

      if (fs.existsSync(dest)) {
        // If something is already there but it isn't a usable
        // plugin (no manifest), nuke it and re-clone. If it IS a
        // plugin we assume the user wants a fresh copy — also
        // nuke and re-clone, since git refuses non-empty dirs.
        await fsp.rm(dest, { recursive: true, force: true })
      }

      this.emit("clone", `Cloning ${url}…`)
      await this.run("git", ["clone", "--depth", "1", url, dest])

      const manifest = path.join(dest, "zenbu.plugin.ts")
      const manifestJs = path.join(dest, "zenbu.plugin.js")
      if (!fs.existsSync(manifest) && !fs.existsSync(manifestJs)) {
        throw new Error(
          "Repo has no `zenbu.plugin.ts` at its root — not a Zenbu plugin.",
        )
      }

      this.emit("install", `Installing dependencies with pnpm…`)
      const pnpm = resolvePnpm()
      await this.run(pnpm, ["install", "--prefer-offline"], { cwd: dest })

      this.emit("register", `Registering with zenbu.local.ts…`)
      const manifestPath = fs.existsSync(manifest) ? manifest : manifestJs
      const projectDir = projectRootFromService()
      await patchLocalPlugins(projectDir, manifestPath)

      this.ctx.rpc.emit.pluginInstaller.installComplete({
        name,
        path: dest,
      })
      return { ok: true, name, path: dest }
    } catch (err) {
      await cleanupOnError()
      const message = err instanceof Error ? err.message : String(err)
      this.ctx.rpc.emit.pluginInstaller.installError({ message })
      throw err
    }
  }

  // ---- internals ---------------------------------------------------

  private emit(
    phase: "clone" | "install" | "register" | "log",
    message: string,
  ) {
    this.ctx.rpc.emit.pluginInstaller.installProgress({ phase, message })
  }

  /**
   * Spawn a child command and surface every output line as an
   * `installProgress` event. For `pnpm install` we route through
   * `spawnWithInstallHangGuard` from the framework, which transparently
   * detects + survives the post-"Done" pnpm hang and appends an
   * incident to `~/.zenbu/.internal/install-incidents.log`.
   */
  private async run(
    cmd: string,
    argv: string[],
    opts: { cwd?: string } = {},
  ): Promise<void> {
    const isPnpm = /(^|[\\/])pnpm(\W|$)/i.test(cmd)
    await spawnWithInstallHangGuard({
      bin: cmd,
      args: argv,
      cwd: opts.cwd ?? process.cwd(),
      env: process.env,
      pmType: isPnpm ? "pnpm" : undefined,
      label: `${cmd} ${argv.join(" ")}`,
      onLine: (line) => this.emit("log", line),
    })
  }
}

/* -------------------------------------------------------------------------- */
/*                              local-config patch                            */
/* -------------------------------------------------------------------------- */
/**
 * The user's `zenbu.local.ts` is a gitignored overlay whose default
 * export is a plugin entry or array of entries. We need to add the
 * newly-cloned plugin to it.
 *
 * Strategy, in order of preference:
 *
 *  1. **File doesn't exist** — write a minimal one with the new
 *     entry. Trivial.
 *
 *  2. **Simple-case detection** — scan the source for a literal
 *     array that is *either* directly `export default [ … ]` or
 *     bound to a `const X = [ … ]` whose name appears in
 *     `export default X`. If we find one, insert a string element
 *     at the end of the array. This keeps the user's existing
 *     formatting and any inline `definePlugin({...})` entries
 *     untouched.
 *
 *  3. **Wrap fallback** — rename the existing file to
 *     `zenbu.local.previous.ts` and write a new `zenbu.local.ts`
 *     that imports it and concatenates. This handles arbitrary
 *     shapes (function-returning-array, dynamic logic, etc.) at
 *     the cost of one extra file. Repeated wraps stay flat by
 *     versioning the suffix.
 *
 * The transform is text-only — no TypeScript AST — because the
 * overlay file is by convention small and shape-restricted, and
 * the wrap fallback covers everything we can't pattern-match.
 */
export async function patchLocalPlugins(
  projectDir: string,
  manifestPath: string,
): Promise<void> {
  const localPath = path.join(projectDir, "zenbu.local.ts")
  const newEntry = JSON.stringify(manifestPath)

  if (!fs.existsSync(localPath)) {
    const body =
      `// Auto-generated by the plugin-installer plugin.\n` +
      `// Add or remove entries here to enable / disable user-installed plugins.\n` +
      `import type { LocalPluginsDefault } from "@zenbujs/core/config"\n\n` +
      `const plugins: LocalPluginsDefault = [\n` +
      `  ${newEntry},\n` +
      `]\n\n` +
      `export default plugins\n`
    await fsp.writeFile(localPath, body, "utf8")
    return
  }

  const original = await fsp.readFile(localPath, "utf8")

  // Idempotence: if the entry is already mentioned, no-op.
  if (original.includes(newEntry) || original.includes(manifestPath)) return

  // Try simple-case detection.
  const patched = tryInsertIntoArrayLiteral(original, newEntry)
  if (patched !== null) {
    await fsp.writeFile(localPath, patched, "utf8")
    return
  }

  // Wrap fallback. Pick a non-colliding "previous" filename so we
  // can wrap multiple times across multiple installs without ever
  // overwriting a real source file.
  const previousPath = nextAvailablePath(
    projectDir,
    "zenbu.local.previous",
    ".ts",
  )
  await fsp.rename(localPath, previousPath)
  const previousRel = "./" + path.basename(previousPath, ".ts")
  const wrapped =
    `// Auto-wrapped by the plugin-installer plugin.\n` +
    `// The previous overlay is preserved at ${path.basename(previousPath)}.\n` +
    `import previous from "${previousRel}"\n\n` +
    `const __previousArr = Array.isArray(previous) ? previous : [previous]\n` +
    `export default [...__previousArr, ${newEntry}]\n`
  await fsp.writeFile(localPath, wrapped, "utf8")
}

/**
 * Try to insert `entry` (already JSON-stringified) into the default-
 * exported array literal in `source`. Returns the new source on
 * success, or `null` if we can't confidently identify the array.
 *
 * Recognized shapes:
 *   export default [ … ]
 *   export default ([ … ]) as LocalPluginsDefault
 *   export default ([ … ] satisfies LocalPluginsDefault)
 *   const X: ... = [ … ];  export default X
 *   const X = [ … ];       export default X
 *
 * We deliberately *don't* try to handle `export default fn(...)` —
 * that drops to the wrap fallback.
 */
function tryInsertIntoArrayLiteral(
  source: string,
  entry: string,
): string | null {
  // Case A: `export default [...]` (with optional cast/satisfies).
  const directRe =
    /export\s+default\s*\(?\s*(\[)/m
  const direct = directRe.exec(source)
  if (direct) {
    const openIdx = direct.index + direct[0].length - 1
    const closeIdx = findMatchingBracket(source, openIdx)
    if (closeIdx !== -1) {
      return insertBeforeArrayClose(source, openIdx, closeIdx, entry)
    }
  }

  // Case B: `const X = [...]; ... export default X;`
  const defaultIdentRe = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m
  const defaultIdent = defaultIdentRe.exec(source)
  if (defaultIdent) {
    const name = defaultIdent[1]
    // Find `const|let|var <name> [: type] = [`
    const bindingRe = new RegExp(
      `\\b(?:const|let|var)\\s+${escapeReg(name)}\\s*(?::[^=]+)?=\\s*(\\[)`,
      "m",
    )
    const binding = bindingRe.exec(source)
    if (binding) {
      const openIdx = binding.index + binding[0].length - 1
      const closeIdx = findMatchingBracket(source, openIdx)
      if (closeIdx !== -1) {
        return insertBeforeArrayClose(source, openIdx, closeIdx, entry)
      }
    }
  }

  return null
}

function insertBeforeArrayClose(
  source: string,
  openIdx: number,
  closeIdx: number,
  entry: string,
): string {
  // Detect indentation by looking at the line containing the
  // opening bracket — use indent + 2 spaces for the new element.
  const lineStart = source.lastIndexOf("\n", openIdx) + 1
  const indentMatch = /^[ \t]*/.exec(source.slice(lineStart, openIdx))
  const indent = (indentMatch?.[0] ?? "") + "  "

  // Inner content between `[` and `]`.
  const inner = source.slice(openIdx + 1, closeIdx)
  const trimmedInner = inner.trim()

  let insertion: string
  if (trimmedInner.length === 0) {
    insertion = `\n${indent}${entry},\n${indent.slice(2)}`
  } else {
    // Ensure trailing comma before our new line.
    const needsComma = !/,\s*$/.test(inner)
    insertion =
      inner.replace(/\s*$/, "") +
      (needsComma ? "," : "") +
      `\n${indent}${entry},\n${indent.slice(2)}`
  }

  return (
    source.slice(0, openIdx + 1) + insertion + source.slice(closeIdx)
  )
}

/**
 * Find the index of the `]` that closes the `[` at `openIdx`,
 * respecting nested brackets, single/double/template-string
 * literals, and line / block comments. Returns -1 if unbalanced.
 */
function findMatchingBracket(s: string, openIdx: number): number {
  let depth = 0
  let i = openIdx
  while (i < s.length) {
    const ch = s[i]
    // Line comment.
    if (ch === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i)
      i = nl === -1 ? s.length : nl + 1
      continue
    }
    // Block comment.
    if (ch === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2)
      i = end === -1 ? s.length : end + 2
      continue
    }
    // String / template literals — skip over them entirely. We
    // don't need full template-expression support here because
    // the file is small and tolerating false negatives just sends
    // us to the wrap fallback, which is safe.
    if (ch === '"' || ch === "'" || ch === "`") {
      i++
      while (i < s.length && s[i] !== ch) {
        if (s[i] === "\\") i += 2
        else i++
      }
      i++
      continue
    }
    if (ch === "[") depth++
    else if (ch === "]") {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function nextAvailablePath(
  dir: string,
  base: string,
  ext: string,
): string {
  let candidate = path.join(dir, `${base}${ext}`)
  let n = 1
  while (fs.existsSync(candidate)) {
    n++
    candidate = path.join(dir, `${base}.${n}${ext}`)
  }
  return candidate
}

/* -------------------------------------------------------------------------- */
/*                                  helpers                                   */
/* -------------------------------------------------------------------------- */

/**
 * Derive a sensible directory name from a git URL. Strips `.git`
 * and any trailing path delimiter. Handles `https://…/owner/repo`,
 * `git@github.com:owner/repo`, and `owner/repo` (GitHub shorthand).
 */
function derivePluginName(url: string): string | null {
  let s = url.trim()
  s = s.replace(/\.git$/i, "")
  s = s.replace(/\/$/, "")
  // git@host:owner/repo style → use the last segment after ":" or "/"
  const lastSlash = s.lastIndexOf("/")
  const lastColon = s.lastIndexOf(":")
  const idx = Math.max(lastSlash, lastColon)
  if (idx === -1) return null
  const name = s.slice(idx + 1)
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null
  return name
}

/**
 * Locate the bundled pnpm. The launcher writes the toolchain paths
 * to `~/.zenbu/.internal/paths.json` on boot; we read from there.
 * Fall back to `pnpm` on $PATH if for any reason the file isn't
 * there (e.g. dev mode without the launcher).
 */
function resolvePnpm(): string {
  try {
    const raw = fs.readFileSync(INTERNAL_PATHS_JSON, "utf8")
    const parsed = JSON.parse(raw) as { pnpmPath?: string }
    if (parsed.pnpmPath && fs.existsSync(parsed.pnpmPath))
      return parsed.pnpmPath
  } catch {}
  return "pnpm"
}

/**
 * The project root we want to patch (`zenbu.local.ts` lives next
 * to `zenbu.config.ts`). At runtime the service has no direct
 * handle on it, so we walk up from `process.cwd()` until we find
 * a `zenbu.config.ts`.
 */
function projectRootFromService(): string {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "zenbu.config.ts"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

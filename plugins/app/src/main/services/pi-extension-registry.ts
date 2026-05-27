import { Service } from "@zenbujs/core/runtime"
import { DbService } from "@zenbujs/core/services"

export type RegisteredPiExtension = {
  id: string
  path: string
  meta?: {
    label?: string
    pluginName?: string
  }
}

/**
 * Generic registry of Pi extensions contributed by zenbu plugins.
 *
 * App-owned extensions should not use this path registry. Put them in
 * `packages/app/src/main/pi-extensions/` and add them to
 * `createAppPiExtensionFactories()` so embedded sessions load them via
 * the Pi SDK's in-memory `DefaultResourceLoader.extensionFactories` hook.
 *
 * Mirrors the shape of `ViewRegistryService`: any plugin can register
 * an absolute filesystem path to a Pi extension `.ts` file from
 * within its own service `setup()` block. `SessionsService` reads
 * `list()` when activating a session and forwards the paths to
 * `DefaultResourceLoader({ additionalExtensionPaths })` so Pi loads
 * them via its normal extension discovery.
 *
 * Lifecycle:
 *  - `evaluate()` wipes `root.app.piExtensions` on every service
 *    start. Plugin services depend on this service, so they run
 *    after; their `setup()` blocks call `register()` and pair it
 *    with `unregister()` in the cleanup. The DB record is therefore
 *    always a faithful reflection of what's currently installed.
 *  - The renderer can `useDb(root => root.app.piExtensions)` for a
 *    live view of installed extensions — useful for a future
 *    marketplace UI.
 *
 * No automatic session reload: live `AgentSession`s ignore
 * registry changes after activation. The next `activate()` (new
 * session, switch, fork, manual reload) picks up whatever is in
 * the registry at that moment.
 */
export class PiExtensionRegistryService extends Service.create({
  key: "piExtensionRegistry",
  deps: { db: DbService },
}) {
  async evaluate() {
    // Wipe stale entries from the previous process. Plugins that
    // depend on us re-register from their own evaluate() / setup().
    await this.ctx.db.client.update(root => {
      root.app.piExtensions = {}
    })
  }

  async register(args: RegisteredPiExtension): Promise<{ ok: true }> {
    await this.ctx.db.client.update(root => {
      root.app.piExtensions[args.id] = {
        id: args.id,
        path: args.path,
        meta: args.meta ?? {},
      }
    })
    return { ok: true }
  }

  async unregister(args: { id: string }): Promise<{ ok: true }> {
    await this.ctx.db.client.update(root => {
      delete root.app.piExtensions[args.id]
    })
    return { ok: true }
  }

  /** Snapshot of the registry, suitable for feeding into
   * `DefaultResourceLoader({ additionalExtensionPaths: list().map(e => e.path) })`. */
  list(): RegisteredPiExtension[] {
    return Object.values(this.ctx.db.client.readRoot().app.piExtensions ?? {})
  }
}

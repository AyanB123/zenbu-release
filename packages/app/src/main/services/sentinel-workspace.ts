import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { nanoid } from "nanoid"
import { Service } from "@zenbujs/core/runtime"
import { DbService } from "@zenbujs/core/services"
import { ReposService } from "./repos"

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Bundled with the source tree so the sentinel workspace's icon is
 * always available, no runtime dependency on `~/.zenbu/plugins/...`. */
const SENTINEL_ICON_PATH = path.resolve(HERE, "..", "assets", "sentinel-icon.png")

const SENTINEL_NAME = "Zenbu"
const SENTINEL_ICON_MIME = "image/png"

/**
 * Owns the built-in "self-edit" workspace pinned at the bottom of the
 * workspace rail.
 *
 * The whole point: this app is itself a zenbu.js app, and its source
 * tree is checked out at `process.cwd()` (the directory the app boots
 * from — in dev this is the repo root, in production it's the cloned
 * mirror under `~/.zenbu/<app>/`). Exposing that directory as a
 * default, undeletable workspace gives the user a one-click path from
 * "I use the IDE" to "I modify the IDE" without having to remember
 * where the source lives or how to add it as a workspace by hand.
 *
 * On every boot we ensure exactly one workspace with `sentinel: true`
 * exists. We never reach in to "fix" non-sentinel workspaces — the
 * user is free to delete or archive any they created themselves.
 */
export class SentinelWorkspaceService extends Service.create({
  key: "sentinelWorkspace",
  deps: { db: DbService, repos: ReposService },
}) {
  async evaluate() {
    const root = this.ctx.db.client.readRoot()
    const existing = Object.values(root.app.workspaces).find(
      w => w.sentinel,
    )

    if (existing) {
      // Ensure the scope still exists. If it does, we're done — we
      // don't overwrite the user's name / icon / scope choices.
      const hasScope = Object.values(root.app.scopes).some(
        s => s.workspaceId === existing.id && !s.archived,
      )
      if (hasScope) return
      // Workspace exists but its scope was archived/deleted — fall
      // through to recreate the scope so the workspace is usable.
      await this.ensureScope(existing.id)
      return
    }

    await this.createSentinel()
  }

  /** Create the sentinel workspace, scope, and a pending chat. */
  private async createSentinel() {
    const directory = process.cwd()

    let iconBlobId: string | null = null
    try {
      const data = await fs.readFile(SENTINEL_ICON_PATH)
      iconBlobId = await this.ctx.db.client.createBlob(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        true,
      )
    } catch (err) {
      // Non-fatal: fall back to the letter avatar. We still create
      // the workspace so the user has the self-edit entry point.
      console.warn(
        "[sentinel-workspace] could not load bundled icon:",
        err,
      )
    }

    const { repoId } = await this.ctx.repos
      .detectAndSync({ directory })
      .catch(err => {
        console.warn(
          "[sentinel-workspace] repos.detectAndSync failed:",
          err,
        )
        return { repoId: null as string | null }
      })

    const workspaceId = nanoid()
    const scopeId = nanoid()
    const chatId = nanoid()
    const now = Date.now()

    await this.ctx.db.client.update(root => {
      root.app.workspaces[workspaceId] = {
        id: workspaceId,
        name: SENTINEL_NAME,
        createdAt: now,
        icon: iconBlobId
          ? { blobId: iconBlobId, mimeType: SENTINEL_ICON_MIME }
          : null,
        archived: false,
        sentinel: true,
      }
      root.app.scopes[scopeId] = {
        id: scopeId,
        workspaceId,
        directory,
        repoId,
        extraDirectories: [],
        createdAt: now,
        archived: false,
      }
      root.app.chats[chatId] = {
        id: chatId,
        scopeId,
        session: { kind: "pending" },
        createdAt: now,
      }
    })
  }

  /** Recreate a scope (and pending chat) for an existing sentinel
   * workspace whose original scope was deleted. */
  private async ensureScope(workspaceId: string) {
    const directory = process.cwd()
    const { repoId } = await this.ctx.repos
      .detectAndSync({ directory })
      .catch(() => ({ repoId: null as string | null }))

    const scopeId = nanoid()
    const chatId = nanoid()
    const now = Date.now()

    await this.ctx.db.client.update(root => {
      const ws = root.app.workspaces[workspaceId]
      if (!ws) return
      root.app.scopes[scopeId] = {
        id: scopeId,
        workspaceId,
        directory,
        repoId,
        extraDirectories: [],
        createdAt: now,
        archived: false,
      }
      root.app.chats[chatId] = {
        id: chatId,
        scopeId,
        session: { kind: "pending" },
        createdAt: now,
      }
    })
  }
}

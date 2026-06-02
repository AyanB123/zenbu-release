import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { nanoid } from "nanoid"
import { Service } from "@zenbujs/core/runtime"
import { DbService } from "@zenbujs/core/services"
import { ReposService } from "./repos"
import type { Schema } from "../schema"

type WindowState = Schema["windowStates"][string]
type ScopePaneState = WindowState["scopePanes"][string]

const PLAYGROUND_DIR_NAME = "zenbu-playground"
const PLAYGROUND_WORKSPACE_NAME = "Playground"
/** Matches `DEFAULT_WINDOW_ID` in window-state/window-id.ts. */
const MAIN_WINDOW_ID = "main"

/**
 * Seeds the auto-created "Playground" workspace on a fresh DB:
 * materializes `~/zenbu-playground` (sample files + optional git
 * repo) and opens it with the `tutorial` view as the default tab.
 * Runs before `InitService` (via its deps) so the window lands on
 * the playground instead of the onboarding screen. Idempotent —
 * a no-op once a `playground: true` workspace exists.
 */
export class PlaygroundService extends Service.create({
  key: "playground",
  deps: { db: DbService, repos: ReposService },
}) {
  async evaluate() {
    const root = this.ctx.db.client.readRoot()
    const existing = Object.values(root.app.workspaces).find(
      w => w.playground === true && !w.archived,
    )
    if (existing) {
      // Re-create the folder if the user deleted it on disk, then
      // make sure the first window still lands on the playground.
      await this.ensureExistingPlaygroundOnDisk(existing.id)
      await this.pointMainWindowAtPlayground(existing.id)
      return
    }

    const ensured = await this.ensurePlaygroundDirectory()
    if (!ensured) return
    const { directory, created } = ensured

    // Sample files only on fresh creation (never clobber the user's).
    if (created) {
      await this.seedSampleFiles(directory)
    }

    const workspaceId = nanoid()
    const scopeId = nanoid()
    const paneId = nanoid()
    const tabId = nanoid()
    const now = Date.now()

    await this.ctx.db.client.update(root => {
      root.app.workspaces[workspaceId] = {
        id: workspaceId,
        name: PLAYGROUND_WORKSPACE_NAME,
        createdAt: now,
        icon: null,
        iconAuto: null,
        iconAutoAttempted: true, // Skip the discovery walk for an empty folder.
        archived: false,
        kind: "default",
        defaultWorktreeBranch: null,
        playground: true,
      }
      root.app.scopes[scopeId] = {
        id: scopeId,
        workspaceId,
        directory,
        repoId: null,
        extraDirectories: [],
        createdAt: now,
        archived: false,
        archivedAt: null,
        pinnedAt: now,
        unpinnedAt: null,
        pluginName: null,
      }

      const ws = ensureWindowState(root, MAIN_WINDOW_ID)
      // Only redirect from the onboarding view, never override an
      // existing workspace/view choice.
      if (ws.activeView.kind === "onboarding") {
        ws.activeView = { kind: "workspace", workspaceId }
        ws.selectedScopeId = scopeId
        ws.workspaceActiveScope[workspaceId] = scopeId
      }
      // Left sidebar collapsed for the playground (per-workspace
      // state, so it doesn't affect projects the user opens later).
      ws.workspaceUiStates[workspaceId] = {
        sidebarWidth: null,
        leftSidebarOpen: false,
        leftSidebarTab: "agent",
      }
      // Default tab is the registered `tutorial` view, not a chat.
      const initialContent = {
        kind: "view" as const,
        viewType: "tutorial",
        args: {},
      }
      const paneState: ScopePaneState = {
        panes: [
          {
            id: paneId,
            tabs: [
              {
                id: tabId,
                content: initialContent,
              },
            ],
            activeTabId: tabId,
          },
        ],
        activePaneId: paneId,
      }
      ws.scopePanes[scopeId] = paneState
    })

    await this.gitInitIfAvailable(directory)
  }

  /**
   * `git init` over the seeded folder when git is available.
   * `stageInitialFiles: false` leaves the sample files untracked
   * so they show as pending changes in the Git sidebar.
   * Best-effort and idempotent.
   */
  private async gitInitIfAvailable(directory: string): Promise<void> {
    try {
      const gitAvailable = await this.ctx.repos.isGitInstalled()
      if (gitAvailable) {
        await this.ctx.repos.initRepoAtDirectory({
          directory,
          stageInitialFiles: false,
        })
      }
    } catch (err) {
      console.warn("[playground] git init for playground failed:", err)
    }
  }

  /**
   * Recreate the playground folder (sample files + git) if its
   * directory was deleted on disk. No-op when it's still there.
   */
  private async ensureExistingPlaygroundOnDisk(
    workspaceId: string,
  ): Promise<void> {
    const root = this.ctx.db.client.readRoot()
    const scope = Object.values(root.app.scopes).find(
      s => s.workspaceId === workspaceId && !s.archived,
    )
    if (!scope) return
    const directory = scope.directory
    if (fs.existsSync(directory)) return // still on disk — nothing to do

    try {
      await fsp.mkdir(directory, { recursive: true })
    } catch (err) {
      console.warn(
        "[playground] failed to recreate playground dir at %s:",
        directory,
        err,
      )
      return
    }
    await this.seedSampleFiles(directory)
    await this.gitInitIfAvailable(directory)
  }

  /**
   * Write a tiny sample project (README + a couple of Python
   * files) so the File-tree and Git sidebars have real content.
   * Best-effort; never overwrites existing files (`wx` flag).
   */
  private async seedSampleFiles(directory: string): Promise<void> {
    const files: Array<{ rel: string; body: string }> = [
      {
        rel: "README.md",
        body: [
          "# Zenbu Playground",
          "",
          "A scratch project that ships with Zenbu so you have",
          "somewhere to poke around on your first launch.",
          "",
          "Open the agent and ask it to change something — try",
          "\"make `main.py` greet the world in French\".",
          "",
        ].join("\n"),
      },
      {
        rel: "main.py",
        body: [
          "from greetings.hello import greet",
          "",
          "",
          'def main() -> None:',
          '    print(greet("world"))',
          "",
          "",
          'if __name__ == "__main__":',
          "    main()",
          "",
        ].join("\n"),
      },
      {
        rel: "greetings/__init__.py",
        body: "",
      },
      {
        rel: "greetings/hello.py",
        body: [
          'def greet(name: str) -> str:',
          '    """Return a friendly greeting for `name`."""',
          '    return f"Hello, {name}!"',
          "",
        ].join("\n"),
      },
    ]

    for (const file of files) {
      const abs = path.join(directory, file.rel)
      try {
        await fsp.mkdir(path.dirname(abs), { recursive: true })
        await fsp.writeFile(abs, file.body, { encoding: "utf8", flag: "wx" })
      } catch (err) {
        const e = err as NodeJS.ErrnoException
        if (e?.code === "EEXIST") continue
        console.warn("[playground] failed to seed %s:", file.rel, err)
      }
    }
  }

  /**
   * Ensure `~/zenbu-playground` exists. Returns its path plus a
   * `created` flag, or `null` (skip seeding) on failure.
   */
  private async ensurePlaygroundDirectory(): Promise<
    { directory: string; created: boolean } | null
  > {
    const home = os.homedir()
    if (!home) {
      console.warn(
        "[playground] no homedir resolvable, skipping playground seed",
      )
      return null
    }
    const directory = path.join(home, PLAYGROUND_DIR_NAME)
    try {
      if (fs.existsSync(directory)) {
        const stat = await fsp.stat(directory)
        if (!stat.isDirectory()) {
          console.warn(
            "[playground] %s exists but is not a directory, skipping seed",
            directory,
          )
          return null
        }
        return { directory, created: false }
      }
      await fsp.mkdir(directory, { recursive: true })
      return { directory, created: true }
    } catch (err) {
      console.warn(
        "[playground] failed to ensure playground directory at %s:",
        directory,
        err,
      )
      return null
    }
  }

  /**
   * Point the main window at the playground only if it's still on
   * the onboarding view (never overrides another choice).
   */
  private async pointMainWindowAtPlayground(
    workspaceId: string,
  ): Promise<void> {
    await this.ctx.db.client.update(root => {
      const ws = root.app.windowStates[MAIN_WINDOW_ID]
      if (ws && ws.activeView.kind !== "onboarding") return
      const fresh = ensureWindowState(root, MAIN_WINDOW_ID)
      if (fresh.activeView.kind !== "onboarding") return
      const scope = Object.values(root.app.scopes).find(
        s => s.workspaceId === workspaceId && !s.archived,
      )
      fresh.activeView = { kind: "workspace", workspaceId }
      if (scope) {
        fresh.selectedScopeId = scope.id
        fresh.workspaceActiveScope[workspaceId] = scope.id
      }
    })
  }
}

/** Inline mirror of the renderer's `ensureWindowState` (kept in
 * sync with the copy in `workspaces.ts`). */
function ensureWindowState(
  root: { app: { windowStates: Record<string, WindowState> } },
  windowId: string,
): WindowState {
  const existing = root.app.windowStates[windowId]
  if (existing) {
    if (!existing.scopeLastTerminal) existing.scopeLastTerminal = {}
    if (!existing.scopePanes) existing.scopePanes = {}
    if (!existing.workspaceActiveScope) existing.workspaceActiveScope = {}
    if (!existing.workspaceUiStates) existing.workspaceUiStates = {}
    if (!existing.scopeUiStates) existing.scopeUiStates = {}
    return existing
  }
  const fresh: WindowState = {
    selectedScopeId: null,
    scopeLastTerminal: {},
    activeView: { kind: "onboarding" },
    scopePanes: {},
    workspaceActiveScope: {},
    workspaceRailOpen: false,
    workspaceUiStates: {},
    scopeUiStates: {},
    pluginsView: { selectedPluginName: null, sidebarOpen: true },
    fullscreen: false,
  }
  root.app.windowStates[windowId] = fresh
  return fresh
}

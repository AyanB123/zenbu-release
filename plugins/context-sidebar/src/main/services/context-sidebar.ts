import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import { DbService, ViewRegistryService } from "@zenbujs/core/services";

const here = path.dirname(fileURLToPath(import.meta.url));
const VIEW_SOURCE = path.resolve(
  here,
  "../../views/context-sidebar-view.tsx",
);

const VIEW_TYPE = "context-sidebar";
const ADD_DIR_COMMAND_ID = "contextSidebar:add-dir";

/* ----------------------------- ambient deps ---------------------------- */

/**
 * Loosely-typed shape of the host's `SlashCommandsService` —
 * mirrors what `pi-commands` uses. We can't import the host's
 * type without coupling to its source tree, so we declare the
 * surface we depend on inline.
 */
type SlashRegistry = {
  register(spec: RegisteredSlashCommand): Promise<{ ok: true }>;
  unregister(args: { id: string }): Promise<{ ok: true }>;
};

type RegisteredSlashCommand = {
  id: string;
  name: string;
  label: string;
  description?: string | null;
  hint?: string | null;
  group?: string | null;
  source?: string | null;
  rpc: { plugin: string; service: string; method: string };
  args?: Record<string, unknown> | null;
  insertOnSelect?: boolean;
};

type DialogApi = {
  pickFolder(): Promise<
    { cancelled: true } | { cancelled: false; path: string }
  >;
};

/**
 * Result shape understood by the chat-pane's slash-command
 * dispatcher (see `chat-pane.tsx`). Kept narrow on purpose: only
 * the variants we actually emit.
 */
type CommandResult =
  | { kind: "none" }
  | {
      kind: "toast";
      tone?: "success" | "error" | "info";
      title: string;
      description?: string;
    };

type AddDirInvocation = {
  windowId?: string;
  chatId?: string | null;
  sessionId?: string | null;
  command: string;
  text?: string;
  argsText?: string;
};

/**
 * Right-sidebar service for the context-window visualizer plus
 * the per-scope "extra directories" list.
 *
 * Registers:
 *
 *  1. A single `rendering: "component"` view (`context-sidebar`),
 *     surfaced as a right-sidebar tab. The view renders the
 *     context-window grid, session stats, AND the extra-dirs list
 *     (formerly the `extra-dirs-sidebar` plugin).
 *
 *  2. A `/add-dir` slash command. Dispatched from the composer it
 *     opens the same native folder picker the sidebar's "Add dir
 *     to context" row uses, and appends the picked path to the
 *     active chat's scope `extraDirectories`. Identical to what
 *     happens when the user clicks the button in the sidebar.
 *
 * The view itself stays a pure React component sharing the host's
 * tree (theme, CSS, focus). Mutations go straight through
 * `useDbClient`; the slash command goes through this service so
 * the renderer-less command path can still trigger the picker.
 */
export class ContextSidebarService extends Service.create({
  key: "contextSidebar",
  deps: {
    db: DbService,
    viewRegistry: ViewRegistryService,
    slashCommands: "slashCommands",
    dialog: "dialog",
  },
}) {
  evaluate() {
    this.setup("register-view", () => {
      void this.ctx.viewRegistry.registerView({
        type: VIEW_TYPE,
        rendering: "component",
        source: { modulePath: VIEW_SOURCE },
        meta: {
          kind: "view",
          sidebar: true,
          label: "Context",
          // Default per-view shortcut picked up by
          // `SidebarViewShortcutsService`.
          shortcut: { mod: true, shift: true, key: "k" },
        },
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(VIEW_TYPE);
      };
    });

    this.setup("register-add-dir-slash-command", () => {
      const registry = this.ctx.slashCommands as SlashRegistry;
      void registry.register({
        id: ADD_DIR_COMMAND_ID,
        name: "add-dir",
        label: "add-dir",
        description: "Add a directory to this session's context",
        group: "Context",
        source: "contextSidebar",
        rpc: {
          plugin: "contextSidebar",
          service: "contextSidebar",
          method: "addDirectory",
        },
        args: null,
        insertOnSelect: false,
      });
      return () => {
        void registry.unregister({ id: ADD_DIR_COMMAND_ID });
      };
    });
  }

  /**
   * Slash-command entry point for `/add-dir`. Invoked by the
   * chat-pane's generic dispatcher with `{ chatId, sessionId,
   * windowId, ... }`. We resolve the chat's scope, pop the native
   * folder picker, and append the picked path to
   * `scope.extraDirectories` — exactly what the sidebar's "Add
   * dir to context" button does.
   */
  async addDirectory(args: AddDirInvocation): Promise<CommandResult> {
    const chatId = args.chatId ?? null;
    if (!chatId) {
      return {
        kind: "toast",
        tone: "error",
        title: "/add-dir needs an active chat",
      };
    }

    const root = this.ctx.db.client.readRoot();
    const chat = root.app.chats[chatId];
    const scopeId = chat?.scopeId ?? null;
    if (!scopeId) {
      return {
        kind: "toast",
        tone: "error",
        title: "/add-dir: chat has no scope",
      };
    }

    let picked: string;
    try {
      const result = await (this.ctx.dialog as DialogApi).pickFolder();
      if (result.cancelled) return { kind: "none" };
      picked = result.path;
    } catch (err) {
      return {
        kind: "toast",
        tone: "error",
        title: "/add-dir: folder picker failed",
        description: err instanceof Error ? err.message : String(err),
      };
    }

    let alreadyPresent = false;
    await this.ctx.db.client.update((draft) => {
      const scope = draft.app.scopes[scopeId];
      if (!scope) return;
      if (scope.extraDirectories.includes(picked)) {
        alreadyPresent = true;
        return;
      }
      if (scope.directory === picked) {
        alreadyPresent = true;
        return;
      }
      scope.extraDirectories = [...scope.extraDirectories, picked];
    });

    if (alreadyPresent) {
      return {
        kind: "toast",
        tone: "info",
        title: "Directory already in context",
        description: picked,
      };
    }
    return {
      kind: "toast",
      tone: "success",
      title: "Added directory to context",
      description: picked,
    };
  }
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import {
  RendererHostService,
  RpcService,
  ViewRegistryService,
} from "@zenbujs/core/services";

// TODO(cross-plugin-deps): zenbu's `deps:` accepts either a service
// class reference or a service key string. We use the string form
// here because the only alternative is importing the class through
// a deeply nested relative path into the host package, which couples
// this plugin's source layout to the host's. There is no first-class
// way to declare a typed dependency on another plugin's service yet;
// when zenbu grows one (the natural extension of `dependsOn` from
// renderer-only types to main-process service classes), replace
// `"piExtensionRegistry"` with the real class import and drop the
// `any` cast in `evaluate()`.

// Resolve paths inside this plugin so they survive both `zen dev`
// (source tree) and the staged source bundle produced by
// `zen build:source` (mirror tree). Both keep the same relative
// layout under the plugin package, so deriving from `import.meta.url`
// is stable.
const here = path.dirname(fileURLToPath(import.meta.url));
const PLAN_EXTENSION_PATH = path.resolve(here, "../../extension/index.ts");
const PLAN_VIEW_ROOT = path.resolve(here, "../../views/plan");
const PLAN_VIEW_CONFIG = path.resolve(PLAN_VIEW_ROOT, "vite.config.ts");

/**
 * Plan plugin service.
 *
 * Responsible for stitching this plugin into the host:
 *
 *  1. Registers `src/extension/index.ts` with the host's
 *     `PiExtensionRegistryService`. The host's `SessionsService`
 *     reads the registry on every `activate()` and forwards the
 *     paths to Pi's `DefaultResourceLoader.additionalExtensionPaths`,
 *     so the `plan` tool becomes available to the LLM.
 *
 *  2. Registers the `plan` view — a standalone vite-served React
 *     tree that renders the Markdown payload via Streamdown
 *     (mermaid diagrams handled natively by Streamdown).
 *
 *  3. Installs around-advice on the host's `ToolCall` chat-message
 *     component. The advice short-circuits when `toolName === "plan"`
 *     and renders an "Open Plan" card with an onClick that calls
 *     `openInActivePane` on this service.
 *
 *  4. Exposes `openInActivePane({ toolCallId, title, markdown })`
 *     as the RPC the advice card calls. The implementation emits
 *     the host's generic `openViewInActivePane` event, which the
 *     shell catches and routes to `openViewBySourceInRoot`. The
 *     host never learns about `"plan"` as a view type — it just
 *     forwards the strings.
 *
 * Hot reload semantics:
 *  - Each `setup()` block pairs registration with cleanup, so a
 *    plugin reload cleanly unregisters and re-registers all four.
 *  - The Pi extension registration is reflected in
 *    `root.app.piExtensions` so a future marketplace UI can list
 *    installed extensions via `useDb`.
 *  - Already-running sessions ignore the registry change; the user
 *    has to start or switch sessions to pick up changes.
 */
export class PlanService extends Service.create({
  key: "plan",
  deps: {
    // String-keyed dep on the host's PiExtensionRegistryService.
    // See the TODO above for why this isn't a class import.
    piExtensionRegistry: "piExtensionRegistry",
    viewRegistry: ViewRegistryService,
    rpc: RpcService,
    // Order-only: registering a view that should be reachable from
    // the host renderer needs the renderer host alive first.
    rendererHost: RendererHostService,
  },
}) {
  evaluate() {
    // 1. Contribute the Pi extension to the registry.
    this.setup("register-pi-extension", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registry = this.ctx.piExtensionRegistry as any;
      void registry.register({
        id: "plan",
        path: PLAN_EXTENSION_PATH,
        meta: { label: "Plan", pluginName: "plan" },
      });
      return () => {
        void registry.unregister({ id: "plan" });
      };
    });

    // 2. Register the split-pane Markdown viewer. The vite config in
    // the view root pulls in Tailwind + the React plugin so Streamdown's
    // utility classes and shadcn design tokens render correctly inside
    // the standalone iframe.
    this.setup("register-view", () => {
      void this.ctx.viewRegistry.register({
        type: "plan",
        root: PLAN_VIEW_ROOT,
        configFile: PLAN_VIEW_CONFIG,
        // `kind: "embed"` keeps the view out of the command palette
        // (it requires args to be meaningful); other code reaches it
        // via the generic `openViewInActivePane` event.
        meta: { kind: "embed", label: "Plan" },
      });
      return () => {
        void this.ctx.viewRegistry.unregister("plan");
      };
    });

    // 3. Replace host's `ToolCall` chat component for plan tool calls.
    // `moduleId` must be the full path the host renderer registers
    // under (i.e. relative to the host's vite root,
    // `packages/app/src/renderer/`). Short suffixes silently do not
    // match — the advice runtime now emits a `console.error`
    // pointing at the right value when it detects a mismatch.
    this.setup("advise-tool-call", () =>
      this.advise({
        view: "*",
        moduleId: "components/chat/messages/tool-call.tsx",
        name: "ToolCall",
        type: "around",
        modulePath: "src/content/plan-tool-advice.tsx",
        exportName: "PlanToolAdvice",
      }),
    );
  }

  /**
   * Called from the chat advice when the user clicks "Open Plan".
   * Fires the host's generic `openViewInActivePane` event. The host
   * shell catches it and opens the `plan` view in a pane next to
   * the active one, reusing the existing tab for the same plan
   * tool call if one is already open (via the `source` sentinel).
   */
  async openInActivePane(args: {
    toolCallId: string;
    title: string;
    markdown: string;
  }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.app.openViewInActivePane({
      viewType: "plan",
      source: `plan-${args.toolCallId}`,
      args: {
        toolCallId: args.toolCallId,
        title: args.title,
        markdown: args.markdown,
      },
    });
    return { ok: true };
  }
}

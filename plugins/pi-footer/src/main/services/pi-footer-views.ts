import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import { ViewRegistryService } from "@zenbujs/core/services";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCOPE_INFO_SOURCE = path.resolve(
  here,
  "../../views/items/scope-info.tsx",
);
const CHAT_STATS_SOURCE = path.resolve(
  here,
  "../../views/items/chat-stats.tsx",
);

const SCOPE_INFO_VIEW = "pi-footer.scope-info";
const CHAT_STATS_VIEW = "pi-footer.chat-stats";

/**
 * Registers the two built-in items this plugin contributes to the
 * host's footer (`PiFooter`, in `plugins/app/src/renderer/components/pi-footer/`).
 *
 * Both items are plain component views; the host's discovery hook
 * (`useFooterItems`) picks them up by their `meta.kind`. Position
 * (`left` / `right`) and `order` are conventional meta fields,
 * mirroring how `meta.kind = "workspace-rail"` items declare order
 * for the rail.
 *
 * The footer chrome itself is host-owned (same as the workspace
 * rail and the left sidebar) — this plugin doesn't register a
 * container view.
 */
export class PiFooterViewsService extends Service.create({
  key: "piFooterViews",
  deps: { viewRegistry: ViewRegistryService },
}) {
  evaluate() {
    this.setup("register-scope-info", () => {
      void this.ctx.viewRegistry.registerView({
        type: SCOPE_INFO_VIEW,
        rendering: "component",
        source: { modulePath: SCOPE_INFO_SOURCE },
        meta: {
          kind: "pi-footer.item",
          label: "Scope info",
          position: "left",
          order: 10,
        },
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(SCOPE_INFO_VIEW);
      };
    });

    this.setup("register-chat-stats", () => {
      void this.ctx.viewRegistry.registerView({
        type: CHAT_STATS_VIEW,
        rendering: "component",
        source: { modulePath: CHAT_STATS_SOURCE },
        meta: {
          kind: "pi-footer.item",
          label: "Chat stats",
          position: "left",
          order: 20,
        },
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(CHAT_STATS_VIEW);
      };
    });
  }
}

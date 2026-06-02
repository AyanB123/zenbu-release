import { Service } from "@zenbujs/core/runtime";

const SCOPE_INFO = "pi-footer/scope-info";
const CHAT_STATS = "pi-footer/chat-stats";

/**
 * The two built-in items this plugin contributes to the host's
 * footer strip (`PiFooter`).
 *
 * Both items are plain injections tagged `meta.kind: "footer.item"`;
 * the host's discovery hook (`useFooterItems`) picks them up.
 * Position (`left` / `right`) and `order` are conventional meta
 * fields.
 *
 * The footer chrome itself is host-owned — this plugin only ships
 * the items.
 */
export class PiFooterViewsService extends Service.create({
  key: "piFooterViews",
}) {
  evaluate() {
    this.setup("inject-scope-info", () =>
      this.inject({
        name: SCOPE_INFO,
        modulePath: "./src/views/items/scope-info.tsx",
        meta: {
          kind: "footer.item",
          label: "Scope info",
          position: "left",
          order: 10,
        },
      }),
    );

    this.setup("inject-chat-stats", () =>
      this.inject({
        name: CHAT_STATS,
        modulePath: "./src/views/items/chat-stats.tsx",
        meta: {
          kind: "footer.item",
          label: "Chat stats",
          position: "left",
          order: 20,
        },
      }),
    );
  }
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import { ViewRegistryService } from "@zenbujs/core/services";

const here = path.dirname(fileURLToPath(import.meta.url));
const VIEW_SOURCE = path.resolve(
  here,
  "../../views/terminal-view.tsx",
);

const VIEW_TYPE = "terminal";

/**
 * Registers the terminal bottom-panel view as a component view.
 *
 * Replaces the iframe-mode `terminal` registration the host's
 * `TerminalService` used to own. The pty + DB pipeline still lives
 * in the host; this plugin just surfaces it as an isolated UI
 * contribution discovered through `meta.bottomPanel = true`.
 */
export class TerminalViewService extends Service.create({
  key: "terminalView",
  deps: { viewRegistry: ViewRegistryService },
}) {
  evaluate() {
    this.setup("register-view", () => {
      void this.ctx.viewRegistry.registerView({
        type: VIEW_TYPE,
        rendering: "component",
        source: { modulePath: VIEW_SOURCE },
        meta: { kind: "view", bottomPanel: true, label: "Terminal" },
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(VIEW_TYPE);
      };
    });
  }
}

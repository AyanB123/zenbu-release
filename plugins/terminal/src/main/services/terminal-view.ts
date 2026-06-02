import { Service } from "@zenbujs/core/runtime";

/**
 * Terminal bottom-panel view.
 *
 * The pty + DB pipeline still lives in the host's
 * `TerminalService`; this plugin just surfaces it via
 * `meta.kind = "bottom-panel"` so `useBottomPanelViews` picks it
 * up.
 */
export class TerminalViewService extends Service.create({
  key: "terminalView",
}) {
  evaluate() {
    this.setup("inject-view", () =>
      this.inject({
        name: "terminal",
        modulePath: "./src/views/terminal-view.tsx",
        meta: { kind: "bottom-panel", label: "Terminal" },
      }),
    );
  }
}

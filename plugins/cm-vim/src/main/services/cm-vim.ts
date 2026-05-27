import { Service } from "@zenbujs/core/runtime";

/**
 * cm-vim service.
 *
 * Injects a single content script into every view; the script mounts
 * a hidden React root that:
 *
 *   1. Watches `db.app.settings.vimMode` and (un)registers the vim
 *      CodeMirror extension under `meta.kind = "cm.composer-extension"`.
 *
 *   2. Registers the `VimModeStatusItem` React component under
 *      `meta.kind = "status-bar.right-item"`, which the host's
 *      `AppStatusBar` renders in its right slot.
 *
 * No advice, no schema. The two registry kinds are the only seams.
 */
export class CmVimService extends Service.create({
  key: "cm-vim",
}) {
  evaluate() {
    this.setup("inject-register-vim", () =>
      this.injectContentScript({
        view: "*",
        modulePath: "src/content/register-vim.tsx",
      }),
    );
  }
}

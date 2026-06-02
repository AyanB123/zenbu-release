import { Service } from "@zenbujs/core/runtime";

/**
 * cm-vim service.
 *
 * Injects one bootstrap module into the host renderer. The module
 * mounts a hidden React root that:
 *
 *   1. Watches `db.app.settings.vimMode` and (un)registers the vim
 *      CodeMirror extension under
 *      `meta.kind = "cm.composer-extension-editable"`.
 *
 *   2. Registers the `VimModeStatusItem` React component under
 *      `meta.kind = "footer.item"` with `position: "right"`, which
 *      the `pi-footer` plugin's container renders in the right slot
 *      of the chat-pane footer strip.
 *
 * No advice, no schema. The two `meta.kind` values are the only seams.
 */
export class CmVimService extends Service.create({
  key: "cm-vim",
}) {
  evaluate() {
    this.setup("inject-register-vim", () =>
      this.inject({
        name: "cm-vim/bootstrap",
        modulePath: "./src/content/register-vim.tsx",
      }),
    );
  }
}

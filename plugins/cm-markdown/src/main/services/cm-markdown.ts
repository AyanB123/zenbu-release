import { Service } from "@zenbujs/core/runtime";

const INJECTION_NAME = "cm-markdown/live-preview";

/**
 * Ships the markdown live-preview CodeMirror extension under the
 * `cm.markdown-extension` slot. Any markdown editing surface
 * (the composer, the standalone MarkdownEditor) consumes that
 * slot, so disabling this plugin drops live-preview everywhere
 * with no host edits.
 */
export class CmMarkdownService extends Service.create({
  key: "cm-markdown",
}) {
  evaluate() {
    this.setup("inject-markdown-extension", () =>
      this.inject({
        name: INJECTION_NAME,
        modulePath: "./src/extension/index.ts",
        meta: {
          kind: "cm.markdown-extension",
          label: "Markdown live-preview",
        },
      }),
    );
  }
}

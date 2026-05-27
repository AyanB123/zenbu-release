import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import { FunctionRegistryService } from "@zenbujs/core/services";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_SOURCE = path.resolve(
  here,
  "../../extension/index.ts",
);

const FUNCTION_NAME = "cm-markdown.live-preview";

/**
 * cm-markdown service.
 *
 * Registers the markdown live-preview CodeMirror extension into the
 * function registry under `meta.kind = "cm.composer-extension"`. The
 * host composer reads the registry directly and merges every such
 * contribution into its compartment.
 *
 * No advice, no schema, no state — the entire plugin is "ship one
 * extension". Disabling the plugin removes the live-preview behavior
 * with zero edits to the host.
 */
export class CmMarkdownService extends Service.create({
  key: "cm-markdown",
  deps: {
    functionRegistry: FunctionRegistryService,
  },
}) {
  evaluate() {
    this.setup("register-markdown-extension", () => {
      this.ctx.functionRegistry.register({
        name: FUNCTION_NAME,
        modulePath: EXTENSION_SOURCE,
        meta: {
          kind: "cm.composer-extension",
          label: "Markdown live-preview",
        },
      });
      return () => {
        this.ctx.functionRegistry.unregister(FUNCTION_NAME);
      };
    });
  }
}

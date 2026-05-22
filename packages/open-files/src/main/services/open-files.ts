import { Service } from "@zenbujs/core/runtime";

/**
 * Open-files plugin service.
 *
 * The only job of this service is to install around-advice on the
 * host's `ToolCall` chat-message component. The advice itself
 * (`src/content/file-tool-advice.tsx`) handles the click → "open
 * file in new pane" plumbing entirely in the renderer by calling
 * the host's existing `rpc.app.fileTree.openFile`, so this service
 * has no RPC methods of its own.
 *
 * Hot reload semantics: `this.advise(...)` returns an unregister
 * function; pairing it with `setup()` means a plugin reload cleanly
 * unhooks the advice and re-installs the new one without leaving a
 * stale wrapper attached to the host component.
 */
export class OpenFilesService extends Service.create({
  key: "openFiles",
}) {
  evaluate() {
    this.setup("advise-tool-call", () =>
      this.advise({
        view: "*",
        // Must match the path the host renderer registers the
        // module under (relative to its vite root,
        // `packages/app/src/renderer/`). The advice runtime emits
        // a `console.error` pointing at the right value if this
        // ever drifts — keep this in sync with the plan plugin.
        moduleId: "components/chat/messages/tool-call.tsx",
        name: "ToolCall",
        type: "around",
        modulePath: "src/content/file-tool-advice.tsx",
        exportName: "FileToolAdvice",
      }),
    );
  }
}

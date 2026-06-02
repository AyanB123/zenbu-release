import type { ExtensionFactory } from "@earendil-works/pi-coding-agent"
import { createBashTimeoutExtension } from "./bash-timeout"
import { createZenbuHouseRulesExtension } from "./zenbu-house-rules"

/**
 * Built-in Pi extensions loaded through the SDK's in-memory
 * `DefaultResourceLoader.extensionFactories` hook.
 *
 * Convention: app-owned Pi extensions live in this directory as
 * normal TypeScript modules, expose a `createXExtension(cwd)` helper,
 * and get added here. Closing over the session cwd is important:
 * the app process cwd is not necessarily the active project scope.
 *
 * Use plugin path registration only for external plugin packages whose
 * extension source lives outside the app.
 */
export function createAppPiExtensionFactories(cwd: string): readonly ExtensionFactory[] {
  return [createBashTimeoutExtension(cwd), createZenbuHouseRulesExtension(cwd)]
}

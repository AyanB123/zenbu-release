import { createSchema, z } from "@zenbujs/core/db"

/**
 * pi-commands plugin schema.
 *
 * Owns the "active panel per composer" state that used to live in
 * `chat-pane`'s React state and ride down on Composer props. Moving
 * it into our own db section means:
 *
 *   - Slash-command RPC handlers can drop a panel for a composer
 *     without returning a special result kind through chat-pane.
 *   - The composer-input advice reads its own state directly via
 *     `useDb(root => root.piCommands.panels[composerId])` — no
 *     prop ferrying.
 *   - The host composer surface loses two opaque props
 *     (`piCommandPanel`, `onPiCommandPanelClose`).
 *
 * Panel state is keyed by `composerId` (= chat.id for the main
 * composer). It's intentionally persisted: if you reload the app
 * mid-`/tree`, you come back to the same panel.
 */

const InfoPanel = z.object({
  kind: z.literal("info"),
  title: z.string(),
  lines: z.array(z.string()),
})

const TreePanel = z.object({
  kind: z.literal("tree"),
  sessionId: z.string(),
  windowId: z.string(),
})

const ForkPanel = z.object({
  kind: z.literal("fork"),
  sessionId: z.string(),
  windowId: z.string(),
})

export const PiCommandPanel = z.discriminatedUnion("kind", [
  InfoPanel,
  TreePanel,
  ForkPanel,
])

export type PiCommandPanel = z.infer<typeof PiCommandPanel>

export default createSchema({
  panels: z.record(z.string(), PiCommandPanel).default({}),
})

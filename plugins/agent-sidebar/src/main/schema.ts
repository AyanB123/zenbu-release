import { createSchema, z } from "@zenbujs/core/db";

/**
 * Worktree-group collapse state, keyed by `windowId` then by
 * `scopeId`. A `true` value means the group is collapsed
 * (children hidden). Missing entries = expanded.
 *
 * Per-window so toggling a group in one window doesn't affect the
 * others. Previously lived under `app.windowStates[id].worktreeGroupCollapsed`;
 * moved here because every consumer is sidebar-specific (the
 * chat-list groups and the sidebar's keyboard nav).
 */
const worktreeGroupCollapsedByWindow = z.record(
  z.string(),
  z.record(z.string(), z.boolean()),
);

export default createSchema({
  worktreeGroupCollapsed: worktreeGroupCollapsedByWindow.default({}),
});

import { createSchema, z } from "@zenbujs/core/db";

/**
 * Sort order for the chat list. Persisted globally (not per
 * window) because it's a user preference, not a layout choice.
 *
 *  - `"created"`: chats ordered by creation time, newest first.
 *    This is the historical default and matches the order users
 *    see while typing into a brand-new chat.
 *  - `"lastMessage"`: chats ordered by their most recent message
 *    timestamp. Useful when a few long-running chats are getting
 *    most of the activity.
 */
const chatSort = z.enum(["created", "lastMessage"]);

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
  chatSort: chatSort.default("created"),
  worktreeGroupCollapsed: worktreeGroupCollapsedByWindow.default({}),
});

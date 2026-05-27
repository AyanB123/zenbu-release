type MigrationOp =
  | { op: "add"; key: string; kind: "data"; hasDefault: boolean; default?: any }
  | { op: "add"; key: string; kind: "collection"; debugName?: string }
  | { op: "add"; key: string; kind: "blob"; debugName?: string }
  | { op: "remove"; key: string; kind: "collection" | "blob" | "data" }
  | { op: "alter"; key: string; changes: Record<string, any> };

type KyjuMigration = {
  version: number;
  operations?: MigrationOp[];
  migrate?: (prev: any, ctx: { apply: (data: any) => any }) => any;
};

const migration: KyjuMigration = {
  version: 37,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "89215dae5f416d8c",
          "to": "5a75bc53dbd2f066"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Seed per-tab navigation history for every existing pane tab.
    // Each tab's current `content` becomes the single (and currently
    // visible) entry in its new `history` stack, so back/forward have
    // a defined starting point and the invariant
    // `history.entries[history.index] === content` holds for legacy
    // rows. `apply()` above already widened the `windowStates` type
    // hash; we just fill the new field in-place.
    const windowStates = (result.windowStates as Record<string, any> | undefined) ?? {}
    for (const ws of Object.values(windowStates)) {
      const scopePanes = (ws?.scopePanes as Record<string, any> | undefined) ?? {}
      for (const scopeState of Object.values(scopePanes)) {
        const panes: any[] = Array.isArray(scopeState?.panes) ? scopeState.panes : []
        for (const pane of panes) {
          const tabs: any[] = Array.isArray(pane?.tabs) ? pane.tabs : []
          for (const tab of tabs) {
            if (!tab) continue
            if (tab.history && Array.isArray(tab.history.entries) && typeof tab.history.index === "number") continue
            // Deep-clone the content into the history so future
            // navigations don't accidentally alias the live
            // `tab.content` proxy.
            tab.history = {
              entries: [JSON.parse(JSON.stringify(tab.content))],
              index: 0,
            }
          }
        }
      }
    }
    return result
  },
}

export default migration

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
  version: 68,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "9bcf5607cddb0fbe",
          "to": "98041587a01bc7fa"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Drop the now-removed per-tab `history` field. We don't keep
    // any forward/back state — each tab just holds its current
    // `content`.
    const windowStates = (result.windowStates as Record<string, any> | undefined) ?? {}
    for (const ws of Object.values(windowStates)) {
      const scopePanes = (ws?.scopePanes as Record<string, any> | undefined) ?? {}
      for (const scopeState of Object.values(scopePanes)) {
        const panes: any[] = Array.isArray(scopeState?.panes) ? scopeState.panes : []
        for (const pane of panes) {
          const tabs: any[] = Array.isArray(pane?.tabs) ? pane.tabs : []
          for (const tab of tabs) {
            if (tab && "history" in tab) delete tab.history
          }
        }
      }
    }
    return result
  },
}

export default migration

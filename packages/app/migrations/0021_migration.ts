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
  version: 22,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "fb5e37c1b741aece",
          "to": "b3409bfed4cd2d3b"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // paneTab gained a discriminated `content` field. Convert old
    // `{ id, chatId }` rows into `{ id, content: { kind: "chat", chatId } }`.
    const windowStates = result.windowStates as Record<string, any> | undefined
    if (windowStates) {
      for (const ws of Object.values(windowStates)) {
        const scopePanes = (ws as any).scopePanes as
          | Record<string, any>
          | undefined
        if (!scopePanes) continue
        for (const state of Object.values(scopePanes)) {
          const panes = (state as any).panes as any[] | undefined
          if (!panes) continue
          for (const pane of panes) {
            const tabs = pane.tabs as any[] | undefined
            if (!tabs) continue
            pane.tabs = tabs.map(t => {
              if (t && typeof t === "object" && "content" in t) return t
              return {
                id: t.id,
                content: { kind: "chat", chatId: t.chatId ?? null },
              }
            })
          }
        }
      }
    }
    return result
  },
}

export default migration

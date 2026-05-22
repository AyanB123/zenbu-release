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
  version: 25,
  operations: [
    {
      "op": "alter",
      "key": "chatStates",
      "changes": {
        "typeHash": {
          "from": "b7324ba209efd566",
          "to": "1435d8954a9470c5"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill `draft` on existing chatStates entries so the persisted
    // composer input field is always a string.
    const chatStates = result.chatStates as Record<string, any> | undefined
    if (chatStates) {
      for (const id of Object.keys(chatStates)) {
        const cs = chatStates[id]
        if (!cs) continue
        if (typeof cs.draft !== "string") cs.draft = ""
      }
    }
    return result
  },
}

export default migration

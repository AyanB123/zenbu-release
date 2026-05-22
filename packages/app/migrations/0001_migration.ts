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
  version: 2,
  operations: [
    {
      "op": "alter",
      "key": "settings",
      "changes": {
        "typeHash": {
          "from": "76d5e60b9ea80fb6",
          "to": "6c58a9643de640f0"
        },
        "default": {
          "from": {
            "theme": "system"
          },
          "to": {
            "theme": "system",
            "chatBackground": null
          }
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    if (result.settings && typeof result.settings === "object") {
      if (!("chatBackground" in result.settings)) {
        result.settings.chatBackground = null
      }
    }
    return result
  },
}

export default migration

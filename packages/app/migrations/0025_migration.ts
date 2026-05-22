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
  version: 26,
  operations: [
    {
      "op": "add",
      "key": "sessionMeta",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "alter",
      "key": "settings",
      "changes": {
        "typeHash": {
          "from": "1a9eaafcc4e84227",
          "to": "6381e7bc8e19d60e"
        },
        "default": {
          "from": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true
          },
          "to": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "sidebarChatSort": "created"
          }
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill sidebarChatSort on existing settings rows so the
    // sidebar always has a valid sort key (sessionMeta itself
    // defaults to {} via the `add` op above).
    if (result.settings && typeof result.settings === "object") {
      if (typeof result.settings.sidebarChatSort !== "string") {
        result.settings.sidebarChatSort = "created"
      }
    }
    return result
  },
}

export default migration

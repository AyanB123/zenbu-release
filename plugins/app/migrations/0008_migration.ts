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
  version: 9,
  operations: [
    {
      "op": "alter",
      "key": "settings",
      "changes": {
        "typeHash": {
          "from": "6c58a9643de640f0",
          "to": "1a9eaafcc4e84227"
        },
        "default": {
          "from": {
            "theme": "system",
            "chatBackground": null
          },
          "to": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true
          }
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    if (result.settings && typeof result.settings === "object" && !("vimMode" in result.settings)) {
      result.settings.vimMode = true
    }
    return result
  },
}

export default migration

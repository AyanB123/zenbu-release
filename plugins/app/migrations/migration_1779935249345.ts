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
  version: 77,
  operations: [
    {
      "op": "alter",
      "key": "settings",
      "changes": {
        "typeHash": {
          "from": "9a8fd8e3a33892f1",
          "to": "71145a5536a1129c"
        },
        "default": {
          "from": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "defaultSendMode": "followUp"
          },
          "to": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "defaultSendMode": "followUp",
            "chatDevtools": false
          }
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    if (result.settings && typeof result.settings === "object") {
      if (result.settings.disableTelemetry === undefined) {
        result.settings.disableTelemetry = false
      }
    }
    return result
  },
}

export default migration

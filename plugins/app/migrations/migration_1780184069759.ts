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
  version: 78,
  operations: [
    {
      "op": "alter",
      "key": "workspaces",
      "changes": {
        "typeHash": {
          "from": "f7089c97ed9f7294",
          "to": "d2ea7ae579fed4ec"
        }
      }
    },
    {
      "op": "alter",
      "key": "settings",
      "changes": {
        "default": {
          "from": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "defaultSendMode": "followUp",
            "chatDevtools": false
          },
          "to": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "defaultSendMode": "followUp",
            "chatDevtools": false,
            "disableTelemetry": false
          }
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill the new `playground` boolean onto existing
    // workspace rows. They were all created before the
    // playground concept existed, so none of them are the
    // playground.
    if (result.workspaces && typeof result.workspaces === "object") {
      for (const ws of Object.values(result.workspaces) as Array<
        Record<string, unknown>
      >) {
        if (ws && ws.playground === undefined) ws.playground = false
      }
    }
    return result
  },
}

export default migration

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
  version: 67,
  operations: [
    {
      "op": "remove",
      "key": "playConfigs",
      "kind": "data"
    },
    {
      "op": "remove",
      "key": "openInApps",
      "kind": "data"
    },
    {
      "op": "alter",
      "key": "settings",
      "changes": {
        "typeHash": {
          "from": "893df100986688bd",
          "to": "1fd645ea78aaccda"
        },
        "default": {
          "from": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "sidebarChatSort": "created",
            "defaultSendMode": "followUp",
            "defaultOpenInBundlePath": null,
            "finderDefaultMigrated": false
          },
          "to": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "sidebarChatSort": "created",
            "defaultSendMode": "followUp"
          }
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // customize transformation here
    return result
  },
}

export default migration

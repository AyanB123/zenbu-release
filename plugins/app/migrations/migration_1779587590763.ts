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
  version: 55,
  operations: [
    {
      "op": "alter",
      "key": "settings",
      "changes": {
        "typeHash": {
          "from": "d3dfb92299e333dd",
          "to": "893df100986688bd"
        },
        "default": {
          "from": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "sidebarChatSort": "created",
            "defaultSendMode": "followUp",
            "defaultOpenInBundlePath": null
          },
          "to": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "sidebarChatSort": "created",
            "defaultSendMode": "followUp",
            "defaultOpenInBundlePath": null,
            "finderDefaultMigrated": false
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

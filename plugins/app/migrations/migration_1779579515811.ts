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
  version: 54,
  operations: [
    {
      "op": "add",
      "key": "openInApps",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "alter",
      "key": "settings",
      "changes": {
        "typeHash": {
          "from": "1fd645ea78aaccda",
          "to": "d3dfb92299e333dd"
        },
        "default": {
          "from": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "sidebarChatSort": "created",
            "defaultSendMode": "followUp"
          },
          "to": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "sidebarChatSort": "created",
            "defaultSendMode": "followUp",
            "defaultOpenInBundlePath": null
          }
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Populate the new `defaultOpenInBundlePath` on existing
    // settings objects. `apply` only patches keys it knows about;
    // for an object-typed field whose default changed, we need to
    // copy the new key over by hand so older DBs end up with the
    // null sentinel instead of `undefined`.
    if (result.settings && result.settings.defaultOpenInBundlePath === undefined) {
      result.settings.defaultOpenInBundlePath = null
    }
    return result
  },
}

export default migration

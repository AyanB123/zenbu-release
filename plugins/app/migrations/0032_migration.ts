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
  version: 33,
  operations: [
    {
      "op": "alter",
      "key": "settings",
      "changes": {
        "typeHash": {
          "from": "6381e7bc8e19d60e",
          "to": "1fd645ea78aaccda"
        },
        "default": {
          "from": {
            "theme": "system",
            "chatBackground": null,
            "vimMode": true,
            "sidebarChatSort": "created"
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
    // Backfill the new field on existing settings objects.
    if (result.settings && result.settings.defaultSendMode === undefined) {
      result.settings.defaultSendMode = "followUp"
    }
    return result
  },
}

export default migration

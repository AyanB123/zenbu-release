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
      "op": "add",
      "key": "registry",
      "kind": "data",
      "hasDefault": true,
      "default": {
        "sections": {},
        "items": {}
      }
    },
    {
      "op": "alter",
      "key": "ui",
      "changes": {
        "typeHash": {
          "from": "44429e4c1eb150cc",
          "to": "8c002cd4729d613a"
        },
        "default": {
          "from": {
            "lastTab": "general"
          },
          "to": {
            "lastTab": "general",
            "lastPluginsSectionId": null
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

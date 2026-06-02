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
  version: 1,
  operations: [
    {
      "op": "add",
      "key": "index",
      "kind": "data",
      "hasDefault": true,
      "default": {
        "projects": {
          "collectionId": "",
          "debugName": "open-projects"
        },
        "status": "idle",
        "count": 0,
        "indexedAt": 0,
        "truncated": false,
        "error": null
      }
    }
  ],
}

export default migration

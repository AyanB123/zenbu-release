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
  version: 70,
  operations: [
    {
      "op": "add",
      "key": "plugins",
      "kind": "data",
      "hasDefault": true,
      "default": []
    },
    {
      "op": "add",
      "key": "pluginIcons",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "alter",
      "key": "workspaces",
      "changes": {
        "typeHash": {
          "from": "bcfdf59600a4d3b1",
          "to": "615617315f33bb4e"
        }
      }
    },
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "86784bea4990acea",
          "to": "a1ed7fdba0439e6e"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill `workspace.kind` from the deprecated
    // `workspace.sentinel` flag. The schema default for `kind`
    // is `"default"`, so this only flips the rows that used to
    // carry `sentinel: true` (i.e. the self-edit workspace).
    // `sentinel` itself is kept around for now so the rest of
    // the code that still reads it doesn't break; a follow-up
    // sweep will replace those reads and a later migration
    // can drop the field.
    const workspaces = result?.workspaces
    if (workspaces && typeof workspaces === "object") {
      for (const id of Object.keys(workspaces)) {
        const w = workspaces[id]
        if (w && w.sentinel === true && w.kind !== "plugin") {
          w.kind = "plugin"
        }
      }
    }
    return result
  },
}

export default migration

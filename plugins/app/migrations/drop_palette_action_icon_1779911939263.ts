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
  version: 74,
  operations: [
    {
      "op": "alter",
      "key": "paletteActions",
      "changes": {
        "typeHash": {
          "from": "5478c5f878ebb592",
          "to": "2910182cd0aa9e8a"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    // Drop the `icon` field from every previously-registered palette
    // action. The registry is fully rewritten on every service start
    // (`PaletteActionsService.evaluate` wipes `paletteActions = {}`),
    // so practically the data we strip here only sticks around for
    // the one snapshot between schema bump and the first re-register.
    // Still: leaving phantom keys around would mean the snapshot's
    // typeHash and the live schema disagree about row shape, which
    // kyju rightly refuses to validate. So we strip explicitly.
    const result = apply(prev)
    const actions = result?.paletteActions
    if (actions && typeof actions === "object") {
      for (const id of Object.keys(actions)) {
        const a = actions[id]
        if (a && typeof a === "object" && "icon" in a) {
          delete a.icon
        }
      }
    }
    return result
  },
}

export default migration

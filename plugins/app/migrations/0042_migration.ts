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
  version: 43,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "ffd58cee6dfa96d5",
          "to": "505b402aded2ba51"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Replaces the old `selectedWorkspaceId` field with a
    // discriminated `activeView` so the workspace id only exists
    // when the workspace view is actually showing. Pre-existing
    // window states either had a real selectedWorkspaceId (-> a
    // `workspace` view) or null (-> onboarding).
    const windowStates = result.windowStates as
      | Record<string, any>
      | undefined
    if (windowStates) {
      for (const ws of Object.values(windowStates)) {
        const prevId = (ws as any).selectedWorkspaceId
        if (typeof prevId === "string" && prevId.length > 0) {
          ;(ws as any).activeView = {
            kind: "workspace",
            workspaceId: prevId,
          }
        } else {
          ;(ws as any).activeView = { kind: "onboarding" }
        }
        delete (ws as any).selectedWorkspaceId
      }
    }
    return result
  },
}

export default migration

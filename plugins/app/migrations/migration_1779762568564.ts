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
  version: 69,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "98041587a01bc7fa",
          "to": "86784bea4990acea"
        }
      }
    },
    {
      "op": "alter",
      "key": "settings",
      "changes": {
        "typeHash": {
          "from": "1fd645ea78aaccda",
          "to": "54926a412095d72b"
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
            "defaultSendMode": "followUp"
          }
        }
      }
    }
  ],
  // Sidebar UI state moved to the `agentSidebar` plugin's schema
  // (`root.agentSidebar.chatSort`, `root.agentSidebar.worktreeGroupCollapsed`).
  // Existing values are dropped: chat sort + group collapse are pure
  // UI prefs, so users land on the defaults after upgrade rather
  // than us threading the data across plugin namespaces (which the
  // migration runtime doesn't support).
  migrate(prev, { apply }) {
    const result = apply(prev)
    if (result.settings && "sidebarChatSort" in result.settings) {
      delete result.settings.sidebarChatSort
    }
    for (const ws of Object.values(result.windowStates ?? {}) as any[]) {
      if (ws && "worktreeGroupCollapsed" in ws) {
        delete ws.worktreeGroupCollapsed
      }
    }
    return result
  },
}

export default migration

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
  version: 3,
  operations: [
    {
      "op": "add",
      "key": "repos",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "add",
      "key": "workspaces",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "add",
      "key": "workspaceStates",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "add",
      "key": "workspaceItems",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "add",
      "key": "workspaceItemStates",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "add",
      "key": "chats",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "add",
      "key": "chatStates",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "remove",
      "key": "projects",
      "kind": "data"
    },
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "b3c451cc405d78e0",
          "to": "cacdc7d8e35e5f44"
        }
      }
    },
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "f6d63f209f367bef",
          "to": "ab5cc63f28db09c1"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    result.sessions = {}
    result.windowStates = {}
    return result
  },
}

export default migration

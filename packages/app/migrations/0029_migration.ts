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
  version: 30,
  operations: [
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "a100a91bd66110a7",
          "to": "8413009331040996"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Drop the flat `streaming` buffer from every session. The event
    // log now carries every pi event (including `message_update`
    // deltas + `partial: AssistantMessage`), so the in-progress
    // assistant message is materialized from events directly instead
    // of from this side-buffer.
    const sessions = result.sessions ?? {}
    for (const id of Object.keys(sessions)) {
      const s = sessions[id]
      if (s && "streaming" in s) delete s.streaming
    }
    return result
  },
}

export default migration

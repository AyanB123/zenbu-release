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
  version: 36,
  operations: [
    {
      "op": "remove",
      "key": "summaries",
      "kind": "data"
    },
    {
      "op": "alter",
      "key": "sessionMeta",
      "changes": {
        "typeHash": {
          "from": "e76bb804effa53e9",
          "to": "52998134722c6aa1"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Two shape changes in one step:
    //   1. `summaries` (per-session AI title cache from 0034) is
    //      gone. Its data folds into `sessionMeta[sessionId].summary`.
    //   2. `sessionMeta` used to be `{ lastPromptAt }`; it's now
    //      `{ sessionId, summary, lastMessageSentTime }`.
    // `apply()` already cleared `sessionMeta` because the type hash
    // changed, so we rebuild it from `prev`.
    const oldSummaries = (prev.summaries as Record<string, any> | undefined) ?? {}
    const oldMeta = (prev.sessionMeta as Record<string, { lastPromptAt?: number }> | undefined) ?? {}
    const next: Record<string, any> = {}

    for (const [sessionId, s] of Object.entries(oldSummaries)) {
      if (!s) continue
      const sentAt = oldMeta[sessionId]?.lastPromptAt
        ?? (typeof s.generatedAt === "number" ? s.generatedAt : 0)
      next[sessionId] = {
        sessionId,
        summary: typeof s.text === "string" && s.text
          ? {
              text: s.text,
              model: typeof s.model === "string" ? s.model : "unknown",
              generatedAt: typeof s.generatedAt === "number" ? s.generatedAt : sentAt,
            }
          : null,
        lastMessageSentTime: sentAt,
      }
    }

    // Sessions that only had a `sessionMeta.lastPromptAt` and no
    // summary yet — carry their timestamp over so sort-by-recent
    // still works.
    for (const [sessionId, meta] of Object.entries(oldMeta)) {
      if (next[sessionId]) continue
      if (typeof meta?.lastPromptAt !== "number") continue
      next[sessionId] = {
        sessionId,
        summary: null,
        lastMessageSentTime: meta.lastPromptAt,
      }
    }

    result.sessionMeta = next
    return result
  },
}

export default migration

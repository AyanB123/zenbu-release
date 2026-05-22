/**
 * SummariesService - owns the AI-generated title field inside
 * `root.app.sessionMeta[sessionId].summary`.
 *
 * `sessionMeta` is the per-session metadata cache; this service only
 * touches the `summary` sub-object. Other fields on the same record
 * (`lastMessageSentTime`, future cache fields) are owned by
 * `SessionsService` and are written through their own paths.
 *
 * Read path: the renderer reads `root.app.sessionMeta[sessionId]`
 * directly through `useDb` — no RPC, no events. The db replica
 * syncs to the renderer automatically, so writes show up as soon
 * as `record` returns.
 *
 * Branches that revisit an older user message will display the
 * *latest* prompt's summary, not the branched one. Known
 * limitation, accepted for now.
 */
import { Service } from "@zenbujs/core/runtime"
import { DbService } from "@zenbujs/core/services"

export class SummariesService extends Service.create({
  key: "summaries",
  deps: { db: DbService },
}) {
  /**
   * Persist a generated AI summary for `sessionId`. Creates the
   * `sessionMeta` row if it doesn't exist yet; otherwise leaves
   * `lastMessageSentTime` untouched.
   */
  async record(args: {
    sessionId: string
    text: string
    model: string
  }): Promise<void> {
    const now = Date.now()
    await this.ctx.db.client.update(root => {
      const existing = root.app.sessionMeta[args.sessionId]
      const summary = {
        text: args.text,
        model: args.model,
        generatedAt: now,
      }
      if (existing) {
        existing.summary = summary
      } else {
        root.app.sessionMeta[args.sessionId] = {
          sessionId: args.sessionId,
          summary,
          // No prompt has been stamped yet for this session — best
          // effort: use `now`. In practice `SessionsService` stamps
          // `lastMessageSentTime` before the summarizer ever returns.
          lastMessageSentTime: now,
        }
      }
    })
  }
}

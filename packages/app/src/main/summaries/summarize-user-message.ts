/**
 * Summarize a single user message into a short title for the sidebar.
 *
 * Returns `null` on any failure mode (empty input, model error, malformed
 * response, oversized response, exception). Callers should treat `null` as
 * "do not store a summary" and leave the previous state untouched.
 */
import { complete, type Context, type TextContent, type ImageContent } from "@earendil-works/pi-ai"
import { resolveSmallModel } from "./resolve-model"

const SYSTEM_PROMPT = `You write short titles for chat conversations.

Given a user's message, produce a 4-to-8 word title that summarizes what they're asking for. The title should read like a chat session label — descriptive, no leading articles ("a", "the"), no trailing punctuation.

If the user's message is too short, vague, garbled, or otherwise lacks enough content to summarize meaningfully (e.g. "hi", "h", "test", a single emoji), reply with exactly <summary>SKIP</summary>. Do not invent a summary or describe the message as unclear.

Otherwise reply with ONLY the title wrapped in <summary></summary> tags. Nothing else.

Examples:
User: can you help me refactor the auth module to use jwt
Reply: <summary>Refactor auth module to JWT</summary>

User: h
Reply: <summary>SKIP</summary>`

const MAX_SUMMARY_CHARS = 200

export interface SummarizeOptions {
  signal?: AbortSignal
}

/** Pull plain-text content out of a pi-ai UserMessage `content` field. */
function extractText(content: string | (TextContent | ImageContent)[]): string {
  if (typeof content === "string") return content
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map(b => b.text)
    .join(" ")
}

function extractSummaryTag(text: string): string | null {
  const match = text.match(/<summary>([\s\S]*?)<\/summary>/i)
  if (!match) return null
  const inner = match[1].trim()
  if (!inner) return null
  return inner
}

/**
 * @param userText raw user prompt text. If empty/whitespace, returns null without calling the model.
 */
export async function summarizeUserMessage(
  userText: string | (TextContent | ImageContent)[],
  opts: SummarizeOptions = {},
): Promise<string | null> {
  try {
    const text = (typeof userText === "string" ? userText : extractText(userText)).trim()
    if (!text) {
      console.log("[summary] summarizeUserMessage: empty input, returning null")
      return null
    }

    const { model, apiKey, headers } = await resolveSmallModel()
    console.log(
      "[summary] summarizeUserMessage: model resolved",
      `${model.provider}/${model.id}`,
    )

    const context: Context = {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text, timestamp: Date.now() }],
      tools: [],
    }

    const message = await complete(model, context, {
      apiKey,
      headers,
      signal: opts.signal,
      // Cap output so a runaway model doesn't burn tokens on a title.
      maxTokens: 64,
    })

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      console.warn(
        "[summary] summarizeUserMessage: model stopReason=" + message.stopReason,
        message.errorMessage,
      )
      return null
    }

    const raw = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map(b => b.text)
      .join("")
    console.log(
      "[summary] summarizeUserMessage: raw response",
      JSON.stringify(raw),
    )

    const summary = extractSummaryTag(raw)
    if (!summary) {
      console.warn(
        "[summary] summarizeUserMessage: no <summary> tag in response",
      )
      return null
    }
    if (summary === "SKIP") {
      console.log(
        "[summary] summarizeUserMessage: model returned SKIP (unsummarizable input)",
      )
      return null
    }
    if (summary.length > MAX_SUMMARY_CHARS) {
      console.warn(
        "[summary] summarizeUserMessage: response > MAX_SUMMARY_CHARS",
        summary.length,
      )
      return null
    }
    // Collapse internal newlines — these are titles, not paragraphs.
    const cleaned = summary.replace(/\s+/g, " ").trim()
    return cleaned || null
  } catch (err) {
    console.warn("[summary] summarizeUserMessage threw:", err)
    return null
  }
}

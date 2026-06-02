// Shared types + content markers for the tutorial view.

export type WidgetId = "recommended-plugins" | "shortcuts"

/** Content prefix marking an assistant bubble as an inline widget.
 * `AssistantBubble` sniffs it and routes to `WidgetByName`. */
export const WIDGET_PREFIX = "@@widget:"

/** Marker for a committed `ask_user_question` card in the
 * transcript (`AssistantBubble` routes it to `AskQuestionCard`). */
export const QUESTION_PREFIX = "@@question:"

/** Phrase decorated with a trailing pi-logo pill in streamed text. */
export const PI_PHRASE = "pi coding agent"

/** Gate for script items; items returning false are skipped. */
export type ScriptItemCondition = (ctx: { visited: Set<string> }) => boolean

export type ScriptItem =
  | { kind: "text"; text: string; condition?: ScriptItemCondition }
  | {
      kind: "widget"
      widget: WidgetId
      // When true the pump pauses on the widget until the user
      // clicks its "Okay, done!" affordance instead of
      // auto-advancing. Used for interactive widgets.
      awaitAck?: true
      condition?: ScriptItemCondition
    }

/** Sentinel `next` values handled in `pickOption`: `exit`,
 * `openProject`, `continueSandbox`. Anything else is a node id. */
export type Choice = {
  id: string
  label: string
  /** Renders inside the "escape" section under the divider. */
  variant?: "primary"
  next: string | "exit" | "openProject" | "continueSandbox"
}

export type ChoicePrompt = {
  question: string
  options: Choice[]
}

export type Node = {
  id: string
  items: ScriptItem[]
  next: (ctx: { visited: Set<string> }) => ChoicePrompt | { kind: "end" }
}

/** A synthesized transcript message (the tutorial isn't a real chat). */
export type FakeMessage = {
  role: "assistant" | "user"
  content: string
  key: string
}

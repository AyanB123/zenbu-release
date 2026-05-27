import type { MessageComponents } from "../message-components"
import { AgentReloaded } from "./agent-reloaded"
import { AssistantMessage } from "./assistant-message"
import { CloneMarker } from "./clone-marker"
import { Interrupted } from "./interrupted"
import { Loading } from "./loading"
import { PermissionRequest } from "./permission-request"
import { Plan } from "./plan"
import { ThinkingBlock } from "./thinking-block"
import { ToolCall } from "./tool-call"
import { TurnSummary } from "./turn-summary"
import { UserMessage } from "./user-message"

export const defaultMessageComponents: MessageComponents = {
  UserMessage,
  AssistantMessage,
  ThinkingBlock,
  ToolCall,
  Plan,
  PermissionRequest,
  Loading,
  Interrupted,
  AgentReloaded,
  CloneMarker,
  TurnSummary,
}

export {
  AgentReloaded,
  AssistantMessage,
  CloneMarker,
  Interrupted,
  Loading,
  PermissionRequest,
  Plan,
  ThinkingBlock,
  ToolCall,
  TurnSummary,
  UserMessage,
}

import type { MessageComponents } from "../message-components"
import { AssistantMessage } from "./assistant-message"
import { CloneMarker } from "./clone-marker"
import { Interrupted } from "./interrupted"
import { Loading } from "./loading"
import { PermissionRequest } from "./permission-request"
import { Plan } from "./plan"
import { ThinkingBlock } from "./thinking-block"
import { ToolCall } from "./tool-call"
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
  CloneMarker,
}

export {
  AssistantMessage,
  CloneMarker,
  Interrupted,
  Loading,
  PermissionRequest,
  Plan,
  ThinkingBlock,
  ToolCall,
  UserMessage,
}

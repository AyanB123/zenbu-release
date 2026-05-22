import type { ReactNode } from "react"
import { LockIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Combobox, type ComboboxOption } from "./combobox"

export type AgentConfig = {
  id: string
  name: string
  icon?: ReactNode
  availableModels?: ComboboxOption[]
  availableThinkingLevels?: ComboboxOption[]
}

export type ComposerToolbarProps = {
  agentConfigs?: AgentConfig[]
  currentAgentConfigId?: string
  onChangeAgentConfig?: (id: string) => void
  currentModel?: string
  onChangeModel?: (value: string) => void
  currentThinkingLevel?: string
  onChangeThinkingLevel?: (value: string) => void
  streaming?: boolean
  onInterrupt?: () => void
  /** When true, render the lock button (takes precedence over the
   * interrupt button). Submit is blocked upstream; the button just
   * lets the user unlock. */
  locked?: boolean
  onUnlock?: () => void
  /** Free-form slot rendered before the interrupt button. */
  slot?: ReactNode
}

export function ComposerToolbar({
  agentConfigs,
  currentAgentConfigId,
  onChangeAgentConfig,
  currentModel,
  onChangeModel,
  currentThinkingLevel,
  onChangeThinkingLevel,
  streaming,
  onInterrupt,
  locked,
  onUnlock,
  slot,
}: ComposerToolbarProps) {
  const current = agentConfigs?.find(c => c.id === currentAgentConfigId)

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-0.5 px-2 pb-1">
      {agentConfigs && agentConfigs.length > 0 && onChangeAgentConfig && (
        <Combobox
          label="Agent"
          options={agentConfigs.map(c => ({
            value: c.id,
            name: c.name,
            icon: c.icon,
          }))}
          currentValue={currentAgentConfigId}
          onSelect={onChangeAgentConfig}
          placeholder="Agent…"
        />
      )}

      {current?.availableModels &&
        current.availableModels.length > 0 &&
        onChangeModel && (
          <Combobox
            label="Model"
            options={current.availableModels}
            currentValue={currentModel}
            onSelect={onChangeModel}
          />
        )}

      {current?.availableThinkingLevels &&
        current.availableThinkingLevels.length > 0 &&
        onChangeThinkingLevel && (
          <Combobox
            label="Thinking"
            className="max-w-[11rem]"
            options={current.availableThinkingLevels}
            currentValue={currentThinkingLevel}
            onSelect={onChangeThinkingLevel}
          />
        )}

      {slot}

      {locked ? (
        <Button
          type="button"
          variant="outline"
          onClick={onUnlock}
          aria-label="Locked — click to unlock"
          size="icon-sm"
          className="ml-auto h-7 w-7 shrink-0 cursor-default"
        >
          <LockIcon className="h-3.5 w-3.5" />
        </Button>
      ) : (
        streaming &&
        onInterrupt && (
          <Button
            type="button"
            onClick={onInterrupt}
            aria-label="Interrupt"
            size="icon-sm"
            className="ml-auto h-6 w-6 shrink-0 rounded-full"
          >
            <div className="h-2.5 w-2.5 rounded-[2px] bg-primary-foreground" />
          </Button>
        )
      )}
    </div>
  )
}

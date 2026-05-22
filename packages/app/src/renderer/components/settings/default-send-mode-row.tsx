import { useDb, useDbClient } from "@zenbujs/core/react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Schema } from "../../../main/schema"

type SendMode = Schema["settings"]["defaultSendMode"]

const OPTIONS: { value: SendMode; label: string; description: string }[] = [
  {
    value: "followUp",
    label: "Queue",
    description: "Queue after the current turn finishes",
  },
  {
    value: "steer",
    label: "Steer",
    description: "Interject before the agent's next LLM call",
  },
]

/**
 * Picks what plain `Enter` does in the composer while the agent is
 * streaming. Mod-Enter and the `/steer` / `/queue` slash commands
 * always force their own intent, regardless of this setting.
 */
export function DefaultSendModeRow() {
  const dbClient = useDbClient()
  const mode = useDb(root => root.app.settings.defaultSendMode)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-foreground">
          Default send mode
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          onValueChange={value => {
            if (!value) return
            const next = value as SendMode
            dbClient.update(root => {
              root.app.settings.defaultSendMode = next
            })
          }}
        >
          {OPTIONS.map(option => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="text-[12px]"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <span className="text-[11px] text-muted-foreground">
        {OPTIONS.find(o => o.value === mode)?.description}. Applies when
        Enter is pressed while the agent is streaming.
      </span>
    </div>
  )
}

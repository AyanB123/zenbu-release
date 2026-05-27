import { useState } from "react"
import { SearchIcon } from "lucide-react"
import { Button } from "@zenbu/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@zenbu/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@zenbu/ui/popover"
import { timeAgo } from "../common/time-ago"

export type AgentPickerEntry = {
  id: string
  label: string
  lastActivityAt?: number | null
}

export type AgentPickerComboboxProps = {
  agents: AgentPickerEntry[]
  onSelect: (id: string) => void
  title?: string
}

export function AgentPickerCombobox({
  agents,
  onSelect,
  title = "Load agent",
}: AgentPickerComboboxProps) {
  const [open, setOpen] = useState(false)
  const sorted = [...agents].sort(
    (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
  )

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={title}
          className="hg-icon size-[22px] rounded bg-transparent text-muted-foreground hover:bg-transparent"
        >
          <SearchIcon size={13} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="ml-2 w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search agents..." />
          <CommandList>
            <CommandEmpty>No agents found.</CommandEmpty>
            <CommandGroup>
              {sorted.map(agent => (
                <CommandItem
                  key={agent.id}
                  value={`${agent.label} ${agent.id}`}
                  onSelect={() => {
                    onSelect(agent.id)
                    setOpen(false)
                  }}
                  className="flex items-center gap-2"
                >
                  <span className="flex-1 truncate">{agent.label}</span>
                  {agent.lastActivityAt && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {timeAgo(agent.lastActivityAt)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

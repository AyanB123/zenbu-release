import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SlashCommand } from "./types"

export type SlashCommandMenuProps = {
  options: SlashCommand[]
  selectedIndex: number
  onSelect: (option: SlashCommand) => void
  onHover: (index: number) => void
}

export function SlashCommandMenu({
  options,
  selectedIndex,
  onSelect,
  onHover,
}: SlashCommandMenuProps) {
  if (options.length === 0) return null

  return (
    <div
      style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 16 }}
      className="z-50 min-w-[220px] max-w-[340px] overflow-hidden rounded-sm border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <div className="max-h-[240px] overflow-y-auto p-0.5">
        {options.map((option, i) => (
          <Button
            key={option.id}
            type="button"
            variant="ghost"
            role="option"
            aria-selected={selectedIndex === i}
            className={cn(
              // `transition-none` overrides the ui/Button base's
              // `transition-all`. With the default transition the
              // bg/text crossfade between rows when the user arrows
              // down quickly, so the highlight feels laggy. Snap
              // instead.
              "h-auto w-full flex-col items-start gap-0.5 rounded-[2px] px-2 py-1.5 text-left text-xs font-normal transition-none",
              selectedIndex === i
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground",
            )}
            onMouseEnter={() => onHover(i)}
            onMouseDown={e => {
              e.preventDefault()
              onSelect(option)
            }}
          >
            <span className="truncate font-normal">{option.label}</span>
            {option.description && (
              <span className="truncate text-[10px] text-muted-foreground">
                {option.description}
              </span>
            )}
          </Button>
        ))}
      </div>
    </div>
  )
}

import { useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ChatBackgroundRow } from "./settings/chat-background-row"
import { DefaultSendModeRow } from "./settings/default-send-mode-row"
import { useTheme } from "@/lib/theme"
import type { Schema } from "../../main/schema"

const THEME_OPTIONS: Schema["settings"]["theme"][] = ["light", "dark", "oled", "system"]

export function Settings({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <ThemeRow />
          <DefaultSendModeRow />
          <ChatBackgroundRow />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ThemeRow() {
  const { preference, setPreference } = useTheme()
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] font-medium text-foreground">Theme</span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={preference}
        onValueChange={value => {
          if (value) void setPreference(value as Schema["settings"]["theme"])
        }}
      >
        {THEME_OPTIONS.map(option => (
          <ToggleGroupItem
            key={option}
            value={option}
            className="capitalize text-[12px]"
          >
            {option}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

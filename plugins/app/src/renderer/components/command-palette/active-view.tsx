import { useEffect } from "react"
import { ChevronLeftIcon, XIcon } from "lucide-react"
import { Button } from "@zenbu/ui/button"
import { PaletteShell } from "./palette-shell"
import type { CommandView, CommandViewCtx } from "./types"

export type ActiveViewProps = {
  view: CommandView
  ctx: CommandViewCtx
}

export function ActiveView({ view, ctx }: ActiveViewProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        ctx.back()
      }
    }
    window.addEventListener("keydown", handler, { capture: true })
    return () =>
      window.removeEventListener("keydown", handler, { capture: true })
  }, [ctx])

  return (
    <PaletteShell
      header={
        view.title ? (
          <div className="flex items-center gap-1 px-2 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={ctx.back}
              aria-label="Back (Esc)"
              className="text-muted-foreground"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="flex-1 truncate text-[13px] font-medium text-foreground">
              {view.title}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={ctx.close}
              aria-label="Close"
              className="text-muted-foreground"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="max-h-[480px] overflow-y-auto">{view.render(ctx)}</div>
    </PaletteShell>
  )
}

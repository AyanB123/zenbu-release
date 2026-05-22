import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/common/spinner"
import type { CommandViewCtx } from "../types"

/**
 * Placeholder for the eventual "launch dev app" flow. The shape we want:
 * the user picks "Launch dev app" → palette morphs into a live progress
 * panel that tails the dev server boot log. For now it's a static
 * "not implemented" shimmer.
 */
export function renderLaunchDevAppView(ctx: CommandViewCtx) {
  return <LaunchDevAppView ctx={ctx} />
}

function LaunchDevAppView({ ctx }: { ctx: CommandViewCtx }) {
  const [phase, setPhase] = useState<"booting" | "stub">("booting")

  useEffect(() => {
    const id = setTimeout(() => setPhase("stub"), 600)
    return () => clearTimeout(id)
  }, [])

  return (
    <div className="flex flex-col gap-3 px-5 py-6">
      <div className="flex items-center gap-2 text-[13px] text-foreground">
        {phase === "booting" ? (
          <>
            <Spinner size={12} />
            <span>Booting dev app…</span>
          </>
        ) : (
          <>
            <span className="size-2 rounded-full bg-amber-400" />
            <span>Not implemented yet.</span>
          </>
        )}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        This view will eventually run the dev server for a chosen app and
        stream its boot output here. The flow is wired so the command's
        view fully replaces the palette body — just like Raycast.
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={ctx.close}
        >
          Done
        </Button>
      </div>
    </div>
  )
}

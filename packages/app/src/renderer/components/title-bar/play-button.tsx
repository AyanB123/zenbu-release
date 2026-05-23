import { useCallback, useState } from "react"
import { useDb, useRpc } from "@zenbujs/core/react"
import {
  PlayIcon,
  ScrollTextIcon,
  Settings2Icon,
  SquareIcon,
} from "lucide-react"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { PlayPopoverBody } from "./play-popover-body"

export type PlayButtonProps = {
  workspaceId: string | null
  scopeId: string | null
  cwd: string | null
}

/**
 * Title-bar play control. One always-bordered pill split into two
 * independent buttons:
 *
 *   [  Run / Stop / Setup  | Logs or ⚙  ]
 *
 * The left button is the *action* — it toggles run/stop, or opens
 * the config form on first use. The right button is a passive
 * affordance that opens the popover without first stopping the
 * run. Its icon switches by `running` (not by whether any logs
 * exist), so the user always has a settings entry point at rest:
 *   - running                            →  "Logs" (scroll-text)
 *   - configured, idle or just stopped   →  "Settings" (sliders)
 * That way, once a start script is configured there's always a
 * way back into the popover to edit the command — both on a
 * fresh "Run" pill and on the "Stop" (post-run) pill. We only
 * hide the right button entirely while the workspace is in the
 * "Setup" state, because the primary button itself is the
 * settings entry point in that case.
 */
export function PlayButton({ workspaceId, scopeId, cwd }: PlayButtonProps) {
  const rpc = useRpc()
  const cfg = useDb(root =>
    workspaceId ? root.app.playConfigs[workspaceId] ?? null : null,
  )
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const configured =
    !!cfg && typeof cfg.startCommand === "string" && cfg.startCommand.length > 0
  const running = !!cfg?.isRunning
  // Whether the next popover open should drop straight into the
  // edit form. Reset by `onOpenChange` so reopening via the
  // logs/primary path doesn't leak edit mode across opens.
  const [openEditing, setOpenEditing] = useState(false)

  const handlePrimaryClick = useCallback(async () => {
    if (!workspaceId) return
    setError(null)
    if (!configured) {
      // No commands set yet — pop open the form.
      setOpen(true)
      return
    }
    if (running) {
      setBusy(true)
      try {
        await rpc.app.play.stop({ workspaceId })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
      return
    }
    if (!cwd || !scopeId) {
      setError("No active scope. Open a chat to set the run directory.")
      setOpen(true)
      return
    }
    // Pop the logs view open *before* firing the RPC. The previous
    // ordering awaited `play.run` first, which made the popover
    // appear hundreds of ms after the click — long enough to feel
    // like a missed click. Opening synchronously means the logs
    // panel is already mounted by the time the first chunk of
    // stdout lands, and the empty-state "No output yet…" string
    // covers the gap. We don't auto-open on Stop because the user
    // already has whatever they wanted from the run.
    setOpen(true)
    setBusy(true)
    try {
      await rpc.app.play.run({ workspaceId, scopeId, cwd })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [workspaceId, scopeId, cwd, configured, running, rpc])

  if (!workspaceId) return null

  const label = running
    ? "Stop"
    : configured
      ? "Run start script"
      : "Configure & run start script"

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) setOpenEditing(false)
      }}
    >
      <PopoverAnchor asChild>
        <div
          className={cn(
            "inline-flex h-[22px] items-stretch overflow-hidden rounded-md border border-border bg-background/40 transition-colors",
            "hover:bg-background/70",
          )}
        >
          <button
            type="button"
            aria-label={label}
            disabled={busy}
            onClick={handlePrimaryClick}
            className={cn(
              "inline-flex items-center gap-1 px-2 text-[11px] font-medium leading-none transition-colors",
              "hover:bg-background/80 disabled:opacity-50",
              running
                ? "text-rose-500 dark:text-rose-400"
                : configured
                  ? "text-emerald-500 dark:text-emerald-400"
                  : "text-muted-foreground",
            )}
          >
            {running ? (
              <SquareIcon
                className="h-3 w-3"
                fill="currentColor"
                strokeWidth={0}
              />
            ) : (
              <PlayIcon
                className="h-3 w-3"
                fill="currentColor"
                strokeWidth={0}
              />
            )}
            {running ? (
              <span className="tabular-nums">Stop</span>
            ) : configured ? (
              <span>Run</span>
            ) : (
              <span>Setup</span>
            )}
          </button>

          {configured ? (
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={running ? "Open logs" : "Edit run settings"}
                title={running ? "Open logs" : "Edit run settings"}
                onClick={() => setOpenEditing(!running)}
                className={cn(
                  "inline-flex items-center justify-center border-l border-border px-1.5 text-muted-foreground transition-colors",
                  "hover:bg-background/80 hover:text-foreground",
                  "data-[state=open]:bg-background/80 data-[state=open]:text-foreground",
                )}
              >
                {running ? (
                  <ScrollTextIcon className="h-3 w-3" />
                ) : (
                  <Settings2Icon className="h-3 w-3" />
                )}
              </button>
            </PopoverTrigger>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" sideOffset={6} className="w-[520px] p-0">
        <PlayPopoverBody
          workspaceId={workspaceId}
          scopeId={scopeId}
          cwd={cwd}
          initialError={error}
          // Only override the popover's own default (`!isConfigured`)
          // when the user explicitly asked for edit mode via the
          // gear affordance. Passing `false` here would suppress
          // the form even in the unconfigured "Setup" state.
          initialEditing={openEditing ? true : undefined}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

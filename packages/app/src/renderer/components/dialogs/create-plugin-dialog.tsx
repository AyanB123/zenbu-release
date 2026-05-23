import { useEffect, useRef, useState } from "react"
import { useEvents, useRpc } from "@zenbujs/core/react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type CreatePluginDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called once the worktree, scaffold, and scope are all materialized.
   * The handler is responsible for focusing the new chat (we don't do it
   * from here so the host can decide which window/pane gets it). */
  onCreated?: (args: {
    pluginName: string
    worktreePath: string
    scopeId: string
    chatId: string
  }) => void
}

type ProgressLine = {
  id: number
  text: string
  stream: "stdout" | "stderr" | "step"
}

const PLUGIN_NAME_RE = /^[a-z][a-z0-9-]*$/

/**
 * Dialog for the "Create Plugin" action in the sentinel workspace.
 *
 * The flow: user types a lowercase-hyphen name -> we kick off
 * `rpc.app.createPlugin.createPlugin` -> stream `createPluginProgress`
 * events into a tail-style log -> close the dialog and call
 * `onCreated` on success. The dialog remains open and shows an error
 * banner if the pipeline fails so the user can read whatever went
 * wrong (with the log line that triggered it).
 */
export function CreatePluginDialog({
  open,
  onOpenChange,
  onCreated,
}: CreatePluginDialogProps) {
  const rpc = useRpc()
  const events = useEvents()
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressLine[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const lineCounter = useRef(0)
  const logRef = useRef<HTMLDivElement>(null)

  // Reset everything when the dialog reopens. Lets the user retry
  // after a failure without a stale log.
  useEffect(() => {
    if (!open) return
    setName("")
    setSubmitting(false)
    setError(null)
    setProgress([])
    setRunId(null)
    lineCounter.current = 0
  }, [open])

  // Subscribe to progress/done events for the current run. We
  // intentionally re-subscribe whenever `runId` changes so we don't
  // accumulate stale handlers across retries.
  useEffect(() => {
    if (!runId) return
    const offProgress = events.app.createPluginProgress.subscribe(p => {
      if (p.runId !== runId) return
      lineCounter.current += 1
      setProgress(prev => [
        ...prev,
        { id: lineCounter.current, text: p.line, stream: p.stream },
      ])
    })
    const offDone = events.app.createPluginDone.subscribe(p => {
      if (p.runId !== runId) return
      setSubmitting(false)
      if (!p.ok) {
        setError(p.error ?? "create-plugin failed")
        return
      }
      if (p.pluginName && p.worktreePath && p.scopeId && p.chatId) {
        onCreated?.({
          pluginName: p.pluginName,
          worktreePath: p.worktreePath,
          scopeId: p.scopeId,
          chatId: p.chatId,
        })
      }
      onOpenChange(false)
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [runId, events, onCreated, onOpenChange])

  // Autoscroll the log to the bottom whenever a new line lands.
  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [progress])

  const nameValid = PLUGIN_NAME_RE.test(name.trim())
  const canSubmit = !submitting && nameValid

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSubmit) return
    setError(null)
    setProgress([])
    lineCounter.current = 0
    setSubmitting(true)
    try {
      const { runId: newRunId } = await rpc.app.createPlugin.createPlugin({
        name: name.trim(),
      })
      setRunId(newRunId)
    } catch (err) {
      setSubmitting(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={submitting ? () => {} : onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create plugin</DialogTitle>
            <DialogDescription>
              Scaffolds a new Zenbu plugin in a fresh worktree at
              <code className="ml-1">~/.zenbu/plugins/&lt;name&gt;</code> and
              opens a chat scoped to it.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="plugin-name">Plugin name</Label>
              <Input
                id="plugin-name"
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="my-plugin"
                disabled={submitting}
              />
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, digits, and hyphens. Must start with a letter.
              </p>
            </div>
            {progress.length > 0 && (
              <div
                ref={logRef}
                className="max-h-40 overflow-y-auto rounded border bg-muted/40 p-2 font-mono text-[11px] leading-snug"
              >
                {progress.map(line => (
                  <div
                    key={line.id}
                    className={
                      line.stream === "step"
                        ? "text-foreground"
                        : line.stream === "stderr"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {line.text}
                  </div>
                ))}
              </div>
            )}
            {error && (
              <p className="text-[12px] text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? "Creating…" : "Create plugin"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

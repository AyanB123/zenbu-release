import { useEffect, useRef, useState } from "react"
import { ImageIcon, XIcon } from "lucide-react"
import { useEvents, useRpc } from "@zenbujs/core/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AnsiLine } from "@/components/common/ansi-line"
import { Spinner } from "@/components/common/spinner"
import type { CommandViewCtx } from "../types"

export function renderCreateZenbuAppView(ctx: CommandViewCtx) {
  return <CreateZenbuAppView ctx={ctx} />
}

type Status =
  | { kind: "form" }
  | { kind: "running"; runId: string; lines: string[] }
  | { kind: "launching"; lines: string[]; appPath: string }
  | {
      kind: "done"
      ok: boolean
      lines: string[]
      error?: string
      appPath?: string
    }
  | { kind: "confirm-replace" }

function CreateZenbuAppView({ ctx }: { ctx: CommandViewCtx }) {
  const rpc = useRpc()
  const events = useEvents()
  const [name, setName] = useState("")
  const [iconPath, setIconPath] = useState("")
  const [status, setStatus] = useState<Status>({ kind: "form" })
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [status])

  // Hold on the "Launching…" state for a beat after `createAppDone`
  // arrives, then settle into "Launched". The main process kicked
  // `shell.openPath` synchronously when the spawn exited; this short
  // delay just gives the user visual confirmation that the launch is
  // happening rather than flashing through.
  useEffect(() => {
    if (status.kind !== "launching") return
    const id = setTimeout(() => {
      setStatus(s =>
        s.kind === "launching"
          ? { kind: "done", ok: true, lines: s.lines, appPath: s.appPath }
          : s,
      )
    }, 1200)
    return () => clearTimeout(id)
  }, [status])

  useEffect(() => {
    if (status.kind !== "running") return
    const offProgress = events.app.createAppProgress.subscribe(payload => {
      if (payload.runId !== status.runId) return
      setStatus(s =>
        s.kind === "running" && s.runId === payload.runId
          ? { ...s, lines: [...s.lines, payload.line] }
          : s,
      )
    })
    const offDone = events.app.createAppDone.subscribe(payload => {
      if (payload.runId !== status.runId) return
      setStatus(s => {
        if (s.kind !== "running" || s.runId !== payload.runId) return s
        const conflict = !payload.ok && detectConflict(s.lines, payload.error)
        if (conflict) return { kind: "confirm-replace" }
        if (payload.ok && payload.appPath) {
          return { kind: "launching", lines: s.lines, appPath: payload.appPath }
        }
        return {
          kind: "done",
          ok: payload.ok,
          lines: s.lines,
          error: payload.error,
          appPath: payload.appPath,
        }
      })
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [events, status])

  const onPickIcon = async () => {
    try {
      const picked = await rpc.core.window.pickFiles()
      if (picked && picked.length > 0) setIconPath(picked[0])
    } catch (err) {
      console.error("[create-zenbu-app] pickFiles failed:", err)
    }
  }

  const startRun = async (force: boolean) => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const { runId } = await rpc.app.createApp.createDesktopApp({
        name: trimmed,
        iconPath: iconPath.trim() || undefined,
        force,
      })
      setStatus({ kind: "running", runId, lines: [] })
    } catch (err) {
      setStatus({
        kind: "done",
        ok: false,
        lines: [],
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (status.kind === "form") {
    const canSubmit = name.trim().length > 0
    return (
      <div className="flex items-center gap-2 px-3 py-3">
        <IconPicker
          iconPath={iconPath}
          onPick={onPickIcon}
          onClear={() => setIconPath("")}
        />
        <Input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && canSubmit) {
              e.preventDefault()
              void startRun(false)
            }
            if (e.key === "Escape") {
              e.preventDefault()
              ctx.back()
            }
          }}
          placeholder="App name"
          className="h-9 min-w-0 flex-1 bg-card text-[13px]"
        />
        <Button
          type="button"
          variant="ghost"
          onClick={ctx.back}
          className="h-9 shrink-0 text-[12px] text-muted-foreground"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void startRun(false)}
          disabled={!canSubmit}
          className="h-9 shrink-0 text-[12px]"
        >
          Create
        </Button>
      </div>
    )
  }

  if (status.kind === "confirm-replace") {
    const trimmed = name.trim()
    return (
      <div className="flex flex-col gap-3 px-5 py-5">
        <p className="text-[13px] text-foreground">
          An app named “{trimmed}” already exists. Replacing it will delete
          the existing app bundle and source.
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setStatus({ kind: "form" })}
            className="text-[12px] text-muted-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void startRun(true)}
            className="text-[12px]"
          >
            Replace
          </Button>
        </div>
      </div>
    )
  }

  const trimmedName = name.trim()
  const lines =
    status.kind === "running" ||
    status.kind === "launching" ||
    status.kind === "done"
      ? status.lines
      : []

  return (
    <div className="flex flex-col gap-3 px-5 py-5">
      <div className="flex items-center gap-2 text-[13px] text-foreground">
        {status.kind === "running" && (
          <>
            <Spinner size={12} />
            <span>Creating {trimmedName}…</span>
          </>
        )}
        {status.kind === "launching" && (
          <>
            <Spinner size={12} />
            <span>Launching {trimmedName}…</span>
          </>
        )}
        {status.kind === "done" && status.ok && (
          <span>Launched {trimmedName}.</span>
        )}
        {status.kind === "done" && !status.ok && (
          <span>Failed{status.error ? `: ${status.error}` : ""}.</span>
        )}
      </div>

      <div
        ref={logRef}
        className="h-[240px] overflow-y-auto rounded-md border border-border bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground"
      >
        {lines.length === 0 ? (
          <span className="text-muted-foreground">Waiting for output…</span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              <AnsiLine text={l} />
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        {status.kind === "done" && !status.ok && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStatus({ kind: "form" })}
            className="text-[12px]"
          >
            Try again
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={ctx.close}
          className="text-[12px]"
        >
          {status.kind === "running" || status.kind === "launching"
            ? "Run in background"
            : "Done"}
        </Button>
      </div>
    </div>
  )
}

function IconPicker({
  iconPath,
  onPick,
  onClear,
}: {
  iconPath: string
  onPick: () => void | Promise<void>
  onClear: () => void
}) {
  const [previewFailed, setPreviewFailed] = useState(false)
  const hasIcon = iconPath.length > 0

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        onClick={() => void onPick()}
        aria-label={hasIcon ? "Change icon" : "Choose icon"}
        className="group/icon relative size-10 overflow-hidden rounded-lg border-dashed bg-card p-0 text-muted-foreground hover:border-ring hover:text-foreground"
      >
        {hasIcon && !previewFailed ? (
          <img
            src={`file://${iconPath}`}
            alt=""
            className="size-full object-cover"
            onError={() => setPreviewFailed(true)}
          />
        ) : hasIcon ? (
          <span className="text-[10px] font-medium uppercase">
            {basenameInitial(iconPath)}
          </span>
        ) : (
          <ImageIcon className="size-4" />
        )}
      </Button>
      {hasIcon && (
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          onClick={onClear}
          aria-label="Remove icon"
          className="absolute -right-1.5 -top-1.5 size-4 rounded-full bg-popover text-muted-foreground"
        >
          <XIcon className="size-2.5" />
        </Button>
      )}
    </div>
  )
}

function basenameInitial(p: string): string {
  const last = p.split("/").filter(Boolean).pop() ?? p
  return (last[0] ?? "?").toUpperCase()
}

/**
 * The CLI bails with `<path> already exists. Re-run with --force ...`
 * when the slug collides. We strip ANSI noise then look for that
 * fragment in either the streamed output or the final error message
 * so we can offer an inline "Replace" confirmation instead.
 */
function detectConflict(lines: string[], error: string | undefined): boolean {
  const haystack = strip(lines.join("\n") + "\n" + (error ?? ""))
  return /already exists/i.test(haystack)
}

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

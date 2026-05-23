import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useCollection, useDb, useRpc } from "@zenbujs/core/react"
import { ExternalLinkIcon, PlayIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  parseUrlsAsync,
  stripAnsi,
  type ParsedUrl,
} from "@/lib/parse-urls"

export type PlayPopoverBodyProps = {
  workspaceId: string
  scopeId: string | null
  cwd: string | null
  initialError: string | null
  /** When true, the body mounts with the edit form expanded even if
   * the workspace already has a saved config. The title-bar pill
   * sets this when the user clicks the settings (gear) affordance
   * so it jumps straight into the form instead of showing the
   * read-only "current start script" pill + logs view. Falls back
   * to `!isConfigured` (the original behaviour) when omitted. */
  initialEditing?: boolean
  onClose: () => void
}

/** Pixel height of a single rendered log line. Must match the
 * computed line-height of `.play-log-line` below (font-size 12 *
 * line-height 1.5 = 18). Used for windowed rendering. */
const LINE_HEIGHT = 18

/** How many extra lines to render above/below the visible window to
 * smooth fast scrolling. */
const OVERSCAN = 12

/** Cap on how many log lines we keep in the DOM-projected view. The
 * underlying collection grows without bound; capping at 5k * 18px
 * (= ~90k of scrollable area) is plenty for "tail -f"-style use
 * and stops the renderer from spending forever projecting on
 * giant runs. */
const MAX_PROJECTED_LINES = 5000

type ProjectedLine = {
  /** Index into the original collection. */
  itemIndex: number
  /** Index of the line *within* this item's data. */
  lineIndex: number
  text: string
  stream: "stdout" | "stderr" | "system"
  runId: string
}

export function PlayPopoverBody({
  workspaceId,
  scopeId,
  cwd,
  initialError,
  initialEditing,
  onClose: _onClose,
}: PlayPopoverBodyProps) {
  const rpc = useRpc()
  const cfg = useDb(root => root.app.playConfigs[workspaceId] ?? null)
  const logsRef = useDb(root => root.app.playConfigs[workspaceId]?.logs)
  const { items } = useCollection(logsRef)

  const isRunning = !!cfg?.isRunning
  const isConfigured =
    !!cfg && typeof cfg.startCommand === "string" && cfg.startCommand.length > 0

  // ---- form state -----------------------------------------------------
  const [editing, setEditing] = useState<boolean>(
    initialEditing ?? !isConfigured,
  )
  const [setupCommand, setSetupCommand] = useState<string>(
    cfg?.setupCommand ?? "",
  )
  const [startCommand, setStartCommand] = useState<string>(
    cfg?.startCommand ?? "",
  )
  const [formError, setFormError] = useState<string | null>(initialError)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)

  // Reset the form whenever the underlying config changes underneath us
  // (e.g. a different window edited it).
  useEffect(() => {
    if (editing) return
    setSetupCommand(cfg?.setupCommand ?? "")
    setStartCommand(cfg?.startCommand ?? "")
  }, [cfg?.setupCommand, cfg?.startCommand, editing])

  // ---- actions --------------------------------------------------------
  const onSave = useCallback(async () => {
    setFormError(null)
    setSaving(true)
    try {
      await rpc.app.play.saveConfig({
        workspaceId,
        setupCommand: setupCommand.trim() || null,
        startCommand: startCommand.trim(),
      })
      setEditing(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [rpc, workspaceId, setupCommand, startCommand])

  const onRun = useCallback(async () => {
    if (!cwd || !scopeId) {
      setFormError("No active scope. Open a chat to set the run directory.")
      return
    }
    setFormError(null)
    setRunning(true)
    try {
      await rpc.app.play.run({ workspaceId, scopeId, cwd })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }, [rpc, workspaceId, scopeId, cwd])

  const onStop = useCallback(async () => {
    setFormError(null)
    try {
      await rpc.app.play.stop({ workspaceId })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    }
  }, [rpc, workspaceId])

  // ---- project items to a flat line list ------------------------------
  const projected: ProjectedLine[] = useMemo(() => {
    const out: ProjectedLine[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      const cleaned = stripAnsi(item.data)
      // Split on \n but keep blank lines so structure stays
      // recognisable. Trailing newline → trailing empty line we
      // drop, because it's almost always just the chunk
      // delimiter from node's stream.
      const lines = cleaned.split("\n")
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
      for (let j = 0; j < lines.length; j++) {
        out.push({
          itemIndex: i,
          lineIndex: j,
          text: lines[j]!,
          stream: item.stream,
          runId: item.runId,
        })
      }
    }
    if (out.length > MAX_PROJECTED_LINES) {
      return out.slice(out.length - MAX_PROJECTED_LINES)
    }
    return out
  }, [items])

  // ---- URL parsing (async, debounced) ---------------------------------
  const [urls, setUrls] = useState<ParsedUrl[]>([])
  const parseSeq = useRef(0)
  useEffect(() => {
    const mySeq = ++parseSeq.current
    let cancelled = false
    const handle = setTimeout(() => {
      if (cancelled) return
      // Only parse the most recent slice so we don't redo work on
      // long-running streams. URLs printed earlier are still in
      // the list from previous parses unless the user just hit
      // "Clear" (TODO when we add that).
      const text = projected.map(p => p.text).join("\n")
      void parseUrlsAsync(text).then(found => {
        if (cancelled || parseSeq.current !== mySeq) return
        // Dedup by href, keep first occurrence order.
        const seen = new Set<string>()
        const uniq: ParsedUrl[] = []
        for (const u of found) {
          if (seen.has(u.href)) continue
          seen.add(u.href)
          uniq.push(u)
        }
        setUrls(uniq)
      })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [projected])

  // ---- windowed scroll ------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [clientHeight, setClientHeight] = useState(280)
  const [followTail, setFollowTail] = useState(true)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    const distanceFromBottom =
      el.scrollHeight - el.clientHeight - el.scrollTop
    setFollowTail(distanceFromBottom < 8)
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setClientHeight(el.clientHeight)
  }, [])

  useLayoutEffect(() => {
    if (!followTail) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [projected.length, followTail])

  const total = projected.length
  const startIdx = Math.max(
    0,
    Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN,
  )
  const endIdx = Math.min(
    total,
    Math.ceil((scrollTop + clientHeight) / LINE_HEIGHT) + OVERSCAN,
  )
  const padTop = startIdx * LINE_HEIGHT
  const padBottom = (total - endIdx) * LINE_HEIGHT
  const slice = projected.slice(startIdx, endIdx)

  // ---- UI -------------------------------------------------------------
  return (
    <div className="flex max-h-[520px] w-full flex-col text-sm">
      <Header
        isRunning={isRunning}
        isConfigured={isConfigured}
        editing={editing}
        startCommand={cfg?.startCommand ?? ""}
        onEdit={() => setEditing(true)}
        onRun={onRun}
        onStop={onStop}
        running={running}
      />

      {editing ? (
        <ConfigForm
          setupCommand={setupCommand}
          startCommand={startCommand}
          onSetupChange={setSetupCommand}
          onStartChange={setStartCommand}
          onSave={onSave}
          onCancel={
            isConfigured
              ? () => {
                  setEditing(false)
                  setSetupCommand(cfg?.setupCommand ?? "")
                  setStartCommand(cfg?.startCommand ?? "")
                  setFormError(null)
                }
              : null
          }
          saving={saving}
        />
      ) : null}

      {formError ? (
        <div className="border-t border-border bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-600 dark:text-rose-300">
          {formError}
        </div>
      ) : null}

      {!editing && isConfigured ? (
        <>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="play-log-scroll relative min-h-[180px] flex-1 overflow-auto bg-background/40 font-mono text-[12px] leading-[1.5]"
            style={{ maxHeight: 280 }}
          >
            {total === 0 ? (
              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-[11px] text-muted-foreground">
                No output yet. Hit Run to start the script.
              </div>
            ) : (
              <div style={{ height: total * LINE_HEIGHT, position: "relative" }}>
                <div
                  style={{
                    transform: `translateY(${padTop}px)`,
                    position: "absolute",
                    left: 0,
                    right: 0,
                  }}
                >
                  {slice.map((line, i) => (
                    <LogLine
                      key={`${startIdx + i}`}
                      stream={line.stream}
                      text={line.text}
                    />
                  ))}
                </div>
                <div
                  style={{ height: padBottom, position: "absolute", bottom: 0 }}
                />
              </div>
            )}
          </div>

          <UrlFooter urls={urls} />
        </>
      ) : null}
    </div>
  )
}

function Header({
  isRunning,
  isConfigured,
  editing,
  startCommand,
  onEdit,
  onRun,
  onStop,
  running,
}: {
  isRunning: boolean
  isConfigured: boolean
  editing: boolean
  startCommand: string
  onEdit: () => void
  onRun: () => void
  onStop: () => void
  running: boolean
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
      <div className="flex min-w-0 flex-1 items-center">
        {isConfigured ? (
          <code className="inline-flex h-7 max-w-full items-center truncate rounded border border-border bg-muted px-2 font-mono text-[12px] leading-none text-foreground">
            {startCommand}
          </code>
        ) : (
          <div className="text-[12px] text-muted-foreground">
            No start script configured yet.
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isConfigured && !editing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={onEdit}
          >
            Edit
          </Button>
        ) : null}
        {isConfigured && !editing ? (
          isRunning ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={onStop}
            >
              <SquareIcon
                className="h-3 w-3"
                fill="currentColor"
                strokeWidth={0}
              />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={running}
              onClick={onRun}
            >
              <PlayIcon
                className="h-3 w-3"
                fill="currentColor"
                strokeWidth={0}
              />
              Run
            </Button>
          )
        ) : null}
      </div>
    </div>
  )
}

function ConfigForm({
  setupCommand,
  startCommand,
  onSetupChange,
  onStartChange,
  onSave,
  onCancel,
  saving,
}: {
  setupCommand: string
  startCommand: string
  onSetupChange: (s: string) => void
  onStartChange: (s: string) => void
  onSave: () => void
  onCancel: (() => void) | null
  saving: boolean
}) {
  const canSave = startCommand.trim().length > 0 && !saving
  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (canSave) onSave()
      }}
      className="flex flex-col gap-2 border-b border-border bg-muted/20 px-3 py-3"
    >
      <label className="flex flex-col gap-1 text-[11px]">
        <span className="font-medium text-muted-foreground">
          Setup command (optional)
        </span>
        <Input
          value={setupCommand}
          onChange={e => onSetupChange(e.target.value)}
          placeholder="pnpm install"
          className="h-8 font-mono text-[12px]"
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px]">
        <span className="font-medium text-muted-foreground">
          Start command
        </span>
        <Input
          value={startCommand}
          onChange={e => onStartChange(e.target.value)}
          placeholder="pnpm dev"
          className="h-8 font-mono text-[12px]"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="submit"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={!canSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}

function LogLine({
  stream,
  text,
}: {
  stream: "stdout" | "stderr" | "system"
  text: string
}) {
  return (
    <div
      className={cn(
        "play-log-line whitespace-pre overflow-hidden px-3",
        stream === "stderr" && "text-rose-500 dark:text-rose-300",
        stream === "system" && "text-muted-foreground italic",
      )}
      style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
    >
      {text || "\u00A0"}
    </div>
  )
}

function UrlFooter({ urls }: { urls: ParsedUrl[] }) {
  const rpc = useRpc()
  if (urls.length === 0) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border bg-muted/30 px-3 py-1.5">
      <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        URLs
      </span>
      {urls.map(u => (
        <button
          key={u.href}
          type="button"
          onClick={() => {
            void rpc.core.window.openExternal(u.href).catch(() => {})
          }}
          className="group inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:border-primary hover:text-primary"
          title={`Open ${u.href}`}
        >
          <ExternalLinkIcon className="h-3 w-3 opacity-70 group-hover:opacity-100" />
          <span className="max-w-[260px] truncate">{u.href}</span>
        </button>
      ))}
    </div>
  )
}

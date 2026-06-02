import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ChevronDownIcon,
  InfoIcon,
  PackageCheckIcon,
  PlayIcon,
  ScrollTextIcon,
  SquareIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@zenbu/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@zenbu/ui/popover"
import { HoverTip } from "@zenbu/ui/hover-tip"
import { cn } from "@zenbu/ui/utils"
import {
  useCollection,
  useDb,
  useRpc,
  type ViewComponentProps,
} from "@zenbujs/core/react"

type TitleBarViewArgs = {
  workspaceId: string | null
  scopeId: string | null
  directory: string | null
}

/**
 * Title-bar plugin-dev buttons.
 *
 * Only renders inside windows whose active scope carries a
 * `pluginName` \u2014 i.e. the per-plugin workspaces created by
 * `PluginsRootViewService.ensurePluginWorkspace` when the
 * marketplace sidebar opens a new plugin window. In every other
 * workspace we return `null` so the title bar stays uncluttered.
 *
 * Three affordances:
 *
 *  1. **Run in Dev** \u2014 spawns a fresh host instance via
 *     `rpc.pluginDev.pluginDev.runInDev`. Stays enabled across
 *     runs; clicking a second time spawns another instance and
 *     rotates the popover's log binding to the new run.
 *  2. **Logs popover** (chevron next to Run) \u2014 shows a
 *     virtualized scrollback of the latest run's stdout / stderr /
 *     system lines, backed by `root.pluginDev.runs.<id>.logs`. The
 *     same record exposes `status` + `exitCode` so we can show a
 *     pill in the header (Running / Exited / Errored).
 *  3. **Install Plugin** \u2014 split button with `installLocal` +
 *     an `(i)` popover explaining what installation does. Writes
 *     into the user's local `zenbu.plugins.local.jsonc` overlay (not the
 *     shared `zenbu.config.ts`). Toasts on result.
 */
export default function PluginDevButtons({
  args,
}: ViewComponentProps<TitleBarViewArgs>) {
  const rpc = useRpc()
  // `pluginName` is the unique signature for windows opened by the
  // marketplace sidebar's "Open in Workspace" path. Reading from
  // `root.app.scopes` keeps this view in lock-step with workspace
  // archive/restore without us having to thread anything through
  // the title-bar args contract.
  const scope = useDb(root =>
    args?.scopeId ? root.app.scopes[args.scopeId] ?? null : null,
  )
  const pluginName: string | null = scope?.pluginName ?? null
  const pluginDir: string | null = scope?.directory ?? null

  // Most-recent run for this plugin path. Lives in this plugin's
  // own DB section so the popover doesn't have to subscribe to a
  // service event \u2014 it just renders whatever the latest record
  // says.
  const latestRunId = useDb(root =>
    pluginDir ? root.pluginDev.latestRunIdByPluginPath[pluginDir] ?? null : null,
  )
  const run = useDb(root =>
    latestRunId ? root.pluginDev.runs[latestRunId] ?? null : null,
  )
  const status = run?.status ?? null

  const [runBusy, setRunBusy] = useState(false)
  const [installBusy, setInstallBusy] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)

  const isRunning = status === "running"

  const handleRun = useCallback(async () => {
    if (!pluginDir) return
    // If there's already a live run for this plugin, clicking the
    // primary button stops it instead of stacking a second
    // sandbox on top. The label / icon flip below makes the
    // affordance obvious.
    if (isRunning && latestRunId) {
      setRunBusy(true)
      try {
        await rpc.pluginDev.pluginDev.stopDev({ runId: latestRunId })
      } catch (err) {
        toast.error("Couldn't stop dev instance", {
          description: err instanceof Error ? err.message : String(err),
        })
      } finally {
        setRunBusy(false)
      }
      return
    }
    setRunBusy(true)
    try {
      await rpc.pluginDev.pluginDev.runInDev({ pluginPath: pluginDir })
      // Auto-pop the logs panel on each launch so the user sees
      // the spawn progress immediately. They can close it if they
      // don't care.
      setLogsOpen(true)
    } catch (err) {
      toast.error("Couldn't start dev instance", {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setRunBusy(false)
    }
  }, [rpc, pluginDir, isRunning, latestRunId])

  const handleInstall = useCallback(async () => {
    if (!pluginDir) return
    setInstallBusy(true)
    try {
      const result = await rpc.pluginDev.pluginDev.installLocal({
        pluginPath: pluginDir,
      })
      toast.success("Plugin installed", {
        description: `Added to ${result.projectDir}/zenbu.plugins.local.jsonc`,
      })
    } catch (err) {
      toast.error("Install failed", {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setInstallBusy(false)
    }
  }, [rpc, pluginDir])

  // Guard against `scope` being a non-plugin scope. We deliberately
  // check `pluginName` (the marketplace's signature) instead of
  // `workspace.kind` so non-plugin "plugin" workspaces (if any
  // sneak in via direct DB edits) don't accidentally show these.
  if (!pluginName || !pluginDir) return null

  return (
    <div className="inline-flex items-center gap-1.5">
      {/* Run in Dev split: [Run | chevron-opens-logs] */}
      <div
        data-onboarding-target="run-in-dev"
        className={cn(
          "inline-flex h-[22px] items-stretch overflow-hidden rounded-md border border-border bg-background/40",
          "transition-colors hover:bg-background/70",
        )}
      >
        <HoverTip
          label={
            isRunning
              ? `Stop the running ${pluginName} dev instance`
              : `Run ${pluginName} in a fresh dev instance`
          }
          setAriaLabel={false}
        >
          <button
            type="button"
            onClick={handleRun}
            disabled={runBusy}
            aria-label={
              isRunning
                ? "Stop running dev instance"
                : "Run plugin in a fresh dev instance"
            }
            className={cn(
              "inline-flex items-center gap-1.5 px-2 text-[11px] font-medium leading-none text-muted-foreground transition-colors",
              "hover:bg-background/80 hover:text-foreground",
              "disabled:opacity-60",
            )}
          >
            {runBusy ? (
              <Spinner />
            ) : isRunning ? (
              <SquareIcon className="size-3 fill-current" />
            ) : (
              <PlayIcon className="size-3" />
            )}
            <span>{isRunning ? "Stop" : "Run in Dev"}</span>
            {!isRunning && <StatusDot status={status} />}
          </button>
        </HoverTip>
        <Popover open={logsOpen} onOpenChange={setLogsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Open dev logs"
              className={cn(
                "inline-flex items-center justify-center border-l border-border px-1.5 text-muted-foreground transition-colors",
                "hover:bg-background/80 hover:text-foreground",
                "data-[state=open]:bg-background/80 data-[state=open]:text-foreground",
              )}
            >
              <ChevronDownIcon className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-[640px] max-w-[80vw] p-0"
          >
            <LogsPanel runId={latestRunId} run={run} />
          </PopoverContent>
        </Popover>
      </div>

      {/* Install split: [Install | info popover] */}
      <div
        data-onboarding-target="install-plugin"
        className={cn(
          "inline-flex h-[22px] items-stretch overflow-hidden rounded-md border border-border bg-background/40",
          "transition-colors hover:bg-background/70",
        )}
      >
        <HoverTip
          label="Install into your local zenbu config (zenbu.plugins.local.jsonc)"
          setAriaLabel={false}
        >
          <button
            type="button"
            onClick={handleInstall}
            disabled={installBusy}
            aria-label="Install plugin"
            className={cn(
              "inline-flex items-center gap-1.5 px-2 text-[11px] font-medium leading-none text-muted-foreground transition-colors",
              "hover:bg-background/80 hover:text-foreground",
              "disabled:opacity-60",
            )}
          >
            {installBusy ? (
              <Spinner />
            ) : (
              <PackageCheckIcon className="size-3" />
            )}
            <span>Install Plugin</span>
          </button>
        </HoverTip>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="About installing this plugin"
              className={cn(
                "inline-flex items-center justify-center border-l border-border px-1.5 text-muted-foreground transition-colors",
                "hover:bg-background/80 hover:text-foreground",
                "data-[state=open]:bg-background/80 data-[state=open]:text-foreground",
              )}
            >
              <InfoIcon className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[260px] text-[11.5px] leading-snug"
          >
            <p className="font-medium text-foreground">Install plugin</p>
            <p className="mt-1 text-muted-foreground">
              This adds the plugin to your{" "}
              <span className="font-medium text-foreground">
                zenbu.plugins.local.jsonc
              </span>{" "}
              overlay \u2014 a local-only config that layers on top of{" "}
              <span className="font-medium text-foreground">
                zenbu.config.ts
              </span>
              . The shared config isn&apos;t touched, so this only
              affects your machine. Do this when you&apos;re sure
              it works.
            </p>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Logs panel
//
// Mirrors the structure of the play plugin's log viewer: header pill
// with the run state + a virtualized scrollback. Trimmed down \u2014
// no setup/start form, no URL parsing footer (the dev child opens
// its own windows, so we don't try to extract URLs from its output).

type RunRecord = {
  runId: string
  pluginPath: string
  startedAt: number
  endedAt: number | null
  status: "running" | "exited" | "errored"
  exitCode: number | null
  errorMessage: string | null
  logs: unknown
} | null

function LogsPanel({
  runId,
  run,
}: {
  runId: string | null
  run: RunRecord
}) {
  // `useCollection` accepts the live ref off the record so a new
  // run automatically swaps the projection without us re-mounting.
  const logsRef = useDb(root =>
    runId ? root.pluginDev.runs[runId]?.logs : undefined,
  )
  const { items } = useCollection(logsRef)

  // Project each item's `\n`-delimited payload into individual
  // lines so virtualization can use a fixed row height. Same
  // shape the play plugin uses.
  const lines = useMemo<ProjectedLine[]>(() => {
    const out: ProjectedLine[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      const cleaned = stripAnsi(item.data)
      const split = cleaned.split("\n")
      if (split.length > 1 && split[split.length - 1] === "") split.pop()
      for (let j = 0; j < split.length; j++) {
        out.push({
          key: `${i}-${j}`,
          text: split[j]!,
          stream: item.stream,
        })
      }
    }
    if (out.length > MAX_PROJECTED_LINES) {
      return out.slice(out.length - MAX_PROJECTED_LINES)
    }
    return out
  }, [items])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [clientHeight, setClientHeight] = useState(320)
  const [followTail, setFollowTail] = useState(true)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop
    setFollowTail(distance < 8)
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
  }, [lines.length, followTail])

  const total = lines.length
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
  const slice = lines.slice(startIdx, endIdx)

  return (
    <div className="flex max-h-[520px] w-full flex-col text-[12px]">
      <LogsHeader run={run} />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="plugin-dev-log-scroll relative min-h-[200px] flex-1 overflow-auto bg-background/40 font-mono text-[12px] leading-[1.5]"
        style={{ maxHeight: 320 }}
      >
        {total === 0 ? (
          <div className="flex h-full items-center justify-center px-3 py-8 text-center text-[11px] text-muted-foreground">
            {run
              ? "Waiting for output\u2026"
              : "No runs yet. Click Run in Dev to spawn an instance."}
          </div>
        ) : (
          <div
            style={{ height: total * LINE_HEIGHT, position: "relative" }}
          >
            <div
              style={{
                transform: `translateY(${padTop}px)`,
                position: "absolute",
                left: 0,
                right: 0,
              }}
            >
              {slice.map(line => (
                <LogLine
                  key={line.key}
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
      {run?.errorMessage ? (
        <div className="border-t border-border bg-rose-500/10 px-3 py-1.5 text-[11px] leading-snug text-rose-600 dark:text-rose-300">
          <div className="font-medium">Run failed</div>
          <div className="mt-0.5 whitespace-pre-wrap font-mono">
            {run.errorMessage}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function LogsHeader(_props: { run: RunRecord }) {
  // We intentionally keep this header tiny — just the icon + label.
  // The status of the run is already conveyed by the small dot on
  // the title-bar Run button itself (`StatusDot`), and the stream
  // colours inside the log body make stderr / system lines easy to
  // pick out. A separate state pill + timer here was redundant.
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-muted-foreground">
      <ScrollTextIcon className="size-3.5" />
      <span className="text-[11.5px]">Dev logs</span>
    </div>
  )
}

type ProjectedLine = {
  key: string
  text: string
  stream: "stdout" | "stderr" | "system"
}

/** Matches the inline height on `LogLine`. Keep these in lockstep \u2014
 * the virtualization math depends on `LINE_HEIGHT === actual row
 * height`. */
const LINE_HEIGHT = 18
/** Render this many extra lines above/below the visible window so
 * fast scrolling doesn't flash blank rows. */
const OVERSCAN = 8
/** Hard cap on lines we project per render. A chatty plugin's log
 * spam shouldn't make the popover allocate megabytes. */
const MAX_PROJECTED_LINES = 5000

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
        "whitespace-pre overflow-hidden px-3",
        stream === "stderr" && "text-rose-500 dark:text-rose-300",
        stream === "system" && "text-muted-foreground italic",
      )}
      style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
    >
      {text || "\u00A0"}
    </div>
  )
}

function StatusDot({
  status,
}: {
  status: "running" | "exited" | "errored" | null
}) {
  if (!status) return null
  const cls =
    status === "running"
      ? "bg-emerald-500"
      : status === "errored"
        ? "bg-rose-500"
        : "bg-muted-foreground/50"
  return (
    <span
      aria-hidden
      className={cn("ml-0.5 inline-block size-1.5 rounded-full", cls)}
    />
  )
}

function Spinner() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

/** Strip CSI / SGR escape sequences so log output renders cleanly in
 * the popover. We intentionally do NOT preserve any colour
 * information here \u2014 the dev tool isn't a terminal emulator and
 * coloured spans would clash with the stream-based colour we already
 * apply (`stderr` red, `system` muted). Borrowed verbatim from the
 * play plugin's `parse-urls.ts` so the two log viewers stay
 * visually consistent. */
function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
}



import { useMemo } from "react"
import { useDb } from "@zenbujs/core/react"
import { useThemeSync } from "@/lib/theme"
import type { Schema } from "../../../main/schema"

type Session = Schema["sessions"][string]
type ModelInfo = Schema["models"][string]

/**
 * Right-rail context visualizer. Derives the active session from the
 * same window-state walk used by pi-event-log (selectedScopeId →
 * active tab → chat.session). Reads `stats` + `models` straight
 * off the replica so first paint is synchronous and updates as the
 * agent streams.
 *
 * The grid is a fixed cells×rows array where filled cells represent
 * `contextUsage.tokens` and outlined cells represent free space. The
 * fill is segmented into three bands derived from the per-turn usage
 * we *do* have (cumulative input — cacheRead, output, and the
 * remainder treated as "cached prefix"). Categories are approximate;
 * pi only exposes a single `tokens` figure per turn so anything
 * finer-grained is best-effort visualization, not a billing report.
 */
export function ContextSidebarApp() {
  useThemeSync()
  const sessionId = useActiveSessionId()

  if (!sessionId) {
    return (
      <Placeholder>
        No active session. Open a chat to see its context window.
      </Placeholder>
    )
  }

  return <ContextPane key={sessionId} sessionId={sessionId} />
}

/* ---------------------------------- pane -------------------------------- */

function ContextPane({ sessionId }: { sessionId: string }) {
  const session = useDb(root => root.app.sessions[sessionId] ?? null)
  const modelInfo = useDb(root => {
    const s = root.app.sessions[sessionId]
    if (!s?.model) return null
    const key = `${s.model.provider}:${s.model.id}`
    return root.app.models[key] ?? null
  })

  if (!session) {
    return <Placeholder>Session not found.</Placeholder>
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <Header session={session} model={modelInfo} />
      <Grid session={session} model={modelInfo} />
      <SessionFooter session={session} />
    </div>
  )
}

/* --------------------------------- header ------------------------------- */

function Header({
  session,
  model,
}: {
  session: Session
  model: ModelInfo | null
}) {
  const stats = session.stats
  const ctx = stats.contextUsage

  const title = session.title?.trim() || "Untitled session"
  const modelName = model?.name ?? session.model?.id ?? "Unknown model"
  const cw = ctx?.contextWindow ?? model?.contextWindow ?? null

  const used = ctx?.tokens ?? null
  const percent = ctx?.percent ?? null

  let tone: "default" | "warning" | "danger" = "default"
  if (percent != null) {
    if (percent > 90) tone = "danger"
    else if (percent > 70) tone = "warning"
  }

  return (
    <div className="border-b border-border px-3 pt-3 pb-2.5">
      <div
        className="truncate text-[11px] font-medium text-muted-foreground"
        title={title}
      >
        {title}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span
          className="truncate text-[13px] font-semibold text-foreground"
          title={modelName}
        >
          {modelName}
        </span>
        {cw != null && (
          <span className="text-[10.5px] text-muted-foreground">
            {formatTokens(cw)} ctx
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div className="font-mono text-[11px] text-muted-foreground">
          {used != null && cw != null ? (
            <>
              <span
                className={
                  tone === "danger"
                    ? "font-semibold text-destructive"
                    : tone === "warning"
                      ? "font-semibold text-yellow-500"
                      : "font-semibold text-foreground"
                }
              >
                {used.toLocaleString()}
              </span>
              <span> / {cw.toLocaleString()}</span>
            </>
          ) : (
            <span>— tokens</span>
          )}
        </div>
        <div
          className={
            "font-mono text-[11px] " +
            (tone === "danger"
              ? "text-destructive"
              : tone === "warning"
                ? "text-yellow-500"
                : "text-muted-foreground")
          }
        >
          {percent != null ? `${percent.toFixed(percent < 10 ? 1 : 0)}%` : "—"}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------- grid -------------------------------- */

const GRID_COLS = 22
const GRID_ROWS = 11
const GRID_TOTAL = GRID_COLS * GRID_ROWS

/**
 * Each cell represents `contextWindow / GRID_TOTAL` tokens. The first
 * `round((used / contextWindow) * GRID_TOTAL)` cells are filled; the
 * rest are outlined. No banding — pi only gives us a single
 * authoritative "tokens in context" figure, so anything finer would
 * be a lie. We do floor at 1 filled cell whenever `used > 0` so even
 * a tiny prefix shows up rather than rounding to zero.
 */
function Grid({
  session,
  model,
}: {
  session: Session
  model: ModelInfo | null
}) {
  const ctx = session.stats.contextUsage
  const cw = ctx?.contextWindow ?? model?.contextWindow ?? null
  const used = ctx?.tokens ?? 0
  const percent = cw && cw > 0 ? used / cw : 0

  const usedCells = useMemo(() => {
    if (!cw || cw <= 0 || used <= 0) return 0
    const exact = percent * GRID_TOTAL
    return Math.max(1, Math.min(GRID_TOTAL, Math.round(exact)))
  }, [cw, used, percent])

  const tone =
    percent > 0.9 ? "danger" : percent > 0.7 ? "warning" : "default"
  const fillClass =
    tone === "danger"
      ? "bg-destructive/80"
      : tone === "warning"
        ? "bg-yellow-500/80"
        : "bg-muted-foreground/60"

  return (
    <div className="px-3 py-3">
      <div
        className="grid"
        style={{
          gap: 2,
          gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: GRID_TOTAL }).map((_, i) => (
          <div
            key={i}
            className={
              "aspect-square " +
              (i < usedCells ? fillClass : "border border-border/70")
            }
            style={{ borderRadius: 2 }}
          />
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------- foot -------------------------------- */

function SessionFooter({ session }: { session: Session }) {
  const stats = session.stats
  const cacheTotal = (stats.tokens.cacheRead ?? 0) + (stats.tokens.cacheWrite ?? 0)
  const lines: Array<{ label: string; value: string; title?: string }> = []
  if (stats.tokens.input > 0)
    lines.push({
      label: "Input (cumulative)",
      value: stats.tokens.input.toLocaleString(),
    })
  if (stats.tokens.output > 0)
    lines.push({
      label: "Output (cumulative)",
      value: stats.tokens.output.toLocaleString(),
    })
  if (cacheTotal > 0)
    lines.push({
      label: "Cache R / W",
      value: `${formatTokens(stats.tokens.cacheRead ?? 0)} / ${formatTokens(stats.tokens.cacheWrite ?? 0)}`,
      title: `Read ${stats.tokens.cacheRead?.toLocaleString() ?? 0}\nWritten ${stats.tokens.cacheWrite?.toLocaleString() ?? 0}`,
    })
  if (stats.cost > 0)
    lines.push({ label: "Cost", value: `$${stats.cost.toFixed(4)}` })
  lines.push({
    label: "Auto-compaction",
    value: stats.autoCompactionEnabled ? "on" : "off",
  })
  if (session.leafCount > 0)
    lines.push({ label: "Leaves", value: String(session.leafCount) })
  if (session.lastActivityAt)
    lines.push({
      label: "Last activity",
      value: formatRelative(session.lastActivityAt),
      title: new Date(session.lastActivityAt).toLocaleString(),
    })

  return (
    <div className="mt-auto border-t border-border px-3 py-3">
      <div className="mb-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
        Session
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        {lines.map(line => (
          <div key={line.label} className="contents" title={line.title}>
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="text-right font-mono text-foreground">{line.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/* -------------------------------- helpers ------------------------------- */

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
      {children}
    </div>
  )
}

/** Same scheme pi's footer uses (see chat-stats-status-item). */
function formatTokens(count: number): string {
  if (count < 1000) return count.toString()
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`
  return `${Math.round(count / 1000000)}M`
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 0) return "just now"
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/* -------------------------- active session walk ------------------------- */

/** Same walk as pi-event-log: active window → active workspace →
 * active pane → active tab → chat → session. Null while no chat is
 * selected or the session is still pending. */
function useActiveSessionId(): string | null {
  return useDb(root => {
    const ws = Object.values(root.app.windowStates).find(
      s => s.selectedWorkspaceId != null,
    )
    if (!ws) return null
    const workspaceId = ws.selectedWorkspaceId
    if (!workspaceId) return null
    const paneState = ws.workspacePanes?.[workspaceId]
    if (!paneState) return null
    const pane =
      paneState.panes.find(p => p.id === paneState.activePaneId) ??
      paneState.panes[0]
    if (!pane) return null
    const tab = pane.tabs.find(t => t.id === pane.activeTabId) ?? pane.tabs[0]
    if (!tab || tab.content.kind !== "chat") return null
    const chatId = tab.content.chatId
    if (!chatId) return null
    const chat = root.app.chats[chatId]
    if (!chat) return null
    return chat.session.kind === "ready" ? chat.session.sessionId : null
  })
}

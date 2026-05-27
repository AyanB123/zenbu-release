import { useMemo } from "react";
import { useDb, type ViewComponentProps } from "@zenbujs/core/react";
import { HoverTip } from "@zenbu/ui/hover-tip";

/**
 * Component-mode view for the right-sidebar context-window
 * visualizer.
 *
 * Resolves the "active session" off the host's DB:
 *  - prefer the chat focused in this window's active pane;
 *  - fall back to a chat visible in another pane of the same
 *    window;
 *  - last-ditch, walk every other window the same way.
 *
 * Reads `session.stats` + `app.models` straight off the replica,
 * so first paint is synchronous and updates as the agent
 * streams.
 *
 * Because this is a component view we share the host's React
 * tree, theme, and CSS scope — no `useThemeSync()` shim needed.
 */

type ContextSidebarArgs = {
  windowId?: string | null;
  scopeId?: string | null;
  directory?: string | null;
};

export default function ContextSidebarView({
  args,
}: ViewComponentProps<ContextSidebarArgs>) {
  const windowId = args?.windowId ?? null;
  const sessionId = useActiveSessionId(windowId);

  if (!sessionId) {
    return (
      <Placeholder>
        No active session. Open a chat to see its context window.
      </Placeholder>
    );
  }

  return <ContextPane key={sessionId} sessionId={sessionId} />;
}

/* ---------------------------------- pane -------------------------------- */

function ContextPane({ sessionId }: { sessionId: string }) {
  const session = useDb((root) => root.app.sessions[sessionId] ?? null);
  const modelInfo = useDb((root) => {
    const s = root.app.sessions[sessionId];
    if (!s?.model) return null;
    const key = `${s.model.provider}:${s.model.id}`;
    return root.app.models[key] ?? null;
  });

  if (!session) {
    return <Placeholder>Session not found.</Placeholder>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <Header session={session} model={modelInfo} />
      <Grid session={session} model={modelInfo} />
      <SessionFooter session={session} />
    </div>
  );
}

/* --------------------------------- header ------------------------------- */

// Local, structural mirrors of the host's session/model shapes.
// We can't import `Schema` from `plugins/app` because this plugin
// is a separate package; instead we narrow to just the fields
// these helpers actually read off the replica.
type SessionLike = {
  title?: string | null;
  model?: { provider: string; id: string } | null;
  stats: {
    contextUsage?: {
      tokens?: number | null;
      percent?: number | null;
      contextWindow?: number | null;
    } | null;
    tokens: {
      input: number;
      output: number;
      cacheRead?: number | null;
      cacheWrite?: number | null;
    };
    cost: number;
    autoCompactionEnabled: boolean;
  };
  leafCount: number;
  lastActivityAt?: number | null;
};
type ModelLike = { name?: string | null; contextWindow?: number | null };

function Header({
  session,
  model,
}: {
  session: SessionLike;
  model: ModelLike | null;
}) {
  const stats = session.stats;
  const ctx = stats.contextUsage;

  const title = session.title?.trim() || "Untitled session";
  const modelName = model?.name ?? session.model?.id ?? "Unknown model";
  const cw = ctx?.contextWindow ?? model?.contextWindow ?? null;

  const used = ctx?.tokens ?? null;
  const percent = ctx?.percent ?? null;

  let tone: "default" | "warning" | "danger" = "default";
  if (percent != null) {
    if (percent > 90) tone = "danger";
    else if (percent > 70) tone = "warning";
  }

  return (
    <div className="border-b border-border px-3 pt-3 pb-2.5">
      <HoverTip label={title} setAriaLabel={false}>
        <div className="truncate text-[11px] font-medium text-muted-foreground">
          {title}
        </div>
      </HoverTip>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <HoverTip label={modelName} setAriaLabel={false}>
          <span className="truncate text-[13px] font-semibold text-foreground">
            {modelName}
          </span>
        </HoverTip>
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
  );
}

/* ---------------------------------- grid -------------------------------- */

const GRID_COLS = 22;
const GRID_ROWS = 11;
const GRID_TOTAL = GRID_COLS * GRID_ROWS;

function Grid({
  session,
  model,
}: {
  session: SessionLike;
  model: ModelLike | null;
}) {
  const ctx = session.stats.contextUsage;
  const cw = ctx?.contextWindow ?? model?.contextWindow ?? null;
  const used = ctx?.tokens ?? 0;
  const percent = cw && cw > 0 ? used / cw : 0;

  const usedCells = useMemo(() => {
    if (!cw || cw <= 0 || used <= 0) return 0;
    const exact = percent * GRID_TOTAL;
    return Math.max(1, Math.min(GRID_TOTAL, Math.round(exact)));
  }, [cw, used, percent]);

  const tone =
    percent > 0.9 ? "danger" : percent > 0.7 ? "warning" : "default";
  const fillClass =
    tone === "danger"
      ? "bg-destructive/80"
      : tone === "warning"
        ? "bg-yellow-500/80"
        : "bg-muted-foreground/60";

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
  );
}

/* ---------------------------------- foot -------------------------------- */

function SessionFooter({ session }: { session: SessionLike }) {
  const stats = session.stats;
  const cacheTotal =
    (stats.tokens.cacheRead ?? 0) + (stats.tokens.cacheWrite ?? 0);
  const lines: Array<{ label: string; value: string; title?: string }> = [];
  if (stats.tokens.input > 0)
    lines.push({
      label: "Input (cumulative)",
      value: stats.tokens.input.toLocaleString(),
    });
  if (stats.tokens.output > 0)
    lines.push({
      label: "Output (cumulative)",
      value: stats.tokens.output.toLocaleString(),
    });
  if (cacheTotal > 0)
    lines.push({
      label: "Cache R / W",
      value: `${formatTokens(stats.tokens.cacheRead ?? 0)} / ${formatTokens(stats.tokens.cacheWrite ?? 0)}`,
      title: `Read ${stats.tokens.cacheRead?.toLocaleString() ?? 0}\nWritten ${stats.tokens.cacheWrite?.toLocaleString() ?? 0}`,
    });
  if (stats.cost > 0)
    lines.push({ label: "Cost", value: `$${stats.cost.toFixed(4)}` });
  lines.push({
    label: "Auto-compaction",
    value: stats.autoCompactionEnabled ? "on" : "off",
  });
  if (session.leafCount > 0)
    lines.push({ label: "Leaves", value: String(session.leafCount) });
  if (session.lastActivityAt)
    lines.push({
      label: "Last activity",
      value: formatRelative(session.lastActivityAt),
      title: new Date(session.lastActivityAt).toLocaleString(),
    });

  return (
    <div className="mt-auto border-t border-border px-3 py-3">
      <div className="mb-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
        Session
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        {lines.map((line) => (
          // `display: contents` so dt/dd participate directly in the
          // parent grid — the wrapping div has no box and can't
          // receive hover, so we wrap dt + dd individually in
          // HoverTip whenever there's an explanatory `line.title`.
          <div key={line.label} className="contents">
            <HoverTip label={line.title} setAriaLabel={false}>
              <dt className="text-muted-foreground">{line.label}</dt>
            </HoverTip>
            <HoverTip label={line.title} setAriaLabel={false}>
              <dd className="text-right font-mono text-foreground">
                {line.value}
              </dd>
            </HoverTip>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* -------------------------------- helpers ------------------------------- */

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
      {children}
    </div>
  );
}

/** Same scheme pi's footer uses (see chat-stats-status-item). */
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/* -------------------------- active session walk ------------------------- */

/**
 * Inlined active-chat resolver. Mirrors the host's
 * `resolveActiveChatIdInAnyWindow`: prefer this window's active
 * chat, then walk panes, then fall back to any window.
 *
 * Re-implemented here (rather than imported from `@/lib/...`)
 * because this plugin lives in its own package and doesn't
 * resolve host-internal modules.
 */
function useActiveSessionId(windowId: string | null): string | null {
  return useDb((root) => {
    const chatId = resolveActiveChatId(root, windowId);
    if (!chatId) return null;
    const chat = root.app.chats[chatId];
    if (!chat) return null;
    return chat.session.kind === "ready" ? chat.session.sessionId : null;
  });
}

function resolveActiveChatId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root: any,
  windowId: string | null,
): string | null {
  const windows = root.app.windowStates as Record<string, any>;
  const order: any[] = [];
  if (windowId && windows[windowId]) order.push(windows[windowId]);
  for (const ws of Object.values(windows)) {
    if (!ws) continue;
    if (windowId && ws === windows[windowId]) continue;
    order.push(ws);
  }
  for (const ws of order) {
    if (!ws || ws.activeView?.kind !== "workspace") continue;
    const scopeId = ws.selectedScopeId as string | null;
    const paneState = scopeId ? ws.scopePanes?.[scopeId] : null;
    if (paneState) {
      const activePane =
        paneState.panes.find((p: any) => p.id === paneState.activePaneId) ??
        paneState.panes[0];
      const activeTab =
        activePane?.tabs.find((t: any) => t.id === activePane.activeTabId) ??
        activePane?.tabs[0];
      const direct = chatIdOf(activeTab);
      if (direct) return direct;
      for (const pane of paneState.panes) {
        const tab =
          pane.tabs.find((t: any) => t.id === pane.activeTabId) ?? pane.tabs[0];
        const id = chatIdOf(tab);
        if (id) return id;
      }
      for (const pane of paneState.panes) {
        for (const tab of pane.tabs) {
          const id = chatIdOf(tab);
          if (id) return id;
        }
      }
    }
    // Last-ditch: newest chat in the workspace.
    const workspaceId = ws.activeView.workspaceId as string | null;
    if (!workspaceId) continue;
    const workspaceScopes = new Set<string>();
    for (const scope of Object.values(root.app.scopes) as any[]) {
      if (scope.workspaceId === workspaceId) workspaceScopes.add(scope.id);
    }
    let latestId: string | null = null;
    let latestAt = -Infinity;
    for (const chat of Object.values(root.app.chats) as any[]) {
      if (!workspaceScopes.has(chat.scopeId)) continue;
      if (chat.createdAt > latestAt) {
        latestAt = chat.createdAt;
        latestId = chat.id;
      }
    }
    if (latestId) return latestId;
  }
  return null;
}

function chatIdOf(tab: any): string | null {
  if (!tab) return null;
  return tab.content?.kind === "chat" ? tab.content.chatId ?? null : null;
}

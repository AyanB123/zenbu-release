import { HoverTip } from "@zenbu/ui/hover-tip";
import { useDb, useRpc } from "@zenbujs/core/react";

const DEFAULT_WINDOW_ID = "main";

/**
 * Read the current window id from the URL the same way the host
 * does (`?windowId=…` stamped by `WindowService.openView`). Falls
 * back to `"main"` for legacy / test mounts. Inlined here so the
 * plugin doesn't have to import anything from the host.
 */
function getWindowId(): string {
  if (typeof window === "undefined") return DEFAULT_WINDOW_ID;
  const fromUrl = new URLSearchParams(window.location.search).get("windowId");
  return fromUrl && fromUrl.length > 0 ? fromUrl : DEFAULT_WINDOW_ID;
}

/**
 * Workspace-rail gear button. Mounted by the host's
 * `<WorkspaceRail footer>` slot via `<View name="settings-rail-button" />`.
 *
 * Click → routed through the host's `app.openSettings` event
 * (same path used by ⌘, and the command palette). The host's
 * `openSettingsInRoot` then decides:
 *   - On a workspace: append a `settings` tab to the active pane,
 *     leaving `activeView` untouched so the user stays in their
 *     workspace.
 *   - On onboarding (or anything else without panes to host a
 *     tab): flip `activeView` to the workspace-less
 *     `{ kind: "view", viewType: "settings" }` state.
 *
 * We dispatch via `rpc.app["app-shortcuts"].openSettings()` instead
 * of mutating `activeView` here so this button, ⌘,, and the
 * palette share one implementation and one set of edge cases.
 *
 * Sized to match the plugins rail button + the workspace tiles
 * (36×36, accent bar inset 6px top/bottom) so the rail column
 * reads as a single consistent strip.
 *
 * Implemented as a raw `<button>` rather than the shadcn `Button`
 * because the latter ships a `focus-visible:ring-[3px]
 * focus-visible:ring-ring/50` glow that fires for a frame after
 * every click (focus is retained for keyboard accessibility) and
 * tailwind-merge can't reliably dedupe it against an override
 * that uses arbitrary values. The accent bar on the left already
 * signals active state — we don't need an extra focus ring.
 */
export default function SettingsRailButton() {
  const windowId = getWindowId();
  const rpc = useRpc();
  // "Active" here only means the workspace-less settings view is
  // currently up (the onboarding path). When settings is open as
  // a tab inside a workspace's panes we deliberately don't light
  // up the rail button — there can be many tabs open at once and
  // the rail isn't the right surface to surface that.
  const isActive = useDb((root) => {
    const ws = root.app.windowStates[windowId];
    if (!ws) return false;
    return (
      ws.activeView.kind === "view" && ws.activeView.viewType === "settings"
    );
  });

  const handleClick = () => {
    void rpc.app["app-shortcuts"].openSettings();
  };

  return (
    <HoverTip label="Settings" setAriaLabel={false}>
      <div className="relative">
        <span
          aria-hidden
          className="absolute"
          style={{
            left: -6,
            top: 6,
            bottom: 6,
            width: 3,
            borderRadius: 2,
            background: isActive ? "var(--foreground)" : "transparent",
          }}
        />
        <button
          type="button"
          onClick={handleClick}
          aria-label="Settings"
          aria-pressed={isActive}
          className={
            "flex h-9 w-9 items-center justify-center rounded-lg border p-0 transition-colors " +
            (isActive
              ? "bg-card text-foreground border-border"
              : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]")
          }
        >
          <SettingsIcon />
        </button>
      </div>
    </HoverTip>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

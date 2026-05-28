import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import { createRoot } from "react-dom/client"
import { useDb, useRpc, ZenbuProvider } from "@zenbujs/core/react"

/**
 * Plugin-dev onboarding surfaces.
 *
 * Renders three things into every entrypoint window, all gated on
 * cheap reads so a normal workspace window pays close to zero:
 *
 *  1. **Plugin workspace modal** \u2014 one-time popover that fires
 *     when the user opens a window whose active scope is tagged
 *     with `pluginName` (the marketplace-spawned "Open in
 *     Workspace" path). Explains what this window is for. Has a
 *     "Don't show again" toggle persisted via the plugin-dev
 *     service's prefs file.
 *
 *  2. **Plugin dev modal** \u2014 fires once when the host boots as
 *     a sandboxed dev instance (i.e. `root.pluginDev.devMode ===
 *     true`, set by the service when `--zen-plugin-dev=1` is on
 *     argv). Explains that this is an isolated test run.
 *
 *  3. **Dev-mode border** \u2014 dashed yellow frame around the
 *     entire viewport whenever `devMode` is true. Not dismissable:
 *     it's a constant "you're in a test instance" indicator.
 *
 * Dismissed state lives in `~/.zenbu/.internal/plugin-dev-prefs.json`
 * (not the DB) so it's shared between the parent and any sandbox
 * child, which have separate DBs.
 */

type ModalPrefs = {
  dismissedWorkspaceModal: boolean
  dismissedDevModal: boolean
}

function getQueryWindowId(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get("windowId")
  } catch {
    return null
  }
}

function PluginDevSurface() {
  const rpc = useRpc()
  const windowId = useMemo(getQueryWindowId, [])

  // ---- read what context we're in ----------------------------------------

  // `devMode` is written by the plugin-dev service at boot when
  // it sees `--zen-plugin-dev=1` on argv. We read it here straight
  // from this plugin's DB section so the surface paints on first
  // render without a round-trip.
  const devMode = useDb(root => !!root.pluginDev?.devMode)

  // Is the active workspace a plugin-source workspace? We follow
  // the windowState's active view, find its workspace, and check
  // `kind === "plugin"`. Per-plugin workspaces opened from the
  // marketplace are tagged this way by `ensurePluginWorkspace`.
  const isPluginWorkspace = useDb(root => {
    if (!windowId) return false
    const win = root.app?.windowStates?.[windowId]
    const view = win?.activeView
    if (!view || view.kind !== "workspace") return false
    const ws = root.app?.workspaces?.[view.workspaceId]
    return !!ws && ws.kind === "plugin"
  })

  // ---- prefs -------------------------------------------------------------

  const [prefs, setPrefs] = useState<ModalPrefs | null>(null)

  useEffect(() => {
    let cancelled = false
    void rpc.pluginDev.pluginDev.getModalPrefs().then(p => {
      if (!cancelled) setPrefs(p)
    })
    return () => {
      cancelled = true
    }
  }, [rpc])

  const dismiss = useCallback(
    async (key: "workspace" | "dev") => {
      try {
        const next = await rpc.pluginDev.pluginDev.dismissModal({ key })
        setPrefs(next)
      } catch (err) {
        console.error("[plugin-dev] dismissModal failed:", err)
      }
    },
    [rpc],
  )

  // ---- decide what to render --------------------------------------------

  // Local "x out the modal for this session" toggle. We never need
  // to surface it across sessions because the modal already has a
  // "don't show again" button \u2014 plain close just hides until the
  // next launch.
  const [sessionClosed, setSessionClosed] = useState<{
    workspace: boolean
    dev: boolean
  }>({ workspace: false, dev: false })

  // Dev modal takes priority over workspace modal because a dev
  // instance window is by definition NOT the workspace window the
  // marketplace opened. Even if both flags were true (shouldn't
  // happen) showing the dev one first is the right message.
  const showDevModal =
    devMode &&
    prefs !== null &&
    !prefs.dismissedDevModal &&
    !sessionClosed.dev
  const showWorkspaceModal =
    !devMode &&
    isPluginWorkspace &&
    prefs !== null &&
    !prefs.dismissedWorkspaceModal &&
    !sessionClosed.workspace

  return (
    <>
      {devMode && <DevModeBorder />}
      {showDevModal && (
        <OnboardingModal
          title="Testing your plugin"
          body="This window is running your plugin in an isolated sandbox so you can try it out."
          onClose={() => setSessionClosed(s => ({ ...s, dev: true }))}
          onDismissForever={() => void dismiss("dev")}
        />
      )}
      {showWorkspaceModal && (
        <OnboardingModal
          title="Plugin workspace"
          body="This is your editing space for the plugin. Use the buttons in the title bar to test it and to install it into your main app."
          onClose={() =>
            setSessionClosed(s => ({ ...s, workspace: true }))
          }
          onDismissForever={() => void dismiss("workspace")}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Visual chrome
//
// We add a real CSS border to `<body>` rather than overlaying a
// fixed-position div, so the border actually consumes layout
// space: the app content reflows inward by the border width and
// nothing has to fight a z-index war with the title bar / popovers.
// `box-sizing: border-box` on body keeps the 100vw/100vh sizing
// the index.html stylesheet sets up; `#root`'s `width: 100%` then
// resolves to body's content box, shifting everything inside in
// lockstep with the border.

const DEV_BORDER_STYLE_ID = "plugin-dev-border-style"

function DevModeBorder() {
  useEffect(() => {
    if (document.getElementById(DEV_BORDER_STYLE_ID)) return
    const style = document.createElement("style")
    style.id = DEV_BORDER_STYLE_ID
    style.textContent = `
      body {
        box-sizing: border-box;
        border: 3px dashed #f5a524;
      }
    `
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, [])
  return null
}

function OnboardingModal({
  title,
  body,
  onClose,
  onDismissForever,
}: {
  title: string
  body: string
  onClose: () => void
  onDismissForever: () => void
}) {
  // Dismiss-forever also closes the modal for this session. We do
  // the close *first* so the visual response feels immediate; the
  // RPC write to the prefs file completes async in the background.
  const handleDismissForever = useCallback(() => {
    onClose()
    onDismissForever()
  }, [onClose, onDismissForever])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.45)",
      }}
    >
      <div
        className="rounded-lg border border-border bg-background p-5 shadow-2xl"
        style={{ width: 380, maxWidth: "calc(100vw - 32px)" }}
      >
        <div className="text-[14px] font-semibold text-foreground">
          {title}
        </div>
        <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
          {body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleDismissForever}
            className="text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            Don&apos;t show again
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-foreground/[0.04] px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-foreground/[0.08]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mount once. Idempotency guard so HMR re-injection doesn't double-mount.

function mount() {
  if (document.body?.dataset.pluginDevMounted === "1") return
  if (document.body) document.body.dataset.pluginDevMounted = "1"

  const host = document.createElement("div")
  host.setAttribute("data-plugin-dev", "1")
  document.body.appendChild(host)

  createRoot(host).render(
    <StrictMode>
      <ZenbuProvider>
        <PluginDevSurface />
      </ZenbuProvider>
    </StrictMode>,
  )
}

mount()

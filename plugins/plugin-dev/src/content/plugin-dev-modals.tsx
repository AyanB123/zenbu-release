import {
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
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
 *  1. **Plugin workspace tour** \u2014 one-time two-step walkthrough
 *     that fires when the user opens a window whose active scope is
 *     tagged with `pluginName` (the marketplace-spawned "Create
 *     Plugin" path). Because the plugin-workspace concept is
 *     confusing on a first encounter, it dims the live app, cuts a
 *     spotlight around the real title-bar controls, and points a
 *     short explainer bubble at each one. "Don't show again" only
 *     appears on the final step, persisted via the plugin-dev
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
        <OnScreenTour
          steps={WORKSPACE_STEPS}
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
// Step content

type OnboardingTarget = "run-in-dev" | "install-plugin"

type WorkspaceTourStep = {
  eyebrow: string
  title: string
  body: string
  target: OnboardingTarget
}

const WORKSPACE_STEPS: WorkspaceTourStep[] = [
  {
    eyebrow: "Step 1 of 2",
    title: "Run it safely",
    body:
      "This button launches your plugin in an isolated copy of the app, so you can try changes without affecting your main workspace.",
    target: "run-in-dev",
  },
  {
    eyebrow: "Step 2 of 2",
    title: "Install when it works",
    body:
      "When you're happy with the test run, install the plugin into your local Zenbu config from here.",
    target: "install-plugin",
  },
]

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

function cnDots(active: boolean): string {
  return [
    "h-1.5 rounded-full transition-all duration-200",
    active ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30",
  ].join(" ")
}

type TourRect = {
  top: number
  left: number
  width: number
  height: number
}

const TOUR_TARGET_STYLE_ID = "plugin-dev-tour-target-style"

function useTargetRect(
  target: OnboardingTarget,
  active: boolean,
): TourRect | null {
  const [rectState, setRectState] = useState<{
    target: OnboardingTarget
    rect: TourRect | null
  } | null>(null)

  useLayoutEffect(() => {
    if (!active) return

    setRectState(current =>
      current?.target === target ? current : { target, rect: null },
    )
    let activeEl: HTMLElement | null = null
    let frame = 0
    const selector = `[data-onboarding-target="${target}"]`

    const style = document.createElement("style")
    style.id = TOUR_TARGET_STYLE_ID
    style.textContent = `
      [data-plugin-dev-tour-active="true"] {
        position: relative !important;
        z-index: 2147483646 !important;
        isolation: isolate;
        outline: 1px solid var(--ring) !important;
        outline-offset: 2px;
        box-shadow:
          0 0 0 4px var(--background),
          0 0 0 5px var(--border),
          0 10px 28px rgb(0 0 0 / 0.22) !important;
      }
    `
    document.head.appendChild(style)

    const clearActive = () => {
      if (!activeEl) return
      activeEl.removeAttribute("data-plugin-dev-tour-active")
      activeEl = null
    }

    const measure = () => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(selector),
      )
      const visible = candidates
        .map(el => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth,
        )
        .sort(
          (a, b) =>
            b.rect.width * b.rect.height - a.rect.width * a.rect.height,
        )

      const next = visible[0]
      if (!next) {
        clearActive()
        setRectState({ target, rect: null })
        return
      }

      if (activeEl !== next.el) {
        clearActive()
        activeEl = next.el
        activeEl.setAttribute("data-plugin-dev-tour-active", "true")
      }

      setRectState({
        target,
        rect: {
          top: Math.round(next.rect.top),
          left: Math.round(next.rect.left),
          width: Math.round(next.rect.width),
          height: Math.round(next.rect.height),
        },
      })
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    const observer = new ResizeObserver(schedule)
    observer.observe(document.body)
    const id = window.setInterval(measure, 250)
    return () => {
      clearActive()
      style.remove()
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
      window.clearInterval(id)
    }
  }, [active, target])

  return rectState?.target === target ? rectState.rect : null
}

/**
 * On-screen product tour for the plugin workspace. It dims the app around the
 * real title-bar control, keeps that control undimmed, and points a short
 * callout at it.
 */
function OnScreenTour({
  steps,
  onClose,
  onDismissForever,
}: {
  steps: WorkspaceTourStep[]
  onClose: () => void
  onDismissForever: () => void
}) {
  const [index, setIndex] = useState(0)
  const [entered, setEntered] = useState(false)
  const step = steps[index]!
  const isLast = index === steps.length - 1
  const targetRect = useTargetRect(step.target, true)

  useEffect(() => {
    if (!targetRect || entered) return
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [entered, targetRect])

  const handleDismissForever = useCallback(() => {
    onClose()
    onDismissForever()
  }, [onClose, onDismissForever])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isLast) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isLast, onClose])

  if (!targetRect) return null

  const bubble = getBubblePosition(targetRect)
  const targetPoint = getTargetEdgePoint(targetRect, bubble.side, step.target)
  const bubblePoint = getBubbleEdgePoint(bubble, step.target)
  const arrowPath = getArrowPath(bubblePoint, targetPoint)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        pointerEvents: "none",
      }}
    >
      <Backdrop rect={targetRect} />

      {targetRect && (
        <svg
          aria-hidden
          className="pointer-events-none fixed inset-0 text-muted-foreground"
          style={{
            zIndex: 2,
            width: "100vw",
            height: "100vh",
            overflow: "visible",
            opacity: entered ? 1 : 0,
            transition:
              "opacity 220ms ease-out",
          }}
        >
          <path
            d={arrowPath}
            fill="none"
            stroke="var(--background)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transition: "d 420ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
          <path
            d={arrowPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.82"
            style={{
              transition: "d 420ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
          <ArrowHead from={bubblePoint} to={targetPoint} />
        </svg>
      )}

      <div
        className="rounded-xl border border-border bg-background p-4 shadow-2xl"
        style={{
          position: "fixed",
          zIndex: 3,
          pointerEvents: "auto",
          left: bubble.left,
          top: bubble.top,
          width: bubble.width,
          maxWidth: "calc(100vw - 32px)",
          opacity: entered ? 1 : 0,
          transform: entered ? "translateY(0) scale(1)" : "translateY(-6px) scale(0.98)",
          transition:
            "left 420ms cubic-bezier(0.22, 1, 0.36, 1), top 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out, transform 220ms ease-out",
        }}
      >
        {step.eyebrow && (
          <div className="text-[12px] font-medium text-primary">
            {step.eyebrow}
          </div>
        )}
        <div className="mt-1 text-[15px] font-semibold text-foreground">
          {step.title}
        </div>
        <p className="mt-2 h-[76px] text-[12.5px] leading-relaxed text-muted-foreground">
          {step.body}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex shrink-0 items-center gap-1.5">
            {steps.map((_, i) => (
              <span key={i} aria-hidden className={cnDots(i === index)} />
            ))}
          </div>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {isLast && (
              <button
                type="button"
                onClick={handleDismissForever}
                className="whitespace-nowrap text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                Don&apos;t show again
              </button>
            )}
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex(i => Math.max(0, i - 1))}
                className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLast) onClose()
                else setIndex(i => i + 1)
              }}
              className="min-w-[80px] rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground"
            >
              {isLast ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

type BubblePosition = ReturnType<typeof getBubblePosition>

function getBubbleEdgePoint(
  bubble: BubblePosition,
  _target: OnboardingTarget,
): { x: number; y: number } {
  return {
    x: bubble.anchorX,
    y: bubble.top - 8,
  }
}

function getTargetEdgePoint(
  rect: TourRect,
  _bubbleSide: BubblePosition["side"],
  target: OnboardingTarget,
): { x: number; y: number } {
  const xRatio = target === "run-in-dev" ? 0.58 : 0.42
  return {
    x: rect.left + rect.width * xRatio,
    y: rect.top + rect.height + 8,
  }
}

function getArrowPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const midY = from.y + (to.y - from.y) * 0.56
  return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`
}

function ArrowHead({
  from,
  to,
}: {
  from: { x: number; y: number }
  to: { x: number; y: number }
}) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const length = 10
  const spread = 0.62
  const left = {
    x: to.x - Math.cos(angle - spread) * length,
    y: to.y - Math.sin(angle - spread) * length,
  }
  const right = {
    x: to.x - Math.cos(angle + spread) * length,
    y: to.y - Math.sin(angle + spread) * length,
  }

  return (
    <g
      style={{
        transition: "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <path
        d={`M ${left.x} ${left.y} L ${to.x} ${to.y} L ${right.x} ${right.y}`}
        fill="none"
        stroke="var(--background)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={`M ${left.x} ${left.y} L ${to.x} ${to.y} L ${right.x} ${right.y}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}

function Backdrop({ rect }: { rect: TourRect | null }) {
  if (!rect) {
    return (
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-black/50"
        style={{ zIndex: 0 }}
      />
    )
  }

  const right = Math.max(0, window.innerWidth - rect.left - rect.width)
  const bottom = Math.max(0, window.innerHeight - rect.top - rect.height)

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed left-0 right-0 top-0 bg-black/50"
        style={{ zIndex: 0, height: rect.top }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed left-0 bg-black/50"
        style={{
          zIndex: 0,
          top: rect.top,
          width: rect.left,
          height: rect.height,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed bg-black/50"
        style={{
          zIndex: 0,
          top: rect.top,
          right: 0,
          width: right,
          height: rect.height,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 left-0 right-0 bg-black/50"
        style={{ zIndex: 0, height: bottom }}
      />
    </>
  )
}

function getBubblePosition(rect: TourRect | null): {
  left: number
  top: number
  width: number
  height: number
  side: "below"
  anchorX: number
} {
  const width = Math.min(360, window.innerWidth - 32)
  const height = 198
  if (!rect) {
    return {
      left: 16,
      top: 88,
      width,
      height,
      side: "below",
      anchorX: 16 + width / 2,
    }
  }

  const targetX = rect.left + rect.width / 2
  const left = Math.min(
    window.innerWidth - width - 16,
    Math.max(16, targetX - width / 2),
  )
  const top = Math.min(
    window.innerHeight - height - 16,
    rect.top + rect.height + 58,
  )
  const anchorX = Math.min(left + width - 42, Math.max(left + 42, targetX))
  return { left, top, width, height, side: "below", anchorX }
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

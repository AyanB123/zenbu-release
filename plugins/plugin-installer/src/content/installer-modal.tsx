import {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { createRoot } from "react-dom/client"
import { useEvents, useRpc, ZenbuProvider } from "@zenbujs/core/react"

/**
 * Content-script modal for installing plugins.
 *
 * The modal is hidden by default; it appears when the main service
 * emits `pluginInstaller.openPrompt` (triggered by our palette
 * action). While installing, we stream `installProgress` events into
 * a small log; on `installComplete` / `installError` we settle into
 * a terminal state the user can dismiss.
 *
 * The script mounts a single hidden host node on body — without a
 * shadow root — so the modal picks up the host renderer's Tailwind
 * theme automatically. That matches the pattern used by other
 * content-script plugins in this app (e.g. cm-image-paste).
 */

type Phase =
  | { kind: "idle" }
  | { kind: "installing"; lines: string[] }
  | { kind: "done"; name: string; path: string }
  | { kind: "error"; message: string; lines: string[] }

function InstallerModal() {
  const events = useEvents()
  const rpc = useRpc()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const inputRef = useRef<HTMLInputElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  // ---- subscriptions ----------------------------------------------
  useEffect(() => {
    const offOpen = events.pluginInstaller.openPrompt.subscribe(() => {
      setOpen((wasOpen) => {
        if (!wasOpen) {
          setUrl("")
          setPhase({ kind: "idle" })
        }
        return !wasOpen
      })
    })
    const offProgress = events.pluginInstaller.installProgress.subscribe(
      ({ message }) => {
        setPhase((p) => {
          if (p.kind === "installing")
            return { kind: "installing", lines: [...p.lines, message] }
          if (p.kind === "error")
            return { ...p, lines: [...p.lines, message] }
          return p
        })
      },
    )
    const offDone = events.pluginInstaller.installComplete.subscribe(
      ({ name, path }) => {
        setPhase({ kind: "done", name, path })
      },
    )
    const offErr = events.pluginInstaller.installError.subscribe(
      ({ message }) => {
        setPhase((p) => ({
          kind: "error",
          message,
          lines: p.kind === "installing" ? p.lines : [],
        }))
      },
    )
    return () => {
      offOpen()
      offProgress()
      offDone()
      offErr()
    }
  }, [events])

  // Auto-scroll log + focus input on open.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!logRef.current) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [phase])

  // ---- handlers ---------------------------------------------------
  const close = useCallback(() => {
    setOpen(false)
  }, [])

  const submit = useCallback(async () => {
    if (phase.kind === "installing") return
    const trimmed = url.trim()
    if (!trimmed) return
    setPhase({ kind: "installing", lines: [] })
    try {
      await rpc.pluginInstaller.pluginInstaller.install({ url: trimmed })
      // The `installComplete` event already moved us to `done`.
    } catch {
      // The `installError` event already moved us to `error`.
    }
  }, [phase.kind, rpc, url])

  // Esc closes; Enter submits; both are handled at the modal root
  // so they fire even when focus is on the input.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        close()
      } else if (e.key === "Enter") {
        e.stopPropagation()
        if (phase.kind === "done" || phase.kind === "error") {
          if (phase.kind === "done") close()
          else setPhase({ kind: "idle" })
        } else {
          void submit()
        }
      }
    },
    [close, phase.kind, submit],
  )

  if (!open) return null

  const installing = phase.kind === "installing"

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-start justify-center pt-[18vh] pointer-events-none"
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-label="Install plugin"
        className="pointer-events-auto flex w-[480px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <input
          ref={inputRef}
          type="text"
          value={url}
          disabled={installing}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="git repo"
          className="block w-full bg-transparent px-4 py-3 text-sm outline-none disabled:opacity-60"
        />

        {(phase.kind === "installing" ||
          phase.kind === "error" ||
          phase.kind === "done") && (
          <div
            ref={logRef}
            className="max-h-40 overflow-auto border-t border-border bg-muted/40 px-4 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
          >
            {phase.kind === "done" ? (
              <div className="text-foreground">
                Installed{" "}
                <span className="font-semibold">{phase.name}</span>
              </div>
            ) : (
              <>
                {phase.lines.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))}
                {phase.kind === "error" && (
                  <div className="mt-1 text-destructive">{phase.message}</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function mount() {
  if (document.body?.dataset.pluginInstallerMounted === "1") return
  if (document.body) document.body.dataset.pluginInstallerMounted = "1"

  const host = document.createElement("div")
  host.setAttribute("data-plugin-installer", "1")
  document.body.appendChild(host)

  createRoot(host).render(
    <StrictMode>
      <ZenbuProvider>
        <InstallerModal />
      </ZenbuProvider>
    </StrictMode>,
  )
}

mount()

import { useEffect, useRef } from "react"
import { useRpc, useEvents } from "@zenbujs/core/react"
/**
 * fixme: this should be defined in zenbu.js
 */

/**
 * Browser-side dispatch for the shortcut system. The prelude that core
 * injects into every iframe (including this one — the entrypoint)
 * forwards `keydown`, `focus`, and `focus-context` events up the
 * iframe tree via `postMessage`. At the top, the messages arrive as a
 * `CustomEvent` on `window` with `type === "zenbu:bridge-message"`.
 *
 * This component:
 *
 *   1. Listens for those `CustomEvent`s and fires the matching
 *      `rpc.core.shortcuts.handleKeydown` / `setFocus` calls.
 *   2. Pushes the current binding list down into every direct-child
 *      iframe whenever it changes. Each child's prelude re-broadcasts
 *      to its own grandchildren, so the entire iframe tree converges
 *      without the parent needing to walk it.
 *   3. Tracks the merged active focus-context stack (entrypoint's own
 *      DOM contexts + the deepest focused iframe's contexts) and pushes
 *      it down so iframes can locally filter `preventDefault` by the
 *      current `when` state.
 *
 * The component renders nothing — it's a side-effect-only adapter
 * between the prelude's `postMessage` protocol and the core service.
 */
export function ShortcutBridge() {
  const rpc = useRpc()
  const events = useEvents()
  // Cache the latest bindings so `pushBindings` and the
  // `request-bindings` reply path can share state without re-fetching.
  const lastBindingsRef = useRef<unknown[]>([])
  // Last-known per-iframe contributions to the merged context stack.
  // For the entrypoint we track its own local stack (read from the
  // bubbled `view-focus` event whose chain starts with us). For child
  // iframes, we'd track per-iframe stacks here — but for now the
  // entrypoint's `view-focus` already carries the merged contexts
  // computed by the bubbler in the prelude, so this ref just holds
  // the latest merged stack and re-broadcasts it.
  const lastContextsRef = useRef<string[]>([])

  // 1. Dispatch incoming bridge messages from the prelude.
  useEffect(() => {
    const handle = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { kind: string; [k: string]: unknown }
        | undefined
      if (!detail) return
      if (detail.kind === "zenbu:view-keydown") {
        const contexts = Array.isArray(detail.contexts)
          ? (detail.contexts as string[])
          : []
        // Fire-and-forget; renderer doesn't need to await dispatch.
        void rpc.core.shortcuts
          .handleKeydown({
            input: detail.input as never,
            contexts,
          })
          .catch(() => {})
        return
      }
      if (detail.kind === "zenbu:view-focus") {
        const iframes = (detail.chain as never) ?? []
        const contexts = Array.isArray(detail.contexts)
          ? (detail.contexts as string[])
          : []
        // Cache + broadcast the merged stack so every iframe's prelude
        // can filter `preventDefault` by `when` synchronously. We only
        // re-broadcast when the value actually changed to avoid feedback
        // loops with our own send below.
        const same =
          contexts.length === lastContextsRef.current.length &&
          contexts.every((c, i) => c === lastContextsRef.current[i])
        if (!same) {
          lastContextsRef.current = contexts
          fanoutActiveContexts(contexts)
        }
        void rpc.core.shortcuts
          .setFocus({ iframes, contexts })
          .catch(() => {})
        return
      }
      if (detail.kind === "zenbu:request-bindings") {
        // A freshly-mounted iframe asked for the current bindings.
        // Re-fan the cached list so the request propagates down to it.
        fanoutBindings(lastBindingsRef.current)
        // Also re-broadcast the last-known active context stack so
        // the new iframe doesn't have to wait for the next focus
        // event to start filtering correctly.
        fanoutActiveContexts(lastContextsRef.current)
        return
      }
    }
    window.addEventListener("zenbu:bridge-message", handle as EventListener)
    return () =>
      window.removeEventListener(
        "zenbu:bridge-message",
        handle as EventListener,
      )
  }, [rpc])

  // 2. Push bindings on mount + whenever the service tells us they
  //    changed.
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const list = await rpc.core.shortcuts.bindings()
        if (cancelled) return
        lastBindingsRef.current = list
        fanoutBindings(list)
      } catch {
        // Service may not be ready during the first connection retry;
        // the next `shortcuts.changed` emit will catch us up.
      }
    }
    void refresh()
    const off = events.core.shortcuts.changed.subscribe(() => {
      void refresh()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [rpc, events])

  return null
}

/**
 * Post a `zenbu:bindings` message so every prelude in the document
 * tree caches the current binding list and can `preventDefault()`
 * matching keystrokes synchronously.
 *
 * We send to TWO targets:
 *
 *   1. `window` (self). The top-level entrypoint runs the same
 *      shortcut-bridge prelude as iframes do, and its message handler
 *      caches `bindings` exactly the same way. Without this, the top
 *      window's prelude keeps `bindings = []` for its lifetime, so
 *      its capture-phase keydown listener never calls
 *      `preventDefault` / `stopPropagation` — and any view that
 *      attaches a `keydown` listener while living in the top window
 *      (e.g. a `rendering: "component"` terminal view whose
 *      ghostty-web instance binds to a contenteditable) ends up
 *      receiving the keystroke itself, on top of the shortcut
 *      firing. This was invisible while every keystroke-hungry view
 *      lived in its own iframe.
 *   2. Every direct-child iframe. Each child's prelude relays the
 *      message to its own grandchildren, so the whole tree converges
 *      without us walking it. Cross-origin iframes silently ignore
 *      the post — that's fine; if any plugin ever needs to receive
 *      bindings cross-origin we'd add a targeted origin here.
 */
function fanoutBindings(bindings: unknown): void {
  const msg = { kind: "zenbu:bindings", bindings }
  try { window.postMessage(msg, "*") } catch {}
  const frames = document.querySelectorAll("iframe")
  for (const f of Array.from(frames)) {
    try {
      f.contentWindow?.postMessage(msg, "*")
    } catch {
      // Pre-load iframes or detached frames throw — ignore.
    }
  }
}

/**
 * Post a `zenbu:active-contexts` message so every prelude in the
 * document tree updates its local view of the global focus stack and
 * gates `preventDefault` by `when` correctly. Same two-target shape
 * as `fanoutBindings` — the top window's prelude needs this too,
 * for the same reason.
 */
function fanoutActiveContexts(contexts: string[]): void {
  const msg = { kind: "zenbu:active-contexts", contexts }
  try { window.postMessage(msg, "*") } catch {}
  const frames = document.querySelectorAll("iframe")
  for (const f of Array.from(frames)) {
    try {
      f.contentWindow?.postMessage(msg, "*")
    } catch {
      // ignore detached/pre-load iframes
    }
  }
}

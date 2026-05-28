import { useEffect } from "react"
import { toast } from "sonner"
import { useEvents } from "@zenbujs/core/react"

/**
 * Renderer-side bridge for `events.app.notify`. Subscribes once at
 * mount and forwards each event to the sonner toaster with the
 * matching tone. Lets any main-process service surface a
 * user-visible toast without having to wire its own renderer
 * component \u2014 it just emits an event.
 *
 * Sibling to `AgentCompletionNotifier` / `KilledAgentsWatcher`;
 * mounted under the same `<Suspense>` boundary in `App` so the
 * toaster is already on screen by the time anything fires.
 */
export function NotifyListener() {
  const events = useEvents()
  useEffect(() => {
    const off = events.app.notify.subscribe(({ tone, title, description }) => {
      const fn =
        tone === "error"
          ? toast.error
          : tone === "success"
            ? toast.success
            : tone === "warning"
              ? toast.warning
              : toast.info
      fn(title, description ? { description } : undefined)
    })
    return () => off()
  }, [events])
  return null
}

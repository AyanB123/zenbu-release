import { useEffect, useState } from "react"

/** Tracks every non-null id that's ever been "current" during the lifetime
 * of the calling component. Callers use this to render one element per
 * visited id (wrapped in `<Activity>`) so React's offscreen renderer can
 * keep their state warm. */
export function useVisited(currentId: string | null): Set<string> {
  const [visited, setVisited] = useState<Set<string>>(() =>
    currentId ? new Set([currentId]) : new Set(),
  )
  useEffect(() => {
    if (!currentId) return
    setVisited(prev => {
      if (prev.has(currentId)) return prev
      const next = new Set(prev)
      next.add(currentId)
      return next
    })
  }, [currentId])
  return visited
}

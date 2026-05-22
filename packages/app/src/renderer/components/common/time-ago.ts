import { useEffect, useState } from "react"

export function timeAgo(ts: number | undefined | null): string {
  if (!ts) return ""
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return "now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function useLiveTimeAgo(ts: number | undefined | null): string {
  const [, force] = useState(0)
  useEffect(() => {
    if (!ts) return
    const age = Date.now() - ts
    const interval = age < 60_000 ? 5_000 : age < 3_600_000 ? 30_000 : 300_000
    const id = setInterval(() => force(x => x + 1), interval)
    return () => clearInterval(id)
  }, [ts])
  return timeAgo(ts)
}

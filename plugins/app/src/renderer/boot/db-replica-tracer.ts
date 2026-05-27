/**
 * Dev-only: counts inbound DB replica writes (WS `ch: "db"`) and prints
 * a rolling summary so we can see what's saturating the renderer.
 *
 * Enable with `?dbTrace=1` or `localStorage.zenbuDbTrace = "1"`.
 * Inspect live stats: `window.__zenbuDbTrace.summary()`.
 */
type WriteOp = {
  type: string
  path?: string[]
  collectionId?: string
  data?: unknown[]
}

type DbEvent = {
  kind?: string
  op?: WriteOp
  ops?: WriteOp[]
}

type Bucket = {
  count: number
  items: number
}

declare global {
  interface Window {
    __zenbuDbTrace?: {
      summary: () => Record<string, unknown>
      reset: () => void
    }
  }
}

const collectionLabels = new Map<string, string>()
const buckets = new Map<string, Bucket>()
let totalEvents = 0
let startedAt = 0

function bump(key: string, itemCount = 0) {
  const cur = buckets.get(key) ?? { count: 0, items: 0 }
  cur.count++
  cur.items += itemCount
  buckets.set(key, cur)
}

function labelCollection(collectionId: string, value: unknown) {
  if (value == null || typeof value !== "object") return
  const ref = value as { collectionId?: string; debugName?: string }
  if (ref.collectionId !== collectionId) return
  if (typeof ref.debugName === "string") {
    collectionLabels.set(collectionId, ref.debugName)
  }
}

function recordRootSet(path: string[], value: unknown) {
  if (path.length >= 4 && path[0] === "app" && path[1] === "fileTreeIndexes") {
    const field = path[3]
    if (field === "paths") {
      labelCollection(
        (value as { collectionId?: string })?.collectionId ?? "",
        value,
      )
      bump(`root.fileTreeIndexes.${path[2]}.${field ?? "?"}`)
      return
    }
    bump(`root.fileTreeIndexes.${path[2]}.${field ?? "*"}`)
    return
  }
  if (
    path.length >= 4 &&
    path[0] === "app" &&
    path[1] === "sessions" &&
    path[3] === "eventLog"
  ) {
    labelCollection(
      (value as { collectionId?: string })?.collectionId ?? "",
      value,
    )
    bump(`root.sessions.${path[2]}.eventLog`)
    return
  }
  bump(`root.${path.slice(0, 4).join(".")}`)
}

function recordOp(op: WriteOp) {
  switch (op.type) {
    case "collection.concat": {
      const label =
        collectionLabels.get(op.collectionId ?? "") ??
        op.collectionId?.slice(0, 8) ??
        "?"
      bump(`concat.${label}`, op.data?.length ?? 0)
      break
    }
    case "collection.create":
      bump(`create.${op.collectionId?.slice(0, 8) ?? "?"}`)
      break
    case "collection.delete":
      bump(`delete.${op.collectionId?.slice(0, 8) ?? "?"}`)
      break
    case "root.set":
      if (op.path) recordRootSet(op.path, op.value)
      break
    case "root.delete":
      bump(`delete.root.${op.path?.slice(0, 4).join(".") ?? "?"}`)
      break
    default:
      bump(op.type)
  }
}

function recordEvent(event: DbEvent) {
  if (event.kind === "replicated-write" && event.op) {
    totalEvents++
    recordOp(event.op)
    return
  }
  if (event.kind === "write" && event.op) {
    totalEvents++
    recordOp(event.op)
    return
  }
  if (event.kind === "write-batch" && event.ops) {
    totalEvents += event.ops.length
    for (const op of event.ops) recordOp(op)
  }
}

function printSummary() {
  const elapsed = (performance.now() - startedAt) / 1000
  const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count)
  const top = sorted.slice(0, 12).map(([key, v]) => ({
    key,
    count: v.count,
    items: v.items,
    perSec: +(v.count / Math.max(elapsed, 0.001)).toFixed(1),
  }))
  console.log(
    `[db-trace] ${totalEvents} ops in ${elapsed.toFixed(1)}s (${(totalEvents / Math.max(elapsed, 0.001)).toFixed(1)}/s)`,
    top,
  )
}

export function installDbReplicaTracer(): void {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  const enabled =
    import.meta.env.DEV &&
    params.get("dbTrace") !== "0" &&
    localStorage.getItem("zenbuDbTrace") !== "0"
  if (!enabled) return

  startedAt = performance.now()
  const Orig = WebSocket
  window.WebSocket = class TracedWebSocket extends Orig {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols)
      this.addEventListener("message", (e: MessageEvent) => {
        try {
          const msg = JSON.parse(String(e.data))
          if (msg?.ch === "db" && msg.data) recordEvent(msg.data as DbEvent)
        } catch {
          // ignore non-json
        }
      })
    }
  } as typeof WebSocket

  window.__zenbuDbTrace = {
    summary: () => ({
      elapsedSec: (performance.now() - startedAt) / 1000,
      totalEvents,
      buckets: Object.fromEntries(buckets),
      collectionLabels: Object.fromEntries(collectionLabels),
    }),
    reset: () => {
      buckets.clear()
      totalEvents = 0
      startedAt = performance.now()
    },
  }

  setInterval(printSummary, 2000)
  console.info(
    "[db-trace] enabled — watch console for summaries; window.__zenbuDbTrace.summary()",
  )
}

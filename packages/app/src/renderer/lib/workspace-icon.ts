import { useCallback, useEffect, useState } from "react"
import { useDbClient } from "@zenbujs/core/react"
import type { Schema } from "../../main/schema"

export function useWorkspaceIconUrl(
  icon: Schema["workspaces"][string]["icon"],
): string | null {
  const client = useDbClient()
  const [url, setUrl] = useState<string | null>(null)
  const blobId = icon?.blobId ?? null
  const mimeType = icon?.mimeType ?? "image/png"

  useEffect(() => {
    if (!blobId) {
      setUrl(null)
      return
    }
    let revoke: string | null = null
    let cancelled = false
    void (async () => {
      try {
        const data = await client.getBlobData(blobId)
        if (cancelled || !data) return
        const blob = new Blob([data as BlobPart], { type: mimeType })
        revoke = URL.createObjectURL(blob)
        setUrl(revoke)
      } catch (err) {
        console.error("[workspace-icon] failed to load blob:", err)
      }
    })()
    return () => {
      cancelled = true
      if (revoke) URL.revokeObjectURL(revoke)
      setUrl(null)
    }
  }, [client, blobId, mimeType])

  return url
}

export function useUploadWorkspaceIcon() {
  const client = useDbClient()
  return useCallback(
    async (workspaceId: string, file: File): Promise<void> => {
      const data = new Uint8Array(await file.arrayBuffer())
      const prev =
        client.readRoot().app.workspaces[workspaceId]?.icon ?? null
      const blobId = await client.createBlob(data, true)
      await client.update(root => {
        const ws = root.app.workspaces[workspaceId]
        if (!ws) return
        ws.icon = {
          blobId,
          mimeType: file.type || "image/png",
        }
      })
      if (prev?.blobId) {
        try {
          await client.deleteBlob(prev.blobId)
        } catch (err) {
          console.error("[workspace-icon] deleteBlob failed:", err)
        }
      }
    },
    [client],
  )
}

export function useClearWorkspaceIcon() {
  const client = useDbClient()
  return useCallback(
    async (workspaceId: string): Promise<void> => {
      const prev =
        client.readRoot().app.workspaces[workspaceId]?.icon ?? null
      await client.update(root => {
        const ws = root.app.workspaces[workspaceId]
        if (!ws) return
        ws.icon = null
      })
      if (prev?.blobId) {
        try {
          await client.deleteBlob(prev.blobId)
        } catch (err) {
          console.error("[workspace-icon] deleteBlob failed:", err)
        }
      }
    },
    [client],
  )
}

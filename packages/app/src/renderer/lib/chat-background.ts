import { useCallback, useEffect, useState } from "react"
import { useDb, useDbClient } from "@zenbujs/core/react"
import type { Schema } from "../../main/schema"
/**
 * FIXME
 * 
 * getting a url from a blob should be first class in kyju
 */

export type ChatBackgroundSetting = Schema["settings"]["chatBackground"]

export const DEFAULT_BG_OPACITY = 0.15

export function useChatBackground(): ChatBackgroundSetting {
  return useDb(root => root.app.settings.chatBackground)
}

/**
 * Resolves the blob bytes for the current chat background into an
 * object URL. Returns `null` until the bytes are in. Revokes on swap
 * so we don't leak.
 */
export function useChatBackgroundUrl(
  background: ChatBackgroundSetting,
): string | null {
  const client = useDbClient()
  const [url, setUrl] = useState<string | null>(null)
  const blobId = background?.blobId ?? null
  const mimeType = background?.mimeType ?? "image/png"

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
        console.error("[chat-background] failed to load blob:", err)
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

/**
 * Set or clear the chat background meta. When `next` is `null` we also
 * call `client.deleteBlob` for the previous blobId so we don't leave
 * orphaned bytes lying around.
 */
export function useSetChatBackground() {
  const client = useDbClient()
  return useCallback(
    async (next: ChatBackgroundSetting) => {
      const prev = client.readRoot().app.settings.chatBackground
      await client.update(root => {
        root.app.settings.chatBackground = next
      })
      if (!next && prev?.blobId) {
        try {
          await client.deleteBlob(prev.blobId)
        } catch (err) {
          console.error("[chat-background] deleteBlob failed:", err)
        }
      }
    },
    [client],
  )
}

/**
 * Upload a new image. `client.createBlob` is the framework's primitive
 * for ad-hoc blobs not declared as a schema field — it stores the bytes
 * and returns a stable id we keep alongside the rest of the meta in the
 * settings record. (We can't declare this as a schema `blob()` field
 * because the kyju migrator currently crashes when initialising blob
 * fields added by an incremental migration.)
 */
export function useUploadChatBackground() {
  const client = useDbClient()
  return useCallback(
    async (file: File, opacity: number): Promise<void> => {
      const data = new Uint8Array(await file.arrayBuffer())
      const prev = client.readRoot().app.settings.chatBackground
      const blobId = await client.createBlob(data, true)
      await client.update(root => {
        root.app.settings.chatBackground = {
          blobId,
          mimeType: file.type || "image/png",
          opacity,
        }
      })
      if (prev?.blobId) {
        try {
          await client.deleteBlob(prev.blobId)
        } catch (err) {
          console.error("[chat-background] deleteBlob (replace) failed:", err)
        }
      }
    },
    [client],
  )
}

import { useEffect, useState, type ComponentType, type ReactElement } from "react"
import { markBoot } from "./boot-trace"

type AppLoader = () => Promise<ComponentType>

type DeferredAppProps = {
  fallback: ReactElement
  load: AppLoader
}

function afterSkeletonPaint(callback: () => void): () => void {
  let firstFrame = 0
  let secondFrame = 0

  firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(callback)
  })

  return () => {
    cancelAnimationFrame(firstFrame)
    cancelAnimationFrame(secondFrame)
  }
}

export function DeferredApp({ fallback, load }: DeferredAppProps): ReactElement {
  const [App, setApp] = useState<ComponentType | null>(null)

  useEffect(() => {
    let cancelled = false

    const cancelFrame = afterSkeletonPaint(() => {
      markBoot("app-import-start")
      void load().then((LoadedApp) => {
        if (cancelled) return
        markBoot("app-import-done")
        setApp(() => LoadedApp)
      })
    })

    return () => {
      cancelled = true
      cancelFrame()
    }
  }, [load])

  return App ? <App /> : fallback
}

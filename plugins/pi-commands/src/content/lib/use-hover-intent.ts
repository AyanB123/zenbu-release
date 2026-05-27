import { useEffect, useRef } from "react"

export function useHoverIntent(): {
  isActive: () => boolean
  resetToKeyboard: () => void
} {
  const activeRef = useRef(false)
  useEffect(() => {
    const onMove = () => {
      activeRef.current = true
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [])
  return {
    isActive: () => activeRef.current,
    resetToKeyboard: () => {
      activeRef.current = false
    },
  }
}

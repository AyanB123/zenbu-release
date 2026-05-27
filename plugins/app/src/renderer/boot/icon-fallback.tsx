import { useEffect, type ReactElement } from "react"
import iconUrl from "../icon.png"
import { markBoot } from "./boot-trace"

/**
 * Shown by `ZenbuProvider` while the WS connection is establishing and as
 * the React fallback before the real `<App />` mounts. Visually identical
 * to the centered icon painted in `index.html`'s initial `#root` content
 * and in `splash.html`, so the user sees one continuous image from window
 * open through to first real-app render — no skeleton flash.
 */
export function IconFallback(): ReactElement {
  useEffect(() => {
    markBoot("icon-fallback-committed")
    requestAnimationFrame(() => markBoot("icon-fallback-first-frame"))
  }, [])

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Pre-app surface is NOT draggable as a whole — a
        // full-viewport `drag` claim while we're booting (or any
        // time this fallback re-renders, e.g. a transient suspend
        // inside ZenbuProvider) ends up reported to Electron as
        // "the entire window is a title bar", and every subsequent
        // click in the real app becomes a window-move. The drag
        // affordance comes from the 30px strip below, which lines
        // up exactly with <TitleBar />'s own drag rect once the
        // app takes over.
        WebkitAppRegion: "no-drag",
        userSelect: "none",
        WebkitUserSelect: "none",
      } as React.CSSProperties}
    >
      <img
        src={iconUrl}
        alt=""
        style={{
          width: 160,
          height: 160,
          // Match the splash + index.html downsampling so the icon
          // doesn't visually "shift" between paints. The PNG is
          // 1024×1024 — the default bilinear filter renders it
          // slightly softer than `-webkit-optimize-contrast`, so
          // staying consistent here keeps the handoff seamless.
          imageRendering: "-webkit-optimize-contrast",
          pointerEvents: "none",
        } as React.CSSProperties}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          // Matches TITLE_BAR_HEIGHT in components/layout/title-bar.tsx.
          // Hard-coded rather than imported so this file doesn't pull
          // in any non-boot dependencies — if the title bar height
          // ever changes, this constant moves with it.
          height: 30,
          WebkitAppRegion: "drag",
          pointerEvents: "none",
        } as React.CSSProperties}
      />
    </div>
  )
}

import { useEffect, type ReactElement } from "react"
import {
  bootSkeletonRouteFromSearch,
  isWorkspaceSkeletonRoute,
} from "../../shared/boot-skeleton"
import { markBoot } from "./boot-trace"
import { IS_ELECTRON } from "../lib/window-state/has-traffic-lights"

function TitlebarSkeleton(): ReactElement {
  return <div className="h-[30px] shrink-0 border-b border-border/80 bg-sidebar" />
}

function WorkspaceRailSkeleton(): ReactElement {
  return <div className="w-12 shrink-0 border-r border-border/80 bg-sidebar" />
}

function WorkspaceSidebarSkeleton(): ReactElement {
  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-border/80 bg-sidebar">
      <div className="h-[48px] shrink-0 border-b border-border/80" />
      <div className="flex-1" />
    </div>
  )
}

function WorkspaceMainSkeleton(): ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="h-[58px] shrink-0" />
      <div className="min-h-0 flex-1" />
      <div className="mx-4 mb-4 h-48 shrink-0 rounded-xl border border-border/80 bg-card/40" />
      <div className="h-11 shrink-0 border-t border-border/80 bg-muted/35" />
    </div>
  )
}

function FullPaneSkeleton(): ReactElement {
  return <div className="min-w-0 flex-1 bg-background" />
}

function ContentSkeleton(): ReactElement {
  const route = bootSkeletonRouteFromSearch(window.location.search)

  if (!isWorkspaceSkeletonRoute(route)) return <FullPaneSkeleton />

  return (
    <>
      <WorkspaceSidebarSkeleton />
      <WorkspaceMainSkeleton />
    </>
  )
}

export function AppShellSkeleton(): ReactElement {
  useEffect(() => {
    markBoot("app-skeleton-committed")
    requestAnimationFrame(() => markBoot("app-skeleton-first-frame"))
  }, [])

  return (
    <div
      className={
        "flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground" +
        (IS_ELECTRON ? " border border-border/80" : "")
      }
    >
      <TitlebarSkeleton />
      <div className="flex min-h-0 flex-1">
        <WorkspaceRailSkeleton />
        <ContentSkeleton />
      </div>
    </div>
  )
}

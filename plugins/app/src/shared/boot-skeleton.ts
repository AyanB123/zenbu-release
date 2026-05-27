export type BootSkeletonActiveView =
  | { kind: "workspace" }
  | { kind: "onboarding" }
  | { kind: "view"; viewType?: string }

export type BootSkeletonRoute = "workspace" | "onboarding" | `view:${string}`

export function skeletonRouteForActiveView(
  activeView: BootSkeletonActiveView | null | undefined,
): BootSkeletonRoute {
  if (activeView?.kind === "workspace") return "workspace"
  if (activeView?.kind === "view") return `view:${activeView.viewType ?? ""}`
  return "onboarding"
}

export function bootSkeletonRouteFromSearch(search: string): BootSkeletonRoute {
  const route = new URLSearchParams(search).get("skeletonRoute")
  if (route === "workspace") return "workspace"
  if (route?.startsWith("view:")) return route as BootSkeletonRoute
  return "onboarding"
}

export function isWorkspaceSkeletonRoute(route: BootSkeletonRoute): boolean {
  return route === "workspace"
}

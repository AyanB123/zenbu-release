import { View } from "@zenbujs/core/react"

export type PluginSidebarViewProps = {
  viewType: string
  /** Args forwarded into the child view (read via `useViewArgs()`).
   * Currently scope coordinates so views like the git client know
   * which directory the surrounding window is scoped to. */
  args: Record<string, unknown>
}

export function PluginSidebarView({ viewType, args }: PluginSidebarViewProps) {
  return (
    <View
      type={viewType}
      args={args}
      className="size-full"
      fallback={
        <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
          Loading view…
        </div>
      }
    />
  )
}

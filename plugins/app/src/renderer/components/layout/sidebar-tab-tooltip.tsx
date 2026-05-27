import type { ReactNode } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@zenbu/ui/tooltip"
import {
  sidebarViewShortcutId,
  useShortcutBinding,
} from "@/hooks/use-shortcut-bindings"
import { formatBinding } from "@/lib/format-binding"

export type SidebarTabTooltipProps = {
  /** Registered view type, used to reverse-lookup the bound shortcut. */
  viewType: string
  /** Which sidebar this tab is rendered in — the shortcut id is
   *  side-scoped so a view that registers in both sidebars (rare)
   *  gets its own binding per side. */
  kind: "left" | "right"
  /** Display label shown on the first row of the tooltip. */
  label: string
  /** Where the tooltip should pop. Defaults to the side opposite the
   *  sidebar (left tabs → right of the icon, right tabs → left). */
  side?: "left" | "right" | "top" | "bottom"
  /** The icon button. Wrapped in `<TooltipTrigger asChild>` so the
   *  trigger is the button itself, not an extra wrapper element. */
  children: ReactNode
}

/**
 * Tooltip wrapper for a sidebar tab button. Pulls the currently
 * effective binding for the auto-registered `openSidebarView`
 * shortcut and renders it as a second line beneath the label:
 *
 *   ┌─────────────┐
 *   │ Files       │
 *   │ ⌘⇧E         │
 *   └─────────────┘
 *
 * If the user disables the binding (or never set one for a plugin
 * that didn't ship a default), only the label renders — no empty
 * second line.
 *
 * The binding is read through `useShortcutBinding`, which
 * subscribes to both the plugin def list and the user overrides,
 * so the hint stays in sync after a rebind without a reload.
 */
export function SidebarTabTooltip({
  viewType,
  kind,
  label,
  side,
  children,
}: SidebarTabTooltipProps) {
  const binding = useShortcutBinding(sidebarViewShortcutId(viewType, kind))
  const hint = formatBinding(binding)
  const resolvedSide = side ?? (kind === "left" ? "right" : "left")

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={resolvedSide} className="px-2 py-1.5">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[12px] leading-none">{label}</span>
          {hint ? (
            <span className="text-[10.5px] leading-none opacity-70">
              {hint}
            </span>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

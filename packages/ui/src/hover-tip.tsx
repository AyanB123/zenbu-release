import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./tooltip"

export type HoverTipProps = {
  /** Tooltip text. If empty/undefined, the wrapper is a no-op and just renders `children`. */
  label?: React.ReactNode
  /** Optional preferred side. Defaults to Radix's default ("top"). */
  side?: React.ComponentProps<typeof TooltipContent>["side"]
  /** Optional preferred alignment. */
  align?: React.ComponentProps<typeof TooltipContent>["align"]
  /** Per-instance delay override. By default, inherits from TooltipProvider (700ms). */
  delayDuration?: number
  /**
   * If `true` (default), also sets `aria-label` on the trigger child when it
   * doesn't already have one. This preserves the accessible *name* on
   * icon-only controls — Radix only wires `aria-describedby` for description.
   * Pass `false` when the child already has visible text content.
   */
  setAriaLabel?: boolean
  /** Optional content className override. */
  contentClassName?: string
  /** The trigger — must be a single ReactElement (we forward via `asChild`). */
  children: React.ReactElement<{
    "aria-label"?: string
    "aria-labelledby"?: string
  }>
}

/**
 * Hover-triggered tooltip wrapper meant as a drop-in replacement for the
 * native HTML `title` attribute.
 *
 * Usage:
 *   <HoverTip label="Archive">
 *     <button onClick={...}><ArchiveIcon /></button>
 *   </HoverTip>
 *
 * Notes:
 *  - Relies on a single top-level <TooltipProvider> mounted at the app root.
 *  - Inherits the provider's `delayDuration` (700ms) so it feels like native
 *    `title` timing, but with our own styling.
 */
export function HoverTip({
  label,
  side,
  align,
  delayDuration,
  setAriaLabel = true,
  contentClassName,
  children,
}: HoverTipProps) {
  if (label == null || label === "" || label === false) {
    return children
  }

  // For icon-only triggers, give Radix's Slot child an accessible name.
  // We only inject when the child has no aria-label / aria-labelledby and
  // `label` is a plain string we can stringify.
  let trigger = children
  if (
    setAriaLabel &&
    typeof label === "string" &&
    !children.props["aria-label"] &&
    !children.props["aria-labelledby"]
  ) {
    trigger = React.cloneElement(children, { "aria-label": label })
  }

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={contentClassName}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Re-export the Radix portal so callers can colocate the tooltip if they
 * ever need to render it manually instead of through HoverTip.
 */
export const HoverTipPortal = TooltipPrimitive.Portal

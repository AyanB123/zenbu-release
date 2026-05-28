import type { ReactNode } from "react";
import { Button } from "@zenbu/ui/button";
import { HoverTip } from "@zenbu/ui/hover-tip";
import { cn } from "@zenbu/ui/utils";

export type StatusBarItemProps = {
  icon?: ReactNode;
  children?: ReactNode;
  title?: string;
  onClick?: () => void;
  tone?: "default" | "muted" | "success" | "warning" | "danger" | "active";
};

const TONE_TEXT: Record<NonNullable<StatusBarItemProps["tone"]>, string> = {
  default: "text-muted-foreground",
  muted: "text-muted-foreground",
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-red-600",
  active: "text-blue-600",
};

/**
 * Shared shell for a single footer item: hover-tip + small ghost
 * button with optional icon. Re-exported from the pi-footer plugin
 * so first-party items (`scope-info`, `chat-stats`) and contributed
 * items can opt into the same look without each one re-implementing
 * the typography / hover behavior.
 */
export function StatusBarItem({
  icon,
  children,
  title,
  onClick,
  tone = "default",
}: StatusBarItemProps) {
  const interactive = !!onClick;
  return (
    <HoverTip label={title} setAriaLabel={false}>
      <Button
        type="button"
        variant="ghost"
        aria-label={title}
        onClick={onClick}
        disabled={!interactive}
        className={cn(
          "h-auto gap-1 rounded-none px-2 py-0 text-[11px] font-normal disabled:opacity-100",
          TONE_TEXT[tone],
          interactive ? "" : "hover:bg-transparent",
        )}
      >
        {icon && <span className="inline-flex shrink-0 items-center">{icon}</span>}
        {children != null && <span className="truncate">{children}</span>}
      </Button>
    </HoverTip>
  );
}

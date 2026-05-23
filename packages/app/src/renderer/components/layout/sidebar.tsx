import type { ReactNode } from "react";
import { SIDEBAR_FOOTER_FADE, SIDEBAR_FOOTER_HEIGHT } from "./sidebar-footer";

// Reserve space for both the footer slot AND its gradient fade so that
// when the list is scrolled to the bottom, the last row sits above the
// fade instead of being washed out by it. Without the extra fade pad,
// content that *just barely* overflows is permanently dimmed because
// you can't scroll past the end of the content to push the last row
// clear of the gradient.
const SIDEBAR_BODY_BOTTOM_PAD = SIDEBAR_FOOTER_HEIGHT + SIDEBAR_FOOTER_FADE;

export type SidebarProps = {
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  /**
   * `rows` (default): children are stacked inside a scrollable padded box
   * (designed for `SidebarRow` instances). `fill`: children fill the
   * body area edge-to-edge with no padding (designed for plugin
   * iframes mounted via `<View />`).
   */
  bodyVariant?: "rows" | "fill";
  /**
   * When true, drop the sidebar's own `border-l`. Used when the
   * sidebar sits flush against the outer app-shell border (i.e.
   * the workspace rail is hidden) so we don't render a doubled
   * 1px line at the window's left edge.
   */
  flushLeft?: boolean;
};

export function Sidebar({
  header,
  footer,
  children,
  bodyVariant = "rows",
  flushLeft = false,
}: SidebarProps) {
  // The outer app shell owns the bottom-left curve via `overflow-hidden
  // rounded-[10px]`, so we drop our own `rounded-bl-lg` to avoid the
  // double-rounded corner. Our `border-t` draws the 1px seam against
  // the title bar above. We don't use `bg-clip-padding` here — that
  // would expose the parent's `bg-muted` through the border, making
  // the seam render darker than the rest of the app's borders. By
  // letting `bg-sidebar` paint under the border, the border
  // composites against the same kind of light surface every other
  // border in the app sits on.
  return (
    <div
      className={
        "flex flex-1 min-w-0 flex-col overflow-hidden bg-sidebar border-t border-b text-sidebar-foreground" +
        (flushLeft ? "" : " border-l")
      }
    >
      {header && (
        <div
          // No top/bottom padding: the children (LeftSidebarTabBar,
          // divider, SidebarHeaderRow) own their own vertical rhythm,
          // and zero top padding is what makes the tab bar's bottom
          // edge line up with the main-pane chat-tab strip across the
          // TitleBar seam.
          className="flex shrink-0 flex-col gap-0.5 px-1.5 py-0"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {header}
        </div>
      )}
      <div
        className="relative min-h-0 flex-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {bodyVariant === "rows" ? (
          <div
            className="absolute inset-0 overflow-auto"
            style={{ paddingBottom: SIDEBAR_BODY_BOTTOM_PAD }}
          >
            <div className="px-1.5">{children}</div>
          </div>
        ) : (
          <div
            className="absolute inset-0"
            style={{ paddingBottom: SIDEBAR_BODY_BOTTOM_PAD }}
          >
            {children}
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}

import { forwardRef, type Ref, type ReactNode } from "react";
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
  /**
   * Optional focus-context id. When set the sidebar's outer
   * wrapper carries `data-zenbu-focus-context="..."` and becomes
   * keyboard-focusable (`tabIndex={-1}`) so the core shortcut
   * system can gate `when` clauses on it. Forwarded ref points at
   * the same wrapper so callers can `ref.current?.focus()`
   * programmatically.
   */
  focusContextId?: string;
};

export const Sidebar = forwardRef(function Sidebar(
  {
    header,
    footer,
    children,
    bodyVariant = "rows",
    flushLeft = false,
    focusContextId,
  }: SidebarProps,
  ref: Ref<HTMLDivElement>,
) {
  // Only reserve room for the footer + its gradient fade when the
  // caller actually passes a `footer` slot. Plugin views that own
  // their own footer (rendered absolutely inside the view's body,
  // via `bodyVariant="fill"` and no `footer` prop) would otherwise
  // see a 68px dead band at the bottom of the sidebar.
  const bodyBottomPad = footer ? SIDEBAR_BODY_BOTTOM_PAD : 0;
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
      ref={ref}
      tabIndex={focusContextId ? -1 : undefined}
      data-zenbu-focus-context={focusContextId}
      // We deliberately do NOT install a pointerdown focus-steal
      // here, even though the core `<FocusContext>` component does
      // by default. The sidebar's clickable surface is almost
      // entirely list rows whose click handlers route focus into
      // the composer (e.g. selecting a chat). A pointerdown
      // focus-steal would consistently fire *before* that click
      // path completes, leaving the composer unfocusable for a
      // frame and then yanking focus back to the sidebar wrapper.
      // Users who want keyboard mode on the sidebar press Cmd+0
      // (the `app.focusSidebar` shortcut), which is unambiguous.
      className={
        "flex flex-1 min-w-0 flex-col overflow-hidden bg-sidebar border-t border-b text-sidebar-foreground" +
        (flushLeft ? "" : " border-l") +
        // Suppress the default browser focus ring on the wrapper —
        // the keyboard cursor renders its own row highlight, so
        // an outer ring would be visual noise.
        (focusContextId ? " outline-none" : "")
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
            style={{ paddingBottom: bodyBottomPad }}
          >
            <div className="px-1.5">{children}</div>
          </div>
        ) : (
          <div
            className="absolute inset-0"
            style={{ paddingBottom: bodyBottomPad }}
          >
            {children}
          </div>
        )}
        {footer}
      </div>
    </div>
  );
});

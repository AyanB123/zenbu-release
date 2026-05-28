import { View } from "@zenbujs/core/react"
import { StatusBar } from "./status-bar"
import { useFooterItems, type FooterItem } from "@/lib/footer-items"

export type PiFooterProps = {
  /** The session driving any contextual items in the strip
   * (`pi-footer.scope-info`, `pi-footer.chat-stats`, …).
   * Threaded down from the owning `ChatPane` so each pane's
   * footer reflects *its* chat, not whichever pane is
   * window-active. Forwarded into every component-view item as
   * `args.sessionId`. */
  sessionId: string | null
}

/**
 * The footer strip at the bottom of every chat pane. Same family
 * as `WorkspaceRail` / `LeftSidebar`: host-owned chrome that
 * exposes a registry-based slot for plugins to drop items into.
 *
 * No item-specific code here — discovery + layout only. Items are
 * registered by plugins with `meta.kind = "pi-footer.item"`; see
 * `useFooterItems` for the two supported registration paths.
 */
export function PiFooter({ sessionId }: PiFooterProps) {
  const { left, right } = useFooterItems()

  return (
    <StatusBar
      left={left.map(item => (
        <FooterItemSlot key={item.key} item={item} sessionId={sessionId} />
      ))}
      right={right.map(item => (
        <FooterItemSlot key={item.key} item={item} sessionId={sessionId} />
      ))}
    />
  )
}

function FooterItemSlot({
  item,
  sessionId,
}: {
  item: FooterItem
  sessionId: string | null
}) {
  if (item.kind === "view") {
    return (
      <View type={item.viewType} args={{ sessionId }} fallback={null} />
    )
  }
  // Function-registry component — no args; the component reads
  // whatever it needs from db / its own store.
  const Component = item.Component
  return <Component />
}

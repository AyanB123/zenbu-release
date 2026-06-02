import type { WidgetId } from "../types"
import { RecommendedPluginsWidget } from "./recommended-plugins"
import { ShortcutsWidget } from "./shortcuts"

/** Routes a widget marker to its component. */
export function WidgetByName({ id }: { id: WidgetId }) {
  switch (id) {
    case "recommended-plugins":
      return <RecommendedPluginsWidget />
    case "shortcuts":
      return <ShortcutsWidget />
  }
}

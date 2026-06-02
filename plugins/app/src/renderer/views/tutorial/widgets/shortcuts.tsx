import { useCallback, useContext } from "react"
import { useRpc } from "@zenbujs/core/react"
import { Sliders } from "lucide-react"
import { LiveWidgetAckContext } from "../ack-context"
import { Kbd, PrimaryWidgetAction } from "./primitives"

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["\u2318", "B"], label: "Toggle left sidebar" },
  { keys: ["\u2318", "G"], label: "Toggle right sidebar" },
  { keys: ["\u2318", "J"], label: "Toggle bottom panel" },
  { keys: ["\u2318", "\u21e7", "P"], label: "Open command palette" },
  { keys: ["\u2318", "P"], label: "Search agents" },
  { keys: ["\u2318", "\u21e7", "B"], label: "Toggle project sidebar" },
]

export function ShortcutsWidget() {
  const rpc = useRpc()
  const ackLive = useContext(LiveWidgetAckContext)
  const openShortcuts = useCallback(() => {
    // RPC (not event) deep-links to the Shortcuts settings tab.
    void rpc.app["app-shortcuts"]
      .openSettings({ tab: "shortcuts" })
      .catch(err =>
        console.error("[tutorial] app-shortcuts.openSettings failed:", err),
      )
  }, [rpc])
  // Rendered flush (no WidgetCard) so the table's own gridlines
  // carry the structure.
  return (
    <>
      <div className="pb-1.5 text-[11.5px] text-muted-foreground">
        Try one to see it work.
      </div>
      <table className="border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="w-[200px] border border-border/60 bg-muted/30 px-2.5 py-1 text-left font-medium text-muted-foreground">
              Name
            </th>
            <th className="w-[120px] border border-border/60 bg-muted/30 px-2.5 py-1 text-left font-medium text-muted-foreground">
              Shortcut
            </th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map(s => (
            <tr key={s.label}>
              <td className="border border-border/60 px-2.5 py-1 text-foreground/85">
                {s.label}
              </td>
              <td className="border border-border/60 px-2.5 py-1">
                <span className="inline-flex items-center gap-1">
                  {s.keys.map((k, i) => (
                    <Kbd key={i}>{k}</Kbd>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ackLive ? (
        <div className="flex items-center gap-3 pt-2.5">
          <PrimaryWidgetAction onClick={ackLive}>
            Okay, done!
          </PrimaryWidgetAction>
          <button
            type="button"
            onClick={openShortcuts}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <Sliders className="h-[12px] w-[12px]" strokeWidth={1.75} />
            View all shortcuts
          </button>
        </div>
      ) : null}
    </>
  )
}

import { useEffect, useMemo, useState, type ChangeEvent } from "react"
import { useDb, useRpc } from "@zenbujs/core/react"
import { toast } from "sonner"
import { NativeSelect, NativeSelectOption } from "@zenbu/ui/native-select"
import { Spinner } from "@zenbu/ui/spinner"
import { useWindowId } from "./use-window-id"

/**
 * Component view rendered inside the settings panel when the user
 * selects the "Pi" section under the Plugins tab.
 *
 * Pi settings are dynamic-per-cwd (the binary itself owns the list
 * and current values), so they don't fit the static
 * `settingsRegistry` item model. Instead pi-commands registers a
 * `body: { kind: "view", viewType: "pi-settings" }` section and
 * supplies this view, which fetches the live list and renders
 * `<NativeSelect>`s the same way the old hardcoded panel did.
 *
 * Args come from the settings panel's `<View>` mount:
 *   `{ sectionId: "pi" }` (forwarded for future use).
 */

type PiSettingItem = {
  id: string
  label: string
  description: string
  value: string
  values: string[]
}

export default function PiSettingsSectionView() {
  const rpc = useRpc()
  const windowId = useWindowId()
  const cwd = useDb(root => {
    const ws = root.app.windowStates[windowId]
    if (!ws) return null
    const scopeId = ws.selectedScopeId
    return scopeId ? root.app.scopes[scopeId]?.directory ?? null : null
  })
  const [items, setItems] = useState<PiSettingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    rpc.piCommands.piCommands
      .getPiSettings({ cwd: cwd ?? undefined })
      .then(result => {
        if (!cancelled) setItems(result.items)
      })
      .catch(err => {
        console.error("[settings] failed to load Pi settings:", err)
        toast.error("Failed to load Pi settings", {
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, rpc])

  const grouped = useMemo(() => groupSettings(items), [items])

  if (loading) {
    return (
      <div className="flex items-center gap-2 pt-3 text-[12px] text-muted-foreground">
        <Spinner className="size-3" /> Loading Pi settings…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 pt-3">
      <div className="rounded-lg border border-border bg-card/40 p-3 text-[12px] text-muted-foreground">
        These are Pi agent settings from <code>settings.json</code>. They affect
        new Pi sessions immediately and live sessions after reload where Pi
        supports it.
      </div>
      {grouped.map(group => (
        <section key={group.title} className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold text-foreground">
            {group.title}
          </h2>
          <div className="divide-y divide-border rounded-lg border border-border">
            {group.items.map(item => (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_190px] gap-4 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-foreground">
                    {item.label}
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                    {item.description}
                  </div>
                </div>
                <NativeSelect
                  value={item.value}
                  disabled={savingId === item.id}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    const value = event.currentTarget.value
                    setSavingId(item.id)
                    rpc.piCommands.piCommands
                      .setPiSetting({ cwd: cwd ?? undefined, id: item.id, value })
                      .then(result => {
                        setItems(result.items)
                        toast.success(`${item.label} set to ${value}`)
                      })
                      .catch(err => {
                        console.error("[settings] failed to save Pi setting:", err)
                        toast.error(`Failed to save ${item.label}`, {
                          description:
                            err instanceof Error ? err.message : String(err),
                        })
                      })
                      .finally(() => setSavingId(null))
                  }}
                >
                  {item.values.map(value => (
                    <NativeSelectOption key={value} value={value}>
                      {value}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function groupSettings(items: PiSettingItem[]): Array<{
  title: string
  items: PiSettingItem[]
}> {
  const byId = new Map(items.map(item => [item.id, item] as const))
  const pick = (ids: string[]) => ids.map(id => byId.get(id)).filter((x): x is PiSettingItem => !!x)
  return [
    {
      title: "Context and delivery",
      items: pick([
        "autocompact",
        "steering-mode",
        "follow-up-mode",
        "transport",
        "thinking",
        "hide-thinking",
      ]),
    },
    {
      title: "Images and terminal",
      items: pick([
        "show-images",
        "image-width-cells",
        "auto-resize-images",
        "block-images",
        "show-hardware-cursor",
        "clear-on-shrink",
        "terminal-progress",
      ]),
    },
    {
      title: "Commands and navigation",
      items: pick([
        "skill-commands",
        "double-escape-action",
        "tree-filter-mode",
        "autocomplete-max-visible",
        "editor-padding",
      ]),
    },
    {
      title: "Startup and updates",
      items: pick([
        "quiet-startup",
        "collapse-changelog",
        "install-telemetry",
        "warnings.anthropicExtraUsage",
        "theme",
      ]),
    },
  ].filter(group => group.items.length > 0)
}

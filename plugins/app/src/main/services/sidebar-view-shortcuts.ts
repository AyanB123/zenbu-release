import { Service, runtime } from "@zenbujs/core/runtime"
import { getInjections, subscribeInjections } from "@zenbujs/core/advice"
import { RpcService, ShortcutsService } from "@zenbujs/core/services"
import type { ShortcutBinding } from "@zenbujs/core/schema"
import { PaletteActionsService } from "./palette-actions"

/**
 * Auto-registers a shortcut + palette action for every plugin
 * injection that contributes itself to the left or right sidebar.
 * The registration set is rebuilt whenever the injection registry
 * changes so plugins loaded / unloaded at runtime get / lose their
 * entry without a reload.
 *
 * Detection rules (mirroring `useSidebarViews` /
 * `useLeftSidebarViews` in the renderer):
 *
 *   - `meta.kind === "left-sidebar"`  -> left-sidebar entry
 *   - `meta.kind === "right-sidebar"` -> right-sidebar entry
 *
 * A view tagged both gets one registration per side. Action
 * id is `app.openSidebarView.<kind>.<viewType>` and both surfaces
 * (keyboard shortcut + command palette) dispatch the same
 * `app.openSidebarView` event. The renderer handles the actual
 * open/close logic since sidebar visibility lives in window state.
 *
 * Default key binding: pulled from the view's `meta.shortcut` when
 * present (shape: a `ShortcutBinding` or `ShortcutBinding[]`, e.g.
 * `{ key: "e", meta: true }`). Views that don't set one register
 * with an empty `[]` so the action still exists in the Shortcuts
 * settings UI for the user to bind, without occupying a keystroke
 * by default.
 *
 * The palette action is registered regardless of whether the view
 * declared a default binding, so users can always reach a sidebar
 * view from the command palette by name.
 */
export class SidebarViewShortcutsService extends Service.create({
  key: "sidebar-view-shortcuts",
  deps: {
    rpc: RpcService,
    shortcuts: ShortcutsService,
    paletteActions: PaletteActionsService,
  },
}) {
  evaluate() {
    this.setup("dynamic-sidebar-shortcuts", () => {
      let unsubs: Array<() => void> = []

      const reregister = () => {
        for (const u of unsubs) {
          try {
            u()
          } catch {
            // Ignore teardown errors -- we're about to replace the set anyway.
          }
        }
        unsubs = []

        for (const entry of getInjections()) {
          const meta = entry.meta
          if (!meta) continue

          const sides: Array<"left" | "right"> = []
          if (meta.kind === "left-sidebar") sides.push("left")
          if (meta.kind === "right-sidebar") sides.push("right")
          if (sides.length === 0) continue

          const label =
            typeof meta.label === "string" && meta.label.length > 0
              ? meta.label
              : formatLabel(entry.name)
          const defaultBinding = readDefaultBinding(meta)

          for (const kind of sides) {
            const id = `app.openSidebarView.${kind}.${entry.name}`
            const name = `Open ${label} (${kind === "left" ? "Left" : "Right"} Sidebar)`
            const description = `Open the ${label} view in the ${kind} sidebar. Press again to hide it.`

            unsubs.push(
              this.ctx.shortcuts.register({
                id,
                name,
                category: "Sidebar Views",
                description,
                defaultBinding,
                handler: () => {
                  this.ctx.rpc.emit.app.openSidebarView({
                    viewType: entry.name,
                    kind,
                    source: "shortcut",
                  })
                },
              }),
            )

            const paletteId = id
            void this.ctx.paletteActions
              .register({
                id: paletteId,
                label: name,
                hint: formatBindingHint(defaultBinding),
                rpc: {
                  plugin: "app",
                  service: "sidebar-view-shortcuts",
                  method: "dispatch",
                },
                args: { viewType: entry.name, kind },
              })
              .catch(() => {})
            unsubs.push(() => {
              void this.ctx.paletteActions
                .unregister({ id: paletteId })
                .catch(() => {})
            })
          }
        }
      }

      reregister()
      // Re-register whenever the injection registry changes so
      // plugins hot-loaded / hot-unloaded pick up / drop their
      // entry without a reload.
      const off = subscribeInjections(reregister)

      return () => {
        off()
        for (const u of unsubs) {
          try {
            u()
          } catch {}
        }
        unsubs = []
      }
    })
  }

  /**
   * Backing RPC for the palette-action registrations above. The
   * palette dispatches `rpc.app["sidebar-view-shortcuts"].dispatch`
   * with the registered `args`; we forward to the same event the
   * keyboard shortcut handler emits so both surfaces share one
   * renderer-side code path.
   */
  dispatch(args: { viewType: string; kind: "left" | "right" }) {
    this.ctx.rpc.emit.app.openSidebarView({
      viewType: args.viewType,
      kind: args.kind,
      source: "palette",
    })
  }
}

/**
 * Convenience: plugins can write `{ mod: true, key: "e" }` in their
 * view meta and have it translated to `meta: true` on macOS / `control: true`
 * elsewhere. Without this, every plugin would need to ship the two-element
 * cross-platform array shape that the existing `shortcuts.ts` uses.
 */
function normalizeBinding(raw: unknown): ShortcutBinding | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown> & { mod?: boolean }
  if (typeof r.key !== "string" && typeof r.code !== "string") return null
  if (r.mod) {
    const { mod: _mod, ...rest } = r
    const isMac = process.platform === "darwin"
    return {
      ...(rest as ShortcutBinding),
      ...(isMac ? { meta: true } : { control: true }),
    }
  }
  return r as ShortcutBinding
}

function readDefaultBinding(meta: {
  [key: string]: unknown
}): ShortcutBinding | ShortcutBinding[] {
  const raw = meta.shortcut
  if (!raw) return []
  if (Array.isArray(raw)) {
    const out: ShortcutBinding[] = []
    for (const item of raw) {
      const b = normalizeBinding(item)
      if (b) out.push(b)
    }
    return out
  }
  const single = normalizeBinding(raw)
  return single ? single : []
}

function formatLabel(type: string): string {
  const tail = type.includes("/") ? type.split("/").pop()! : type
  return tail.replace(/[-_]/g, " ")
}

function formatBindingHint(
  binding: ShortcutBinding | ShortcutBinding[],
): string | null {
  const first = Array.isArray(binding) ? binding[0] : binding
  if (!first) return null
  const key = typeof first.key === "string" ? first.key : ""
  if (key === "") return null
  const isMac = process.platform === "darwin"
  const parts: string[] = []
  if (first.control) parts.push(isMac ? "\u2303" : "Ctrl+")
  if (first.alt) parts.push(isMac ? "\u2325" : "Alt+")
  if (first.shift) parts.push(isMac ? "\u21e7" : "Shift+")
  if (first.meta) parts.push(isMac ? "\u2318" : "Win+")
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join("")
}

runtime.register(SidebarViewShortcutsService, import.meta)

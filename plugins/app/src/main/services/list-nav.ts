import { Service, runtime } from "@zenbujs/core/runtime"
import {
  RpcService,
  ShortcutsService,
} from "@zenbujs/core/services"
import type { ShortcutBinding } from "@zenbujs/core/schema"

/**
 * Backing service for `@zenbu/ui/list-nav`.
 *
 * Lets a renderer-side `<ListNav id="…">` register its eight
 * canonical keyboard-nav shortcuts (j/k, h/l, Ctrl+d/Ctrl+u,
 * Space, Enter) at mount time and tear them down on unmount. The
 * shortcuts are all gated by `when: id`, so the consumer also
 * stamps `data-zenbu-focus-context={id}` on its wrapper.
 *
 * Each shortcut handler emits one of four typed events
 * (`listNavMove` / `listNavStep` / `listNavPage` /
 * `listNavActivate`) tagged with the scopeId, and the
 * renderer-side primitive subscribes filtered by its own id.
 * The single service handles every list on screen — no per-list
 * service instance, no proxy classes.
 *
 * Settings UI categorizes by `label` (or the scopeId when no
 * label is supplied), so each list-nav scope shows up as its
 * own block in the shortcuts panel.
 */

/** The eight canonical action keys a `<ListNav>` registers. */
export type ListNavActionKey =
  | "moveDown"
  | "moveUp"
  | "stepOut"
  | "stepIn"
  | "pageDown"
  | "pageUp"
  | "activate"
  | "activateAlt"

/** Per-action override the consumer can pass via the `<ListNav
 * shortcuts={…}>` prop. `false` drops the shortcut entirely; an
 * object replaces (or augments) the default binding. */
export type ListNavShortcutOverride =
  | false
  | { defaultBinding?: ShortcutBinding | ShortcutBinding[] }

export type ListNavScopeArgs = {
  id: string
  /** Human-readable label used as the settings UI category. Falls
   * back to the scopeId. */
  label?: string
  /** Per-action overrides. Anything not present uses the canonical
   * default. */
  shortcuts?: Partial<Record<ListNavActionKey, ListNavShortcutOverride>>
}

type ActionSpec = {
  key: ListNavActionKey
  /** Suffix appended to the scopeId to form the shortcut id. */
  idSuffix: string
  /** Default human-readable name (the scope label is prepended). */
  nameSuffix: string
  description: string
  defaultBinding: ShortcutBinding | ShortcutBinding[]
}

const ACTION_SPECS: readonly ActionSpec[] = [
  {
    key: "moveDown",
    idSuffix: "moveDown",
    nameSuffix: "Move Down",
    description: "Move the keyboard cursor down one row.",
    defaultBinding: [{ key: "j" }, { key: "ArrowDown" }],
  },
  {
    key: "moveUp",
    idSuffix: "moveUp",
    nameSuffix: "Move Up",
    description: "Move the keyboard cursor up one row.",
    defaultBinding: [{ key: "k" }, { key: "ArrowUp" }],
  },
  {
    key: "stepOut",
    idSuffix: "stepOut",
    nameSuffix: "Collapse / Step Out",
    description:
      "Collapse the current branch, or step the cursor onto its header from a child row.",
    defaultBinding: [{ key: "h" }, { key: "ArrowLeft" }],
  },
  {
    key: "stepIn",
    idSuffix: "stepIn",
    nameSuffix: "Expand / Step In",
    description:
      "Expand the current branch, or move into it from a collapsed header.",
    defaultBinding: [{ key: "l" }, { key: "ArrowRight" }],
  },
  {
    key: "pageDown",
    idSuffix: "pageDown",
    nameSuffix: "Half-Page Down",
    description: "Move the cursor down by half a viewport.",
    defaultBinding: { key: "d", control: true },
  },
  {
    key: "pageUp",
    idSuffix: "pageUp",
    nameSuffix: "Half-Page Up",
    description: "Move the cursor up by half a viewport.",
    defaultBinding: { key: "u", control: true },
  },
  {
    key: "activate",
    idSuffix: "activate",
    nameSuffix: "Activate Row",
    description:
      "Primary activate (Space): open the row under the cursor or toggle a branch.",
    defaultBinding: { key: " ", code: "Space" },
  },
  {
    key: "activateAlt",
    idSuffix: "activateAlt",
    nameSuffix: "Activate Row (Alt)",
    description:
      "Secondary activate (Enter): same dispatch as Space but with `alt: true` so consumers can branch behavior (e.g. open in new tab).",
    defaultBinding: { key: "Enter" },
  },
]

export class ListNavService extends Service.create({
  key: "listNav",
  deps: {
    rpc: RpcService,
    shortcuts: ShortcutsService,
  },
}) {
  /** scopeId → unregister fns for each of the eight shortcuts. */
  private scopes = new Map<string, Array<() => void>>()

  /**
   * RPC: register one list-nav scope. Idempotent on the scopeId —
   * a second call with the same id replaces the first registration
   * cleanly (useful for HMR or when the consumer's `shortcuts`
   * override prop changes).
   */
  registerScope(args: ListNavScopeArgs): void {
    this.disposeScope(args.id)
    const { id } = args
    const category = args.label ?? id
    const overrides = args.shortcuts ?? {}
    const unsubs: Array<() => void> = []
    for (const spec of ACTION_SPECS) {
      const override = overrides[spec.key]
      if (override === false) continue
      const defaultBinding =
        (override && override.defaultBinding) ?? spec.defaultBinding
      unsubs.push(
        this.ctx.shortcuts.register({
          id: `${id}.${spec.idSuffix}`,
          name: `${category}: ${spec.nameSuffix}`,
          category,
          description: spec.description,
          defaultBinding,
          when: id,
          handler: () => this.dispatch(id, spec.key),
        }),
      )
    }
    this.scopes.set(id, unsubs)
  }

  /** RPC: tear down a previously-registered scope. No-op if unknown. */
  unregisterScope(args: { id: string }): void {
    this.disposeScope(args.id)
  }

  private disposeScope(id: string): void {
    const existing = this.scopes.get(id)
    if (!existing) return
    for (const u of existing) {
      try {
        u()
      } catch (err) {
        console.warn("[list-nav] scope disposer failed:", err)
      }
    }
    this.scopes.delete(id)
  }

  private dispatch(scopeId: string, action: ListNavActionKey): void {
    const source = "action"
    switch (action) {
      case "moveDown":
        this.ctx.rpc.emit.app.listNavMove({ scopeId, dir: "down", source })
        return
      case "moveUp":
        this.ctx.rpc.emit.app.listNavMove({ scopeId, dir: "up", source })
        return
      case "stepIn":
        this.ctx.rpc.emit.app.listNavStep({ scopeId, dir: "in", source })
        return
      case "stepOut":
        this.ctx.rpc.emit.app.listNavStep({ scopeId, dir: "out", source })
        return
      case "pageDown":
        this.ctx.rpc.emit.app.listNavPage({ scopeId, dir: "down", source })
        return
      case "pageUp":
        this.ctx.rpc.emit.app.listNavPage({ scopeId, dir: "up", source })
        return
      case "activate":
        this.ctx.rpc.emit.app.listNavActivate({
          scopeId,
          alt: false,
          source,
        })
        return
      case "activateAlt":
        this.ctx.rpc.emit.app.listNavActivate({
          scopeId,
          alt: true,
          source,
        })
        return
    }
  }

  evaluate() {
    // No bootstrap work — every registration is driven by mounted
    // `<ListNav>` instances via `registerScope`. Tear everything
    // down on hot reload so we don't double-register.
    this.setup("list-nav-cleanup", () => {
      return () => {
        for (const id of [...this.scopes.keys()]) this.disposeScope(id)
      }
    })
  }
}

runtime.register(ListNavService, import.meta)

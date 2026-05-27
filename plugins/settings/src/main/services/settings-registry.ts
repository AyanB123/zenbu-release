import { Service } from "@zenbujs/core/runtime";
import { DbService } from "@zenbujs/core/services";

export type SettingsRpcRef = {
  /** Plugin name that owns the service (e.g. `"app"`, `"plan"`). */
  plugin: string;
  /** Service key as declared on the service class. */
  service: string;
  /** Public method name on that service. */
  method: string;
};

export type SettingsSelectOption = {
  value: string;
  label: string;
};

export type SettingsControl =
  | { kind: "toggle"; value: boolean }
  | { kind: "select"; value: string; options: SettingsSelectOption[] }
  | {
      kind: "text";
      value: string;
      placeholder?: string | null;
      multiline?: boolean;
    }
  | {
      kind: "number";
      value: number;
      min?: number | null;
      max?: number | null;
      step?: number | null;
    }
  | {
      kind: "button";
      buttonLabel: string;
      variant?: "default" | "destructive";
    };

export type SettingsSectionBody =
  | { kind: "items" }
  | { kind: "view"; viewType: string };

export type RegisteredSettingsSection = {
  id: string;
  label: string;
  icon?: string | null;
  order?: number;
  /** How to render the section. Defaults to `{ kind: "items" }`. */
  body?: SettingsSectionBody;
};

export type RegisteredSettingsItem = {
  id: string;
  sectionId: string;
  label: string;
  description?: string | null;
  group?: string | null;
  order?: number;
  keywords?: string[];
  control: SettingsControl;
  rpc: SettingsRpcRef;
  args?: Record<string, unknown> | null;
};

/**
 * Generic registry of plugin-contributed settings.
 *
 * Mirrors `PaletteActionsService` in shape and lifecycle:
 *
 *  - `evaluate()` wipes both tables on every service start, so the
 *    DB record is always a faithful reflection of what's currently
 *    installed. Plugin services depend on this service (string-keyed
 *    or class-keyed) so their `setup()` blocks run after the wipe
 *    and can call `registerSection` / `registerItem`, pairing each
 *    with the matching `unregister*` in cleanup.
 *
 *  - The renderer subscribes via `useDb(root => root.settings.registry)`
 *    and dispatches each item's `rpc` location with
 *    `{ windowId, value, ...args }` (button items dispatch with no
 *    `value` field) when the user interacts. The handler is the
 *    source of truth for actually applying the change — the registry
 *    just renders the UI and shuttles values between renderer and
 *    handler.
 *
 *  - Handlers should call `setValue({ id, value })` once the
 *    underlying state has been updated so the displayed value stays
 *    in sync. For controls whose value is derived from another
 *    plugin's DB, a `setup` watcher can pump changes into
 *    `setValue` continuously.
 */
export class SettingsRegistryService extends Service.create({
  key: "settingsRegistry",
  deps: { db: DbService },
}) {
  async evaluate() {
    await this.ctx.db.client.update((root) => {
      root.settings.registry.sections = {};
      root.settings.registry.items = {};
    });
  }

  async registerSection(
    spec: RegisteredSettingsSection,
  ): Promise<{ ok: true }> {
    await this.ctx.db.client.update((root) => {
      root.settings.registry.sections[spec.id] = {
        id: spec.id,
        label: spec.label,
        icon: spec.icon ?? null,
        order: spec.order ?? 0,
        body: spec.body ?? { kind: "items" },
      };
    });
    return { ok: true };
  }

  async unregisterSection(args: { id: string }): Promise<{ ok: true }> {
    await this.ctx.db.client.update((root) => {
      delete root.settings.registry.sections[args.id];
      // Also drop any items orphaned by removing this section. The
      // owning plugin should pair each `registerItem` with an
      // `unregisterItem`, but if it forgets we don't want the
      // sidebar to keep showing a phantom group.
      for (const itemId of Object.keys(root.settings.registry.items)) {
        const item = root.settings.registry.items[itemId];
        if (item?.sectionId === args.id) {
          delete root.settings.registry.items[itemId];
        }
      }
    });
    return { ok: true };
  }

  async registerItem(
    spec: RegisteredSettingsItem,
  ): Promise<{ ok: true }> {
    await this.ctx.db.client.update((root) => {
      root.settings.registry.items[spec.id] = {
        id: spec.id,
        sectionId: spec.sectionId,
        label: spec.label,
        description: spec.description ?? null,
        group: spec.group ?? null,
        order: spec.order ?? 0,
        keywords: spec.keywords ?? [],
        // The schema requires non-optional `multiline` / `min` /
        // `max` / `step` / `variant` fields on the control union;
        // `normalizeControl` fills them in with defaults. The cast
        // here is just to satisfy the strict shape kyju expects.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        control: normalizeControl(spec.control) as any,
        rpc: {
          plugin: spec.rpc.plugin,
          service: spec.rpc.service,
          method: spec.rpc.method,
        },
        args: spec.args ?? null,
      };
    });
    return { ok: true };
  }

  async unregisterItem(args: { id: string }): Promise<{ ok: true }> {
    await this.ctx.db.client.update((root) => {
      delete root.settings.registry.items[args.id];
    });
    return { ok: true };
  }

  /**
   * Update the displayed value of a control. Called by handlers
   * after the underlying state has been written. No-ops on buttons
   * (they don't have a `value`) and on unknown ids.
   */
  async setValue(args: {
    id: string;
    value: string | number | boolean;
  }): Promise<{ ok: true }> {
    await this.ctx.db.client.update((root) => {
      const item = root.settings.registry.items[args.id];
      if (!item) return;
      const control = item.control;
      switch (control.kind) {
        case "toggle":
          if (typeof args.value === "boolean") control.value = args.value;
          return;
        case "select":
        case "text":
          if (typeof args.value === "string") control.value = args.value;
          return;
        case "number":
          if (typeof args.value === "number") control.value = args.value;
          return;
        case "button":
          return;
      }
    });
    return { ok: true };
  }

  /** Diagnostics-friendly snapshot. Prefer reading the DB record
   * directly from the renderer. */
  list(): {
    sections: RegisteredSettingsSection[];
    items: RegisteredSettingsItem[];
  } {
    const root = this.ctx.db.client.readRoot().settings.registry;
    return {
      sections: Object.values(root.sections ?? {}),
      items: Object.values(root.items ?? {}) as RegisteredSettingsItem[],
    };
  }
}

function normalizeControl(c: SettingsControl): SettingsControl {
  // Carry sensible defaults so callers can omit optional fields.
  switch (c.kind) {
    case "text":
      return {
        kind: "text",
        value: c.value,
        placeholder: c.placeholder ?? null,
        multiline: c.multiline ?? false,
      };
    case "number":
      return {
        kind: "number",
        value: c.value,
        min: c.min ?? null,
        max: c.max ?? null,
        step: c.step ?? null,
      };
    case "button":
      return {
        kind: "button",
        buttonLabel: c.buttonLabel,
        variant: c.variant ?? "default",
      };
    default:
      return c;
  }
}

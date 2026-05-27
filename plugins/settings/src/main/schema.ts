import { createSchema, z } from "@zenbujs/core/db";

/** Settings-UI state. Nothing about how the app is actually
 *  configured — that lives in each subsystem's own plugin. */
const settingsTab = z.enum([
  "general",
  "accounts",
  "shortcuts",
  "plugins",
]);

const ui = z.object({
  lastTab: settingsTab.default("general"),
  lastPluginsSectionId: z.string().nullable().default(null),
});

// Plugin-contributed settings registry. Mirrors `paletteAction` in
// shape and lifecycle: wiped on service start, re-populated by each
// plugin's `setup()`. See `SettingsRegistryService` for the API.

const rpcRef = z.object({
  plugin: z.string(),
  service: z.string(),
  method: z.string(),
});

const selectOption = z.object({
  value: z.string(),
  label: z.string(),
});

const settingsControl = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("toggle"), value: z.boolean() }),
  z.object({
    kind: z.literal("select"),
    value: z.string(),
    options: z.array(selectOption),
  }),
  z.object({
    kind: z.literal("text"),
    value: z.string(),
    placeholder: z.string().nullable().default(null),
    multiline: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("number"),
    value: z.number(),
    min: z.number().nullable().default(null),
    max: z.number().nullable().default(null),
    step: z.number().nullable().default(null),
  }),
  z.object({
    kind: z.literal("button"),
    buttonLabel: z.string(),
    variant: z.enum(["default", "destructive"]).default("default"),
  }),
]);

/** `items`: render registered items. `view`: mount a custom
 *  component view from the contributing plugin. */
const sectionBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("items") }),
  z.object({ kind: z.literal("view"), viewType: z.string() }),
]);

const settingsSection = z.object({
  id: z.string(),
  label: z.string(),
  /** Inline SVG for the sidebar tile. */
  icon: z.string().nullable().default(null),
  order: z.number().default(0),
  body: sectionBody.default({ kind: "items" }),
});

const settingsItem = z.object({
  id: z.string(),
  sectionId: z.string(),
  label: z.string(),
  description: z.string().nullable().default(null),
  group: z.string().nullable().default(null),
  order: z.number().default(0),
  /** Extra search terms beyond label / description / group. */
  keywords: z.array(z.string()).default([]),
  control: settingsControl,
  rpc: rpcRef,
  args: z.record(z.string(), z.unknown()).nullable().default(null),
});

const registry = z.object({
  sections: z.record(z.string(), settingsSection).default({}),
  items: z.record(z.string(), settingsItem).default({}),
});

export default createSchema({
  ui: ui.default({ lastTab: "general", lastPluginsSectionId: null }),
  registry: registry.default({ sections: {}, items: {} }),
});

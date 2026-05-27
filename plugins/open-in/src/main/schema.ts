import { createSchema, z } from "@zenbujs/core/db"

/**
 * One macOS application the OS reports as able to open a folder
 * URL. Populated by `OpenInService.refresh()` on every boot via
 * `URLsForApplicationsToOpenURL`, with icons extracted from each
 * bundle's `.icns` file. The record is rewritten on every refresh,
 * so uninstalls disappear automatically across boots.
 */
const openInApp = z.object({
  /** Stable id = sha1(bundlePath). */
  id: z.string(),
  /** Absolute path to the `.app` bundle. */
  bundlePath: z.string(),
  /** Display name from Info.plist; falls back to the bundle basename. */
  name: z.string(),
  /** CFBundleIdentifier; empty if it couldn't be read. */
  bundleId: z.string().default(""),
  /** Extracted PNG. Null when extraction failed; renderer falls
   * back to a letter avatar. */
  icon: z
    .object({
      blobId: z.string(),
      mimeType: z.string(),
    })
    .nullable()
    .default(null),
  /** Last index time, unix ms. */
  indexedAt: z.number(),
  /** Lower is earlier in the dropdown. Mirrors NSWorkspace's order
   * (preferred handler first). */
  sortOrder: z.number().default(0),
})

/**
 * Plugin-owned slice of state for the title-bar Open-in button.
 *
 * Two top-level keys instead of one record-of-everything because
 * the settings half is a tiny singleton (`defaultBundlePath` +
 * a one-shot migration flag) and the apps half is a sizeable
 * record that gets fully rewritten on every refresh. Keeping
 * them separate means the singleton doesn't get serialised on
 * every boot's re-index.
 */
export default createSchema({
  /** Folder-opener apps the OS reported on the last boot. */
  apps: z.record(z.string(), openInApp).default({}),
  /**
   * Persistent settings for the Open-in button. Migrated from the
   * host's `root.app.settings.{defaultOpenInBundlePath,
   * finderDefaultMigrated}` slot (see migration 0001 in the
   * `app` plugin).
   */
  settings: z
    .object({
      /** Bundle path of the user's preferred app (primary-click
       * target). Null means "use the first available app". */
      defaultBundlePath: z.string().nullable().default(null),
      /** One-shot reset flag: existing installs from before the
       * Finder-default heuristic landed get re-pointed at Finder
       * on the next boot. */
      finderDefaultMigrated: z.boolean().default(false),
    })
    .default({
      defaultBundlePath: null,
      finderDefaultMigrated: false,
    }),
})

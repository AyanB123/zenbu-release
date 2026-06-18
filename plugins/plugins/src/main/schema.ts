import { createSchema, collection, z } from "@zenbujs/core/db"

// Registry listing, cached in `catalog` (keyed by id) on fetch so
// reopening a plugin is instant and the network call just revalidates.
const listing = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string().nullable(),
  author: z.string(),
  tags: z.array(z.string()),
  downloadCount: z.number(),
  reviewStatus: z.string(),
  minHostVersion: z.string().nullable(),
  updatedAt: z.string(),
  readme: z.string().nullable().default(null),
})

const piPackageType = z.enum(["extension", "skill", "prompt", "theme"])
const piPackageListing = z.object({
  id: z.string(),
  source: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string().nullable(),
  author: z.string().nullable(),
  license: z.string().nullable(),
  tags: z.array(z.string()),
  types: z.array(piPackageType),
  downloadCount: z.number().nullable(),
  updatedAt: z.string().nullable(),
  installCommand: z.string(),
  readme: z.string().nullable().default(null),
  homepageUrl: z.string().nullable(),
  repositoryUrl: z.string().nullable(),
  npmUrl: z.string().nullable(),
  securityReviewed: z.boolean().nullable(),
})

const piResourceKind = z.enum(["extensions", "skills", "prompts", "themes"])
const piPackageResource = z.object({
  kind: piResourceKind,
  path: z.string(),
  enabled: z.boolean(),
})
const piPackageFilters = z
  .object({
    extensions: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    prompts: z.array(z.string()).optional(),
    themes: z.array(z.string()).optional(),
  })
  .default({})
const piInstalledPackage = z.object({
  id: z.string(),
  source: z.string(),
  scope: z.enum(["user", "project"]),
  installedPath: z.string().nullable(),
  installed: z.boolean(),
  enabled: z.boolean(),
  filtered: z.boolean(),
  filters: piPackageFilters.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.string().nullable(),
  author: z.string().nullable(),
  license: z.string().nullable(),
  resources: z.object({
    extensions: z.array(piPackageResource),
    skills: z.array(piPackageResource),
    prompts: z.array(piPackageResource),
    themes: z.array(piPackageResource),
  }),
  diagnostics: z.array(z.string()),
})

export default createSchema({
  enabled: z.boolean().default(false),
  // Per-id cache (detail view, install metadata).
  catalog: z.record(z.string(), listing).default({}),
  // The browse list, lazily loaded + cached locally. A background
  // service refreshes it every few minutes (rotate-and-swap), so
  // navigating away and back reads from the cache instantly instead
  // of refetching.
  feed: collection(listing, { debugName: "marketplace-feed" }),
  // Pi package catalog/cache. Separate from Zenbu marketplace plugins:
  // Pi packages are installed through Pi settings/package-manager, not
  // `zenbu.plugins.local.jsonc`.
  piCatalog: z.record(z.string(), piPackageListing).default({}),
  piInstalled: z.record(z.string(), piInstalledPackage).default({}),
  piDisabledFilterBackups: z.record(z.string(), piPackageFilters).default({}),
})

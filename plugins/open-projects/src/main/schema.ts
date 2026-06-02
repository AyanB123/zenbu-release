import { collection, createSchema, makeCollection, z } from "@zenbujs/core/db"

/**
 * One indexed project folder. Recorded by the utility-process
 * scanner when it walks `$HOME` and hits a directory containing
 * a project marker (`.git`, `package.json`, `Cargo.toml`, ...).
 *
 *   - `path`: absolute path on disk.
 *   - `name`: `path.basename(path)`. Denormalised so the palette
 *     can substring-match without re-splitting on every row.
 *   - `parent`: parent dir, also denormalised for the row's
 *     muted-grey "location" line.
 *   - `depth`: segments below `$HOME`. Used as a tiebreaker so
 *     `~/code/foo` outranks `~/code/team/sub/foo`.
 *   - `marker`: the marker filename that triggered the record
 *     (`".git"`, `"package.json"`, ...). Future surface for
 *     filtering by language; today it's just shown in the row
 *     as a small tag.
 */
const projectEntry = z.object({
  path: z.string(),
  name: z.string(),
  parent: z.string(),
  depth: z.number(),
  marker: z.string(),
})

/**
 * Singleton index state. The collection ref rotates on every
 * re-index so progress publishes into a fresh collection
 * (mirrors the trick in `plugins/app/src/main/services/file-tree.ts`),
 * keeping `root.json` writes cheap.
 *
 *   - `status`: `"idle"` outside an indexing pass. `"indexing"`
 *     while the utility process is still streaming batches.
 *     `"error"` when the worker crashed or returned an error
 *     message.
 *   - `count`: running total of entries published into the
 *     current collection. Surfaced in the palette as a subtle
 *     "1240 projects" pill.
 *   - `indexedAt`: unix ms of the last successful `done`.
 *   - `truncated`: true when the worker hit the `totalCap`
 *     (currently 5000). Surfaced as a "results may be
 *     incomplete" footnote in the palette.
 */
const indexState = z.object({
  projects: collection(projectEntry, { debugName: "open-projects" }),
  status: z.enum(["idle", "indexing", "error"]),
  count: z.number(),
  indexedAt: z.number(),
  truncated: z.boolean(),
  error: z.string().nullable(),
})

export default createSchema({
  index: indexState.default({
    // Empty collection ref; rotated on the first walk.
    projects: makeCollection({ debugName: "open-projects" }),
    status: "idle",
    count: 0,
    indexedAt: 0,
    truncated: false,
    error: null,
  }),
})

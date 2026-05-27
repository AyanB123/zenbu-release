/**
 * Directory names we never descend into during any kind of
 * repo-wide walk (file-tree indexing, workspace-icon discovery,
 * future "find in repo" features, etc.).
 *
 * The list is conservative on purpose: it's the union of "VCS
 * metadata" + "package manager output" + "build output" + "tool
 * caches". Adding to it never breaks correctness; it just trims
 * the walk. Removing from it can blow up cold-walk time on large
 * monorepos, so prefer adding.
 *
 * If a walker also wants to skip dotdirs in general (most do, but
 * file-tree wants to surface a `.github/` for the user), it
 * should layer that on top instead of putting `.*` patterns in
 * here.
 */
export const IGNORE_DIRS: ReadonlySet<string> = new Set([
  // VCS
  ".git",
  ".hg",
  ".svn",
  // Package managers / vendored deps
  "node_modules",
  "bower_components",
  "vendor",
  // Build / framework output
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".vercel",
  ".expo",
  "storybook-static",
  // Tool caches
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".gradle",
  // Test / coverage
  "coverage",
  ".pytest_cache",
  // Python
  ".venv",
  "venv",
  "__pycache__",
  // Editor / OS junk
  ".idea",
  ".vscode",
  ".DS_Store",
  // Zenbu's own generated stuff
  ".zenbu",
])

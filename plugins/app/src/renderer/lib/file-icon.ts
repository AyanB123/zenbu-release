import {
  createFileTreeIconResolver,
  getBuiltInFileIconColor,
  getBuiltInSpriteSheet,
} from "@pierre/trees"
/**
 * this is kinda hacky claude slop
 */

/**
 * Bridge between `@pierre/trees`'s built-in file icon set and any
 * renderer-side surface that wants to show a file icon outside of a
 * `<FileTree>` (e.g. the composer's `@` picker, future jump-to-file
 * dialogs, breadcrumb chips).
 *
 * The trees library injects its own sprite into its shadow root for
 * the tree view. For everywhere else we inject the same sprite into
 * `document.body` (lazily, exactly once) so plain `<svg><use href="#…"/>`
 * works anywhere in the app.
 *
 * Colors are inline `style.color` strings from `getBuiltInFileIconColor`,
 * which return `var(--trees-file-icon-color-X, light-dark(...))` with
 * literal hex fallbacks baked in — so they render correctly even without
 * the trees CSS variables defined in our document.
 */

const ICON_SET = "standard" as const

let resolverSingleton: ReturnType<typeof createFileTreeIconResolver> | null =
  null
let spriteInjected = false

function ensureInitialized(): ReturnType<typeof createFileTreeIconResolver> {
  if (resolverSingleton) return resolverSingleton
  resolverSingleton = createFileTreeIconResolver(ICON_SET)
  if (
    !spriteInjected &&
    typeof document !== "undefined" &&
    !document.querySelector("[data-zenbu-file-icon-sprite]")
  ) {
    const wrap = document.createElement("div")
    wrap.dataset.zenbuFileIconSprite = "1"
    // Sprite is `<svg width="0" height="0">` so it's invisible; we just
    // need it in the DOM tree so `<use href="#…">` can find the symbols.
    wrap.style.position = "absolute"
    wrap.style.width = "0"
    wrap.style.height = "0"
    wrap.style.overflow = "hidden"
    wrap.setAttribute("aria-hidden", "true")
    wrap.innerHTML = getBuiltInSpriteSheet(ICON_SET)
    document.body.appendChild(wrap)
    spriteInjected = true
  }
  return resolverSingleton
}

export type ResolvedFileIcon = {
  /** Sprite symbol id, ready for `<use href="#${name}">`. */
  name: string
  /** Inline `color` CSS value with light-dark fallback. Drives both
   * `currentColor` paths in the symbol and any text alongside it. */
  color: string | undefined
}

/**
 * Resolve the icon for a file path. Returns `null` for empty input so
 * callers can decide whether to render a generic glyph or nothing.
 */
export function resolveFileIcon(filePath: string): ResolvedFileIcon | null {
  if (!filePath) return null
  const resolver = ensureInitialized()
  const resolved = resolver.resolveIcon("file-tree-icon-file", filePath)
  return {
    name: resolved.name,
    color: resolved.token ? getBuiltInFileIconColor(resolved.token) : undefined,
  }
}

/**
 * Renderer-side helpers for turning a `ShortcutBinding` (the raw
 * key+modifier record stored on `core.shortcuts`) into the glyph
 * string we display in tooltips, palette hints, and settings rows.
 *
 * Kept separate from the matching helpers in
 * `plugins/app/src/main/services/shortcuts.ts` and
 * `plugins/settings/.../shortcuts-panel.tsx` so all renderer surfaces
 * can `import { formatBinding } from "@/lib/format-binding"` and stay
 * visually identical without re-exporting a service module.
 */

export type ShortcutBinding = {
  key?: string
  code?: string
  meta?: boolean
  control?: boolean
  alt?: boolean
  shift?: boolean
}

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

const KEY_GLYPHS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  enter: "↵",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  escape: "Esc",
  " ": "Space",
}

function formatKey(b: ShortcutBinding): string {
  const k = b.key ?? ""
  if (k.length === 0) return ""
  const glyph = KEY_GLYPHS[k.toLowerCase()]
  if (glyph) return glyph
  return k.length === 1 ? k.toUpperCase() : k
}

/**
 * Format a single binding as the compact glyph string macOS menus
 * use (`⌘⇧E`). On non-mac, modifiers are spelled out with `+`
 * separators (`Ctrl+Shift+E`). Returns `null` for an "empty" /
 * disabled binding so callers can branch on `null` to render
 * differently (or hide the hint entirely).
 */
export function formatBinding(binding: ShortcutBinding | null): string | null {
  if (!binding) return null
  const key = formatKey(binding)
  if (!key) return null
  const parts: string[] = []
  if (binding.control) parts.push(IS_MAC ? "⌃" : "Ctrl")
  if (binding.alt) parts.push(IS_MAC ? "⌥" : "Alt")
  if (binding.shift) parts.push(IS_MAC ? "⇧" : "Shift")
  if (binding.meta) parts.push(IS_MAC ? "⌘" : "Win")
  parts.push(key)
  return IS_MAC ? parts.join("") : parts.join("+")
}

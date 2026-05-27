import { useMemo } from "react"
import { resolveFileIcon } from "@/lib/file-icon"

export type FileIconProps = {
  /** Full path or basename — both work; the resolver looks at the
   * filename portion to pick a built-in token. */
  path: string
  /** Pixel size; matches `--trees-font-size-override` (12px) at default. */
  size?: number
  className?: string
}

/**
 * Tiny `<svg>` wrapper that renders the same built-in file-type icons
 * as `@pierre/trees`'s file tree. Reuses the singleton sprite injected
 * by `lib/file-icon.ts`.
 *
 * Token-specific colors come through `currentColor` paths in the
 * symbol; we drive that via inline `color`. Falls back to no icon
 * when the resolver can't classify (shouldn't happen — the built-in
 * "default" token is always available).
 */
export function FileIcon({ path, size = 14, className }: FileIconProps) {
  const resolved = useMemo(() => resolveFileIcon(path), [path])
  if (!resolved) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={resolved.color ? { color: resolved.color } : undefined}
      className={className}
    >
      <use href={`#${resolved.name}`} />
    </svg>
  )
}

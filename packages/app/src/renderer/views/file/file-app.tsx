import { useViewArgs } from "@zenbujs/core/react"
import { useThemeSync } from "@/lib/theme"
import { FilePreview } from "../file-tree/file-preview"

export type FileViewArgs = {
  directory?: string
  path?: string
}

/**
 * Embeddable single-file viewer. Reads `{ directory, path }` from the
 * tab's view args (set by `openViewInRoot("file", "new-tab", { ... })`)
 * and renders the file using the same `FilePreview` component the
 * file-tree pane view uses, so syntax highlighting / theming stays
 * consistent across surfaces.
 */
export function FileApp() {
  useThemeSync()
  const { directory, path } = useViewArgs<FileViewArgs>()

  if (!directory || !path) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
        No file selected.
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 w-full bg-background text-foreground">
      <FilePreview
        key={`${directory}::${path}`}
        directory={directory}
        path={path}
      />
    </div>
  )
}

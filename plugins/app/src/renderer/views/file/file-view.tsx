import type { ViewComponentProps } from "@zenbujs/core/react"
import { FilePreview } from "../file-tree/file-preview"

export type FileViewArgs = {
  directory?: string
  path?: string
}

/**
 * Embeddable single-file viewer. Component-mode view: the host
 * renders this directly inside its React tree (no iframe, no
 * `useThemeSync` shim). Args (`{ directory, path }`) come in as a
 * prop, set by `openViewInRoot("file", "new-tab", { ... })`.
 *
 * Rendering still goes through the shared `FilePreview` component so
 * syntax highlighting / theming stays consistent with the file-tree
 * pane view.
 */
export default function FileView({
  args,
}: ViewComponentProps<FileViewArgs>) {
  const directory = args?.directory
  const path = args?.path

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

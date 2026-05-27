import { useWorkspaceIconUrl } from "@/lib/workspace-icon"
import type { Schema } from "../../../main/schema"
import { WorkspaceIcon } from "./workspace-icon"

export type TitleBarWorkspaceProps = {
  name: string
  icon: Schema["workspaces"][string]["icon"]
  /** Auto-derived icon, used when no user upload is set. */
  iconAuto?: Schema["workspaces"][string]["iconAuto"]
}

export function TitleBarWorkspace({
  name,
  icon,
  iconAuto,
}: TitleBarWorkspaceProps) {
  const iconUrl = useWorkspaceIconUrl({
    icon,
    iconAuto: iconAuto ?? null,
  })
  return (
    <div className="flex items-center gap-2 min-w-0">
      <WorkspaceIcon src={iconUrl} fallback={name} size={18} />
      <span className="truncate text-[13px] font-semibold text-foreground">
        {name}
      </span>
    </div>
  )
}

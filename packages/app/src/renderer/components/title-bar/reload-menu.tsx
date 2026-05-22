import { DownloadIcon, RefreshCwIcon, RotateCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type ReloadMenuItem = {
  id: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  onSelect: () => void
}

export type ReloadMenuProps = {
  onReloadWindow?: () => void
  onFullReload?: () => void
  onPullUpdates?: () => void
  extra?: ReloadMenuItem[]
}

export function ReloadMenu({
  onReloadWindow = () => window.location.reload(),
  onFullReload,
  onPullUpdates,
  extra,
}: ReloadMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Reload"
          className="hg-icon size-[22px] rounded bg-transparent text-muted-foreground hover:bg-transparent"
        >
          <RotateCwIcon size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        <DropdownMenuItem onClick={onReloadWindow}>
          <RotateCwIcon className="size-3" />
          Reload window
        </DropdownMenuItem>
        {onFullReload && (
          <DropdownMenuItem
            onSelect={e => {
              e.preventDefault()
              onFullReload()
            }}
          >
            <RefreshCwIcon className="size-3" />
            Full reload
          </DropdownMenuItem>
        )}
        {onPullUpdates && (
          <DropdownMenuItem
            onSelect={e => {
              e.preventDefault()
              onPullUpdates()
            }}
          >
            <DownloadIcon className="size-3" />
            Pull updates
          </DropdownMenuItem>
        )}
        {extra?.map(item => (
          <DropdownMenuItem
            key={item.id}
            disabled={item.disabled}
            onSelect={e => {
              e.preventDefault()
              item.onSelect()
            }}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

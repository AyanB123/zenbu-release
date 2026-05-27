import { useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  GitBranchIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@zenbu/ui/popover"
import { Tabs, TabsList, TabsTrigger } from "@zenbu/ui/tabs"
import { HoverTip } from "@zenbu/ui/hover-tip"
import { cn } from "@/lib/utils"
import type { GitBranch, GitStatus } from "../types"

type TabKey = "changes" | "history" | "branches"

/**
 * Sticky toolbar at the top of the git view. Holds the branch
 * picker on the left, sync buttons (fetch/pull/push) on the right,
 * and tab switching in the middle. We intentionally keep it
 * single-row + small so the available space goes to the diff.
 */
export function GitToolbar({
  status,
  branches,
  busy,
  activeTab,
  onChangeTab,
  onRefresh,
  onFetch,
  onPull,
  onPush,
  onCheckout,
  onCreateBranch,
}: {
  directory: string
  status: GitStatus | null
  branches: GitBranch[]
  busy: string | null
  activeTab: TabKey
  onChangeTab: (t: TabKey) => void
  onRefresh: () => void
  onFetch: () => void
  onPull: () => void
  onPush: () => void
  onCheckout: (branch: string) => void
  onCreateBranch: (name: string) => void
}) {
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const changed = status?.files.length ?? 0
  const staged = status?.files.filter(f => f.staged).length ?? 0

  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-background px-2 py-1.5">
      <BranchPicker
        current={status?.branch ?? null}
        branches={branches}
        onCheckout={onCheckout}
        onCreate={onCreateBranch}
        disabled={!!busy}
      />

      <Tabs
        value={activeTab}
        onValueChange={v => onChangeTab(v as TabKey)}
        className="!gap-0"
      >
        <TabsList className="h-7">
          <TabsTrigger value="changes" className="text-[12px]">
            Changes
            {changed > 0 && (
              <span className="ml-1.5 rounded-sm bg-muted px-1 py-0.5 text-[10px] tabular-nums">
                {staged > 0 ? `${staged}/${changed}` : changed}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="text-[12px]">
            History
          </TabsTrigger>
          <TabsTrigger value="branches" className="text-[12px]">
            Branches
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="ml-auto flex items-center gap-1">
        {busy && (
          <span className="mr-2 text-[11px] text-muted-foreground">
            {busy}…
          </span>
        )}
        <SyncButton
          label="Fetch"
          onClick={onFetch}
          disabled={!!busy}
        >
          <RefreshCwIcon className="size-3.5" />
        </SyncButton>
        <SyncButton
          label="Pull"
          count={behind}
          onClick={onPull}
          disabled={!!busy || behind === 0}
        >
          <ArrowDownIcon className="size-3.5" />
        </SyncButton>
        <SyncButton
          label={status?.upstream ? "Push" : "Publish"}
          count={ahead}
          onClick={onPush}
          disabled={!!busy || (ahead === 0 && !!status?.upstream)}
        >
          <ArrowUpIcon className="size-3.5" />
        </SyncButton>
        <HoverTip label="Refresh" setAriaLabel={false}>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!!busy}
            aria-label="Refresh"
            className="ml-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
          >
            <RefreshCwIcon className="size-3.5" />
          </button>
        </HoverTip>
      </div>
    </div>
  )
}

function SyncButton({
  label,
  count,
  onClick,
  disabled,
  children,
}: {
  label: string
  count?: number
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <HoverTip label={label} setAriaLabel={false}>
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
    >
      {children}
      <span>{label}</span>
      {count != null && count > 0 && (
        <span className="rounded-sm bg-muted px-1 py-0.5 text-[10px] tabular-nums">
          {count}
        </span>
      )}
    </button>
    </HoverTip>
  )
}

function BranchPicker({
  current,
  branches,
  onCheckout,
  onCreate,
  disabled,
}: {
  current: string | null
  branches: GitBranch[]
  onCheckout: (b: string) => void
  onCreate: (name: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")

  const local = branches.filter(b => !b.remote)
  const remote = branches.filter(b => b.remote)
  const filteredLocal = local.filter(b =>
    b.shortName.toLowerCase().includes(query.toLowerCase()),
  )
  const filteredRemote = remote.filter(b =>
    b.shortName.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) {
          setQuery("")
          setCreating(false)
          setNewName("")
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-7 items-center gap-1.5 rounded border px-2 text-[12px] hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
        >
          <GitBranchIcon className="size-3.5" />
          <span className="max-w-[180px] truncate font-medium">
            {current ?? "no branch"}
          </span>
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[300px] p-0"
        sideOffset={4}
      >
        {creating ? (
          <form
            className="flex flex-col gap-2 p-2"
            onSubmit={e => {
              e.preventDefault()
              if (!newName.trim()) return
              onCreate(newName.trim())
              setOpen(false)
            }}
          >
            <label className="text-[11px] text-muted-foreground">
              New branch from {current ?? "HEAD"}
            </label>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="feature/my-branch"
              className="rounded border bg-background px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded px-2 py-1 text-[11px] hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newName.trim()}
                className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
              >
                Create &amp; checkout
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="border-b p-2">
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter branches…"
                className="w-full rounded border bg-background px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="max-h-[280px] overflow-auto">
              <BranchList
                title="Local"
                items={filteredLocal}
                current={current}
                onPick={b => {
                  onCheckout(b)
                  setOpen(false)
                }}
              />
              <BranchList
                title="Remote"
                items={filteredRemote}
                current={current}
                onPick={b => {
                  // Checkout a remote ref creates a tracking branch.
                  const short = b.replace(/^[^/]+\//, "")
                  onCheckout(short)
                  setOpen(false)
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 border-t px-3 py-2 text-[12px] hover:bg-accent"
            >
              <PlusIcon className="size-3.5" /> New branch
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function BranchList({
  title,
  items,
  current,
  onPick,
}: {
  title: string
  items: GitBranch[]
  current: string | null
  onPick: (name: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {items.map(b => {
        const active = b.shortName === current
        return (
          <button
            key={b.name}
            type="button"
            onClick={() => onPick(b.shortName)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] hover:bg-accent",
              active && "font-medium",
            )}
          >
            <CheckIcon
              className={cn(
                "size-3 shrink-0",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="min-w-0 flex-1 truncate">{b.shortName}</span>
            {b.upstream && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                → {b.upstream}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

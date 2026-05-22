import { useState, type ReactNode } from "react"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { collapseHomeDir, displayPath, useHomeDir } from "@/lib/home-dir"
import type {
  ToolCallContentItem,
  ToolResponse,
} from "../lib/materialized-message"

const SHIMMER = "text-shimmer"

/**
 * Subtle red X shown trailing a tool card when the tool reported an
 * error (`isError: true`). The card itself otherwise renders in its
 * normal "completed" state (past-tense verb, no shimmer) so the
 * failure reads as "this finished, but unhappily" rather than "this
 * is still running".
 */
function FailedIndicator({ status }: { status: ToolCardProps["status"] }) {
  if (status !== "failed") return null
  return (
    <XIcon
      className="shrink-0 text-red-500"
      width={12}
      height={12}
      strokeWidth={2}
      aria-label="failed"
    />
  )
}

/** Past-tense verb when the tool is done, regardless of success/failure. */
function isDone(status: ToolCardProps["status"]) {
  return status === "completed" || status === "failed"
}

type ToolCardProps = {
  title: string
  subtitle?: string
  kind: string
  status: "pending" | "running" | "completed" | "failed"
  contentItems?: ToolCallContentItem[]
  rawInput?: unknown
  rawOutput?: unknown
  toolName?: string
  toolResponse?: ToolResponse | null
}

export function ToolCallCard(props: ToolCardProps) {
  const name = (props.toolName ?? "").toLowerCase()
  const kind = props.kind || "other"
  const isBash = kind === "execute" || name === "bash"
  const isEdit = kind === "edit" || name === "edit"
  const isWrite = name === "write" || kind === "create"
  const isRead = kind === "read" || name === "read"
  const isSearch =
    kind === "search" ||
    name === "grep" ||
    name === "glob" ||
    name === "find" ||
    name === "ls"
  const isTask = kind === "think" || name === "agent" || name === "task"

  if (isWrite) return <WriteCard {...props} />
  if (isEdit) return <EditCard {...props} />
  if (isBash) return <BashCard {...props} />
  if (isTask) return <TaskCard {...props} />
  if (isRead) return <ReadCard {...props} />
  if (isSearch) return <SearchCard {...props} />
  return <DefaultCard {...props} />
}

function isLoading(status: ToolCardProps["status"]) {
  return !isDone(status)
}

function fileBasename(p: string): string {
  return p.split("/").pop() ?? p
}

function truncateLines(text: string, max: number): string {
  const lines = text.split("\n")
  if (lines.length <= max) return text
  return lines.slice(0, max).join("\n") + `\n... ${lines.length - max} more lines`
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + "…"
}

function countDiffLines(diffs: (ToolCallContentItem & { type: "diff" })[]) {
  let added = 0
  let removed = 0
  for (const d of diffs) {
    const oldLines = d.oldText ? d.oldText.split("\n") : []
    const newLines = d.newText.split("\n")
    const oldSet = new Set(oldLines)
    const newSet = new Set(newLines)
    for (const line of newLines) if (!oldSet.has(line)) added++
    for (const line of oldLines) if (!newSet.has(line)) removed++
  }
  return { added, removed }
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className="shrink-0 text-muted-foreground opacity-0 group-hover/tool:opacity-100"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: expanded ? "rotate(90deg)" : undefined }}
    >
      <path d="M4.5 3L7.5 6L4.5 9" />
    </svg>
  )
}

function ToolLine({
  expanded,
  children,
  onClick,
  showChevron = true,
}: {
  expanded?: boolean
  children: ReactNode
  onClick?: () => void
  showChevron?: boolean
}) {
  const interactive = !!onClick
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={!interactive}
      className={cn(
        "group/tool h-auto w-full min-w-0 justify-start gap-1.5 rounded-none bg-transparent px-0 py-0.5 text-left text-sm font-normal hover:bg-transparent has-[>svg]:px-0 disabled:opacity-100",
        interactive ? "" : "",
      )}
    >
      {children}
      {showChevron && interactive && <Chevron expanded={!!expanded} />}
    </Button>
  )
}

function ExpandedBody({ children }: { children: ReactNode }) {
  return (
    <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
      {children}
    </pre>
  )
}

function Verb({
  loading,
  children,
}: {
  loading: boolean
  children: ReactNode
}) {
  return (
    <span className={cn("shrink-0", loading ? SHIMMER : "text-muted-foreground")}>
      {children}
    </span>
  )
}

function EditCard({ contentItems = [], status }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  const diffs = contentItems.filter(
    (c): c is ToolCallContentItem & { type: "diff" } => c.type === "diff",
  )
  const paths = [...new Set(diffs.map(d => d.path))]
  const label = paths.length > 0 ? paths.map(fileBasename).join(", ") : null
  const { added, removed } = countDiffLines(diffs)
  const loading = isLoading(status)

  return (
    <div>
      <ToolLine
        expanded={expanded}
        onClick={diffs.length > 0 ? () => setExpanded(e => !e) : undefined}
      >
        <Verb loading={loading}>{isDone(status) ? "Edited" : "Editing"}</Verb>
        <span className="min-w-0 truncate text-foreground">{label}</span>
        {(added > 0 || removed > 0) && (
          <span className="flex shrink-0 items-center gap-0.5">
            {added > 0 && <span className="text-emerald-600">+{added}</span>}
            {removed > 0 && <span className="text-red-500">-{removed}</span>}
          </span>
        )}
        <FailedIndicator status={status} />
      </ToolLine>
      {expanded && diffs.length > 0 && (
        <div className="mt-1 space-y-1">
          {diffs.map((d, i) => (
            <div
              key={i}
              className="overflow-hidden rounded border border-border text-xs"
            >
              {paths.length > 1 && (
                <DiffPathHeader path={d.path} />
              )}
              <DiffBlock oldText={d.oldText ?? ""} newText={d.newText} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DiffPathHeader({ path }: { path: string }) {
  const homeDir = useHomeDir()
  return (
    <div className="bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
      {displayPath(path, homeDir)}
    </div>
  )
}

function DiffBlock({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-border font-mono">
      {oldText && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-red-500/10 px-2 py-1 text-red-700 dark:text-red-300">
          {oldText}
        </pre>
      )}
      <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
        {newText}
      </pre>
    </div>
  )
}

function WriteCard({ rawInput, status }: ToolCardProps) {
  const input = (rawInput ?? {}) as Record<string, unknown>
  const filePath = String(input.file_path ?? input.path ?? "")
  const content = input.content ?? input.contents
  const lineCount =
    typeof content === "string" && content ? content.split("\n").length : 0
  const loading = isLoading(status)

  return (
    <ToolLine showChevron={false}>
      <Verb loading={loading}>
        {isDone(status) ? "Created File" : "Creating File"}
      </Verb>
      <span className="min-w-0 truncate text-foreground">
        {fileBasename(filePath)}
      </span>
      {lineCount > 0 && (
        <span className="shrink-0 text-blue-500">+{lineCount}</span>
      )}
      <FailedIndicator status={status} />
    </ToolLine>
  )
}

function BashCard({ rawInput, toolResponse, status }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  const homeDir = useHomeDir()
  const input = (rawInput ?? {}) as Record<string, unknown>
  const rawCommand =
    typeof input.command === "string" && input.command.length > 0
      ? input.command
      : null
  const command = rawCommand != null ? collapseHomeDir(rawCommand, homeDir) : null
  const loading = isLoading(status)

  const inner = command ? (
    <span className="text-foreground">{command}</span>
  ) : (
    <span
      className={cn(
        "mx-0.5 inline-block h-3.5 w-24 rounded-sm bg-muted align-middle",
        loading && "hg-shimmer",
      )}
    />
  )

  return (
    <div>
      <ToolLine expanded={expanded} onClick={() => setExpanded(e => !e)}>
        <span className={expanded ? "min-w-0 break-all" : "min-w-0 truncate"}>
          <Verb loading={loading}>Bash(</Verb>
          {inner}
          <Verb loading={loading}>)</Verb>
        </span>
        <FailedIndicator status={status} />
      </ToolLine>
      {expanded && toolResponse && (toolResponse.stdout || toolResponse.stderr) && (
        <ExpandedBody>
          {toolResponse.stdout || ""}
          {toolResponse.stderr
            ? `${toolResponse.stdout ? "\n" : ""}${toolResponse.stderr}`
            : ""}
        </ExpandedBody>
      )}
    </div>
  )
}

function TaskCard({ title, rawInput, contentItems, status }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  const input = (rawInput ?? {}) as Record<string, unknown>
  const description = String(input.description ?? input.prompt ?? "")
  const promptText = contentItems?.find(
    (c): c is ToolCallContentItem & { type: "text" } => c.type === "text",
  )?.text
  const detail = promptText || description
  const summary = truncateText(description || title, 80)
  const loading = isLoading(status)

  return (
    <div>
      <ToolLine
        expanded={expanded}
        onClick={detail ? () => setExpanded(e => !e) : undefined}
      >
        <span className="break-all">
          <Verb loading={loading}>Task(</Verb>
          {summary ? (
            <span className="text-foreground">{summary}</span>
          ) : (
            <span
              className={cn(
                "mx-0.5 inline-block h-3.5 w-24 rounded-sm bg-muted align-middle",
                loading && "hg-shimmer",
              )}
            />
          )}
          <Verb loading={loading}>)</Verb>
        </span>
        <FailedIndicator status={status} />
      </ToolLine>
      {expanded && detail && <ExpandedBody>{truncateLines(detail, 30)}</ExpandedBody>}
    </div>
  )
}

function ReadCard({ title, rawInput, status }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  const input = (rawInput ?? {}) as Record<string, unknown>
  const filePath = String(
    input.file_path ?? input.path ?? input.filePath ?? title,
  )
  // Reads spam the chat; showing just the basename keeps the list
  // scannable. Full path is still available on hover via the title.
  const cleanPath = filePath.replace(/\s*\([\d\s\-–,]+\)\s*$/, "")
  const cleanTitle = fileBasename(cleanPath)
  const startLine = numberOrUndef(
    input.offset ?? input.start_line ?? input.startLine,
  )
  const limit = numberOrUndef(input.limit)
  const endLine =
    limit != null && startLine != null
      ? startLine + limit
      : numberOrUndef(input.end_line ?? input.endLine)
  const range =
    startLine != null
      ? endLine != null
        ? ` ${startLine}-${endLine}`
        : ` ${startLine}`
      : ""

  return (
    <ToolLine
      expanded={expanded}
      onClick={() => setExpanded(e => !e)}
      showChevron={false}
    >
      <Verb loading={isLoading(status)}>Read</Verb>
      <span
        className={expanded ? "min-w-0 break-all" : "min-w-0 truncate"}
        title={cleanPath}
      >
        <span className="text-foreground">{cleanTitle}</span>
        {range && <span className="text-muted-foreground">{range}</span>}
      </span>
      <FailedIndicator status={status} />
    </ToolLine>
  )
}

function SearchCard({ title, status }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <ToolLine
      expanded={expanded}
      onClick={() => setExpanded(e => !e)}
      showChevron={false}
    >
      <span
        className={cn(
          expanded ? "min-w-0 break-all" : "min-w-0 truncate",
          isLoading(status) ? SHIMMER : "text-foreground",
        )}
      >
        {title}
      </span>
      <FailedIndicator status={status} />
    </ToolLine>
  )
}

function DefaultCard({ title, status }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <ToolLine
      expanded={expanded}
      onClick={() => setExpanded(e => !e)}
      showChevron={false}
    >
      <span
        className={cn(
          expanded ? "min-w-0 break-all" : "min-w-0 truncate",
          isLoading(status) ? SHIMMER : "text-foreground",
        )}
      >
        {title}
      </span>
      <FailedIndicator status={status} />
    </ToolLine>
  )
}

function numberOrUndef(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined
}

import { AlertCircle } from "lucide-react"

/** Inline card for failed assistant turns (stopReason error/aborted). */
export function ErrorMessage({
  message,
  detail,
}: {
  message: string
  detail?: string | null
}) {
  const headline = detail && detail.length > 0 ? detail : message
  const hasRaw = !!detail && detail !== message
  return (
    <div className="my-1 flex w-full gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-foreground">
      <AlertCircle className="mt-[2px] h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-destructive">Request failed</div>
        <div className="mt-1 whitespace-pre-wrap break-words text-foreground/90">
          {headline}
        </div>
        {hasRaw ? (
          <details className="mt-2 select-text">
            <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
              Show raw response
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs text-muted-foreground">
              {message}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  )
}

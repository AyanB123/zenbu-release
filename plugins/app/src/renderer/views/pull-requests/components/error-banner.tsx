import { Button } from "@zenbu/ui/button"

/**
 * Plain inline error card. The PR view leans heavily on shell-out
 * commands (`gh`, `git`), so we want a single consistent way to
 * surface their stderr without throwing toasts.
 */
export function ErrorBanner({
  title,
  detail,
  onDismiss,
}: {
  title: string
  detail: string
  onDismiss?: () => void
}) {
  return (
    <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-[12px] text-destructive">
      <div className="flex items-start gap-2">
        <span className="font-medium">{title}</span>
        {onDismiss && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="ml-auto h-5 px-1 text-[10px] text-destructive hover:bg-destructive/20"
          >
            Dismiss
          </Button>
        )}
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-snug">
        {detail}
      </pre>
    </div>
  )
}

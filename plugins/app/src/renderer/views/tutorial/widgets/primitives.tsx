// Shared chrome for the tutorial's inline widgets.

export function WidgetCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card/60">
      {children}
    </div>
  )
}

/** Filled action button (the "Okay, done!" advance button). */
export function PrimaryWidgetAction({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12.5px] font-semibold text-background shadow-sm hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {children}
    </button>
  )
}

/** Per-row enable toggle: "Enable" / "Enabled" (filled when on). */
export function EnableButton({
  enabled,
  onClick,
  disabled,
}: {
  enabled: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={enabled}
      className={
        "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 " +
        (enabled
          ? "bg-foreground text-background hover:bg-foreground/90"
          : "border border-border/70 bg-background text-foreground/85 hover:border-border hover:text-foreground")
      }
    >
      {enabled ? (
        <>
          <svg
            viewBox="0 0 10 10"
            className="h-[9px] w-[9px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M1.5 5.5 4 8l4.5-6" />
          </svg>
          Enabled
        </>
      ) : (
        "Enable"
      )}
    </button>
  )
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[18px] items-center justify-center rounded border border-border/70 bg-background px-1.5 py-[1px] font-mono text-[10.5px] text-foreground/85">
      {children}
    </kbd>
  )
}

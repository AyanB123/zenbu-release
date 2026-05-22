import { Component, type ErrorInfo, type ReactNode } from "react"

export type ErrorBoundaryProps = {
  /** Human-readable name used in fallback UI + console logs. */
  label: string
  children: ReactNode
  /**
   * Optional override for the fallback UI. Called with the captured
   * error and a `reset` callback that clears the boundary so the
   * children can attempt to mount again.
   */
  fallback?: (args: { error: Error; reset: () => void }) => ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
}

/**
 * Catches render-time errors thrown by descendants so a single
 * broken subtree (composer, chat, sidebar, etc.) can't take down
 * the entire window. Each instance is intentionally scoped to one
 * region of the UI — the surrounding chrome keeps rendering while
 * the failed region shows an inline error card.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[error-boundary:${this.props.label}]`,
      error,
      info.componentStack,
    )
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const { fallback, label } = this.props
    if (fallback) {
      return fallback({ error, reset: this.reset })
    }

    return (
      <div className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-auto p-3">
        <div className="flex max-w-md flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[12px] text-foreground">
          <div className="font-medium text-destructive">
            {label} crashed
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {error.message || String(error)}
          </pre>
          <div>
            <button
              type="button"
              onClick={this.reset}
              className="rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }
}

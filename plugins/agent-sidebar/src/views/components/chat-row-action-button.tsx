import type { ReactNode, MouseEvent } from "react"

export function ChatRowActionButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={title}
      onClick={e => {
        e.stopPropagation()
        onClick(e)
      }}
      onMouseDown={e => e.stopPropagation()}
      className="flex h-[20px] w-[20px] items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
    >
      {children}
    </button>
  )
}

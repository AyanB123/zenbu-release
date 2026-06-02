import { Sparkles } from "lucide-react"

/** Quiet panel shown once the tutorial has exited. */
export function PostTutorialPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center px-6 text-center">
      <div className="flex max-w-[360px] flex-col items-center gap-2 text-muted-foreground">
        <Sparkles className="h-5 w-5 text-foreground/70" strokeWidth={1.5} />
        <p className="text-[13px] text-foreground/85">You're set.</p>
        <p className="text-[12px] leading-relaxed">
          Close this tab when you're done. You can always reopen the tutorial
          from the command palette.
        </p>
      </div>
    </div>
  )
}

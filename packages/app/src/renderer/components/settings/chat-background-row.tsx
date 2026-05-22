import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  DEFAULT_BG_OPACITY,
  useChatBackground,
  useChatBackgroundUrl,
  useSetChatBackground,
  useUploadChatBackground,
} from "@/lib/chat-background"

const ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif"

export function ChatBackgroundRow() {
  const background = useChatBackground()
  const setBackground = useSetChatBackground()
  const uploadBackground = useUploadChatBackground()
  const url = useChatBackgroundUrl(background)
  const inputRef = useRef<HTMLInputElement>(null)

  const onPick = () => inputRef.current?.click()

  const onFile = async (file: File) => {
    const opacity = background?.opacity ?? DEFAULT_BG_OPACITY
    await uploadBackground(file, opacity)
  }

  const onOpacity = async (opacity: number) => {
    if (!background) return
    await setBackground({ ...background, opacity })
  }

  const onClear = async () => {
    await setBackground(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-foreground">
          Chat background
        </span>
        <div className="flex items-center gap-2">
          {background && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onPick}>
            {background ? "Replace" : "Upload"}
          </Button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file) return
          onFile(file).catch(err =>
            console.error("[chat-background] upload failed:", err),
          )
        }}
      />

      {background && (
        <>
          <BackgroundPreview url={url} opacity={background.opacity} />
          <OpacitySlider
            value={background.opacity}
            onChange={value => {
              void onOpacity(value)
            }}
          />
        </>
      )}
    </div>
  )
}

function BackgroundPreview({
  url,
  opacity,
}: {
  url: string | null
  opacity: number
}) {
  return (
    <div
      className="relative h-24 w-full overflow-hidden rounded border border-border bg-card"
      style={{
        backgroundImage:
          "linear-gradient(45deg, rgba(0,0,0,0.04) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.04) 75%), linear-gradient(45deg, rgba(0,0,0,0.04) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.04) 75%)",
        backgroundSize: "12px 12px",
        backgroundPosition: "0 0, 6px 6px",
      }}
    >
      {url ? (
        <img
          src={url}
          alt="Chat background preview"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
          Loading…
        </div>
      )}
    </div>
  )
}

function OpacitySlider({
  value,
  onChange,
}: {
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-muted-foreground">Opacity</span>
      <Slider
        min={0}
        max={1}
        step={0.01}
        value={[value]}
        onValueChange={values => onChange(values[0] ?? value)}
        className="flex-1"
      />
      <span className="w-10 text-right font-mono text-[11px] text-muted-foreground">
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  )
}

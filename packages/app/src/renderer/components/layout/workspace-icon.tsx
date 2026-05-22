export type WorkspaceIconProps = {
  src?: string | null
  fallback: string
  isActive?: boolean
  size?: number
}

export function WorkspaceIcon({
  src,
  fallback,
  isActive = false,
  size = 22,
}: WorkspaceIconProps) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="object-contain"
        style={{ width: size, height: size, borderRadius: 4 }}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="flex items-center justify-center bg-accent text-muted-foreground text-[12px] font-medium"
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        opacity: isActive ? 1 : 0.85,
      }}
    >
      {(fallback[0] ?? "?").toUpperCase()}
    </span>
  )
}

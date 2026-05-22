import { isValidElement, type ComponentProps, type ReactNode } from "react"

function extractText(node: ReactNode): string {
  if (node == null || node === false) return ""
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode }
    return extractText(props.children)
  }
  return ""
}

/**
 * Streamdown plug-points. We only customize the inline `<code>` styling
 * via the dedicated `inlineCode` slot. Block code is left to streamdown's
 * default `CodeBlock` (which uses shiki). Overriding `code` here would
 * replace the entire CodeBlock with a bare <code>, which breaks block
 * rendering.
 */
function InlineCode(props: ComponentProps<"code">) {
  return (
    <code
      {...props}
      className={
        "rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground " +
        (props.className ?? "")
      }
    />
  )
}

export const streamdownProps = {
  components: {
    inlineCode: InlineCode,
  },
}

export { extractText }

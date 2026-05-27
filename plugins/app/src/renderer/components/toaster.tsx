import { Toaster as ShadcnToaster } from "@zenbu/ui/sonner"
import type { ToasterProps } from "sonner"
import { useTheme } from "@/lib/theme"

/**
 * App-level wrapper around the shadcn `Toaster` that feeds it our
 * db-backed theme preference. The shared package can't read the db
 * directly (it lives outside of zenbu), so theme is injected here.
 */
export function Toaster(props: ToasterProps) {
  const { preference } = useTheme()
  const theme: ToasterProps["theme"] =
    preference === "system"
      ? "system"
      : preference === "dark" || preference === "oled"
        ? "dark"
        : "light"
  return <ShadcnToaster theme={theme} {...props} />
}

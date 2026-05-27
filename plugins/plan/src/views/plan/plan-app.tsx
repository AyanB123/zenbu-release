import { useMemo } from "react";
import { Streamdown, type DiagramPlugin } from "streamdown";
import { useViewArgs } from "@zenbujs/core/react";
import mermaid from "mermaid";

/**
 * Plan viewer. Standalone vite-served React tree mounted by the
 * host's pane system when something fires the `openViewInActivePane`
 * event with `viewType: "plan"` and `args: { toolCallId, title, markdown }`.
 *
 * Renders the Markdown body via Streamdown, which supports
 * GitHub-flavored Markdown out of the box. Mermaid diagrams require
 * an explicit `DiagramPlugin` adapter \u2014 we lazy-init the `mermaid`
 * package on first request and forward `render(id, source)` to it.
 */

export type PlanViewArgs = {
  toolCallId?: string;
  title?: string;
  markdown?: string;
};

/**
 * Streamdown expects `{ getMermaid(config) -> { initialize, render } }`.
 * The `mermaid` package itself satisfies that contract once we ensure
 * `startOnLoad: false` (we drive renders by id, not by DOM scan) and a
 * theme that respects the host's color scheme.
 *
 * The plugin object is stable across renders so Streamdown doesn't
 * tear down and re-init mermaid on every keystroke / arg change.
 */
/**
 * Decide whether the host is currently in dark mode by reading the
 * `--background` token zenbu injects. OKLCH with lightness < 0.5 is
 * considered dark. Falls back to `prefers-color-scheme` only if the
 * host hasn't published a `--background` for some reason.
 */
function detectHostDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  const oklchMatch = bg.match(/oklch\(\s*([0-9.]+)/i);
  if (oklchMatch) return parseFloat(oklchMatch[1]!) < 0.5;
  if (bg) {
    // hsl(0 0% 12%) / hsl(0, 0%, 12%) — second number is lightness.
    const hslMatch = bg.match(/hsl\(\s*\S+\s*,?\s*\S+\s*,?\s*([0-9.]+)%/i);
    if (hslMatch) return parseFloat(hslMatch[1]!) < 50;
  }
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

const mermaidPlugin: DiagramPlugin = {
  name: "mermaid",
  type: "diagram",
  language: "mermaid",
  getMermaid: (config) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: detectHostDarkMode() ? "dark" : "default",
      ...config,
    });
    return mermaid as unknown as {
      initialize: (config: Parameters<typeof mermaid.initialize>[0]) => void;
      render: (id: string, source: string) => Promise<{ svg: string }>;
    };
  },
};

export function PlanApp() {
  const { title, markdown } = useViewArgs<PlanViewArgs>();

  // Stable plugin config so Streamdown doesn't reinitialize mermaid
  // on every render.
  const plugins = useMemo(() => ({ mermaid: mermaidPlugin }), []);

  if (!markdown) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: "1rem",
          opacity: 0.55,
          fontSize: 13,
        }}
      >
        No plan selected.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <header
        style={{
          padding: "14px 20px 10px",
          borderBottom: "1px solid rgba(127,127,127,0.18)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.55,
          }}
        >
          Plan
        </span>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {title ?? "Untitled plan"}
        </h1>
      </header>
      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "16px 24px 32px",
          fontSize: 13.5,
          lineHeight: 1.55,
        }}
      >
        <Streamdown plugins={plugins}>{markdown}</Streamdown>
      </main>
    </div>
  );
}

# @zenbu/view-theme

Tailwind v4 `@theme` mapping that wires shadcn-style utility classes
onto the host design tokens that **zenbu auto-injects into every plugin
view**.

Plugin views run in an iframe served by their own Vite root, but
they're embedded in a host app that already has a design system. This
package is the tiny bridge: with `<View>` propagating the host's
`:root` tokens into the iframe (via the URL on first paint and
postMessage on later changes), importing this stylesheet makes
`bg-card`, `text-muted-foreground`, `border`, `rounded-md`, etc. all
resolve to the host's current theme — automatically following dark
mode toggles, custom palettes, anything the host changes at runtime.

## Usage

```css
/* In your plugin view's stylesheet (e.g. src/views/.../styles.css) */
@import "tailwindcss";
@import "@zenbu/view-theme/tailwind.css";

/* From here on, shadcn class names "just work" with the host theme. */
```

That's it. No duplicated token values. No `.dark` / `prefers-color-scheme`
blocks. No theme-change wiring on the plugin side.

## Without Tailwind

Plugins that don't use Tailwind can ignore this file entirely and
reference the underlying CSS custom properties directly:

```css
.my-card {
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
```

zenbu injects those vars into the iframe synchronously before first
paint, so no flash.

## Tokens covered

The full shadcn standard set:

```
--background           --foreground
--card                 --card-foreground
--popover              --popover-foreground
--primary              --primary-foreground
--secondary            --secondary-foreground
--muted                --muted-foreground
--accent               --accent-foreground
--destructive          --destructive-foreground
--border  --input  --ring
--radius
```

The host defines whichever subset it wants; missing tokens are simply
not forwarded, and `var(--name)` falls back to whatever the plugin
specifies as a default.

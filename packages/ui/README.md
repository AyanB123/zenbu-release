# @zenbu/ui

Shared UI primitives for the hackable-gui monorepo. Shipped as a regular
npm-style package so plugins anywhere can import them.

Two flavors of things live here:

- **shadcn/ui components** (new-york style) — `Button`, `Dialog`, `Popover`, …
- **zenbu primitives** — behavioral building blocks that are specific to this
  app shell. Currently:
  - `@zenbu/ui/list-nav` — declarative keyboard-navigable lists/trees with
    auto-registered shortcuts.

## install

Inside the monorepo:

```jsonc
// plugins/<your-plugin>/package.json
{
  "dependencies": {
    "@zenbu/ui": "workspace:*",
    "@zenbu/view-theme": "workspace:*"
  }
}
```

You also need the [peer deps](./package.json) for whichever components you
import (e.g. `radix-ui`, `lucide-react`, `class-variance-authority`).

## use

Each component is its own subpath export:

```tsx
import { Button } from "@zenbu/ui/button"
import { Dialog, DialogContent } from "@zenbu/ui/dialog"
import { ListNav } from "@zenbu/ui/list-nav"
import { cn } from "@zenbu/ui/utils"
```

This keeps imports cheap and codegen-friendly (no barrel file).

## theming

Pair with `@zenbu/view-theme` in your tailwind entry so the components
pick up the host's design tokens:

```css
@import "tailwindcss";
@import "@zenbu/view-theme/tailwind.css";
```

## adding more shadcn components

This package follows shadcn's "new-york" style. To add a new component, drop
the generated `.tsx` into `src/` and adjust imports:

- `@/lib/utils` → `./utils`
- `@/components/ui/<x>` → `./<x>`
- `@/hooks/use-mobile` → `./use-mobile`

Then it's automatically available at `@zenbu/ui/<name>` via the
wildcard export.

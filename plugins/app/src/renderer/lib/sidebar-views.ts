import { useMemo } from "react";
import { useDb } from "@zenbujs/core/react";

/**
 * Read a numeric `order` hint from view metadata. Userland
 * convention (not part of zenbu's `ViewMeta`): plugins set
 * `meta.order` to a number to influence sidebar / palette sort
 * order. Anything non-numeric falls back to 0.
 */
function readOrder(meta: { [key: string]: unknown } | undefined): number {
  const v = meta?.order;
  return typeof v === "number" ? v : 0;
}

export type SidebarViewEntry = {
  /** Registered view type (e.g. `"file-tree"`). Used as the tab key. */
  type: string;
  label: string;
  iconSvg?: string;
  /** Sort hint from `meta.order` (lower = earlier). Absent = 0. */
  order: number;
};

/**
 * Stable sort by `meta.order`, with registration order
 * (`registryIndex`) as the deterministic tiebreaker. Inspired by
 * VSCode's `views[].order`: there's no central authority that
 * resolves collisions \u2014 plugins pick numbers (10/20/30/\u2026 is
 * conventional so others can slot between), and the secondary
 * sort guarantees a stable result when two plugins happen to land
 * on the same value.
 */
function compareByOrder<T extends { order: number; registryIndex: number }>(
  a: T,
  b: T,
): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.registryIndex - b.registryIndex;
}

export function useSidebarViews(): SidebarViewEntry[] {
  const registry = useDb((root) => root.core.lastKnownViewRegistry ?? []);

  return useMemo<SidebarViewEntry[]>(() => {
    const out: (SidebarViewEntry & { registryIndex: number })[] = [];
    registry.forEach((entry, registryIndex) => {
      if (entry.meta?.kind === "entrypoint") return;
      if (entry.meta?.sidebar !== true) return;
      out.push({
        type: entry.type,
        label: entry.meta?.label ?? formatLabel(entry.type),
        iconSvg: entry.icon,
        order: readOrder(entry.meta),
        registryIndex,
      });
    });
    out.sort(compareByOrder);
    return out;
  }, [registry]);
}

/**
 * Left-sidebar variant of `useSidebarViews`. Filters the view
 * registry for entries tagged `meta.kind === "left-sidebar"`,
 * sorted by `meta.order` (with registration order as tiebreaker).
 *
 * Kept as a separate `kind` (rather than reusing `meta.sidebar`,
 * which already means "right sidebar") so the two surfaces stay
 * independent \u2014 a plugin can contribute to either without
 * accidentally appearing in both.
 */
export function useLeftSidebarViews(): SidebarViewEntry[] {
  const registry = useDb((root) => root.core.lastKnownViewRegistry ?? []);

  return useMemo<SidebarViewEntry[]>(() => {
    const out: (SidebarViewEntry & { registryIndex: number })[] = [];
    registry.forEach((entry, registryIndex) => {
      if (entry.meta?.kind !== "left-sidebar") return;
      out.push({
        type: entry.type,
        label: entry.meta?.label ?? formatLabel(entry.type),
        iconSvg: entry.icon,
        order: readOrder(entry.meta),
        registryIndex,
      });
    });
    out.sort(compareByOrder);
    return out;
  }, [registry]);
}

/**
 * Workspace-rail variant of `useSidebarViews`. Filters the view
 * registry for entries tagged `meta.kind === "workspace-rail"`.
 * The host's `WorkspaceRailPane` renders one `<View type={entry.type} />`
 * per result, stacked vertically in the rail's footer. Used by
 * plugins to contribute small rail-anchored affordances (e.g. the
 * settings gear button) without the host having to know about them.
 */
export function useWorkspaceRailViews(): SidebarViewEntry[] {
  const registry = useDb((root) => root.core.lastKnownViewRegistry ?? []);

  return useMemo<SidebarViewEntry[]>(() => {
    const out: (SidebarViewEntry & { registryIndex: number })[] = [];
    registry.forEach((entry, registryIndex) => {
      if (entry.meta?.kind !== "workspace-rail") return;
      out.push({
        type: entry.type,
        label: entry.meta?.label ?? formatLabel(entry.type),
        iconSvg: entry.icon,
        order: readOrder(entry.meta),
        registryIndex,
      });
    });
    out.sort(compareByOrder);
    return out;
  }, [registry]);
}

function formatLabel(type: string): string {
  const tail = type.includes("/") ? type.split("/").pop()! : type;
  return tail.replace(/[-_]/g, " ");
}

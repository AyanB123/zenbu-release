import { useMemo } from "react";
import { useInjections } from "@zenbujs/core/react";

/**
 * Read a numeric `order` hint from injection meta. Convention: a
 * `meta.order` numeric value sorts entries lowest-first; anything
 * else falls back to 0.
 */
function readOrder(meta: Record<string, unknown> | undefined): number {
  const v = meta?.order;
  return typeof v === "number" ? v : 0;
}

export type SidebarViewEntry = {
  /** Injection name (used as the tab key + `<View name=>` lookup). */
  type: string;
  label: string;
  iconSvg?: string;
  /** Sort hint from `meta.order` (lower = earlier). Absent = 0. */
  order: number;
};

/**
 * Stable sort by `meta.order`, with registration order
 * (`registryIndex`) as the deterministic tiebreaker. Same model
 * as VS Code's `views[].order` \u2014 plugins pick numbers
 * (10/20/30/\u2026 is conventional) and the secondary sort guarantees
 * stability when two plugins land on the same value.
 */
function compareByOrder<T extends { order: number; registryIndex: number }>(
  a: T,
  b: T,
): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.registryIndex - b.registryIndex;
}

function readLabel(
  meta: Record<string, unknown> | undefined,
  fallback: string,
): string {
  const v = meta?.label;
  return typeof v === "string" ? v : fallback;
}

function readIcon(meta: Record<string, unknown> | undefined): string | undefined {
  const v = meta?.icon;
  return typeof v === "string" ? v : undefined;
}

function formatLabel(name: string): string {
  const tail = name.includes("/") ? name.split("/").pop()! : name;
  return tail.replace(/[-_]/g, " ");
}

function useInjectionSlot(kind: string): SidebarViewEntry[] {
  const entries = useInjections({ kind });
  return useMemo<SidebarViewEntry[]>(() => {
    const out: (SidebarViewEntry & { registryIndex: number })[] = [];
    entries.forEach((entry, registryIndex) => {
      out.push({
        type: entry.name,
        label: readLabel(entry.meta, formatLabel(entry.name)),
        iconSvg: readIcon(entry.meta),
        order: readOrder(entry.meta),
        registryIndex,
      });
    });
    out.sort(compareByOrder);
    return out.map(({ registryIndex: _, ...rest }) => rest);
  }, [entries]);
}

/**
 * Right-sidebar slot. Injections with `meta.kind = "right-sidebar"`,
 * sorted by `meta.order`.
 */
export function useSidebarViews(): SidebarViewEntry[] {
  return useInjectionSlot("right-sidebar");
}

/**
 * Left-sidebar slot. Injections with `meta.kind = "left-sidebar"`,
 * sorted by `meta.order`.
 */
export function useLeftSidebarViews(): SidebarViewEntry[] {
  return useInjectionSlot("left-sidebar");
}

/**
 * Workspace-rail slot. The host's `WorkspaceRailPane` renders one
 * `<View name={entry.type} />` per result, stacked vertically in
 * the rail's footer. Used by plugins to contribute small
 * rail-anchored affordances (e.g. the settings gear button) without
 * the host having to know about them.
 */
export function useWorkspaceRailViews(): SidebarViewEntry[] {
  return useInjectionSlot("workspace-rail");
}

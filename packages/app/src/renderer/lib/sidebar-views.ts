import { useMemo } from "react";
import { useDb } from "@zenbujs/core/react";

export type SidebarViewEntry = {
  /** Registered view type (e.g. `"file-tree"`). Used as the tab key. */
  type: string;
  label: string;
  iconSvg?: string;
};

type RegistryEntry = {
  type: string;
  url: string;
  port: number;
  icon?: string;
  meta?: {
    kind?: string;
    sidebar?: boolean;
    label?: string;
  };
};

export function useSidebarViews(): SidebarViewEntry[] {
  const registry = useDb((root) => root.core.lastKnownViewRegistry ?? []);

  return useMemo<SidebarViewEntry[]>(() => {
    const out: SidebarViewEntry[] = [];
    for (const entry of registry) {
      if (entry.meta?.kind === "entrypoint") continue;
      if (entry.meta?.sidebar !== true) continue;
      out.push({
        type: entry.type,
        label: entry.meta?.label ?? formatLabel(entry.type),
        iconSvg: entry.icon,
      });
    }
    return out;
  }, [registry]);
}

function formatLabel(type: string): string {
  const tail = type.includes("/") ? type.split("/").pop()! : type;
  return tail.replace(/[-_]/g, " ");
}

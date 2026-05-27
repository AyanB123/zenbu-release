import { useCallback, useEffect, useMemo, useState } from "react";
import { useDb, useEvents, useRpc } from "@zenbujs/core/react";
import type { ShortcutBinding } from "@/lib/format-binding";

type Listing = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  defaultBindings: ShortcutBinding[];
  binding: ShortcutBinding | null;
  isCustom: boolean;
  isDisabled: boolean;
};

export function useShortcutBindings(): Map<string, ShortcutBinding | null> {
  const rpc = useRpc();
  const events = useEvents();
  // `useDb` on the overrides record cheaply re-runs the effect when
  // anyone (including ourselves) rebinds a shortcut.
  const overrides = useDb((root) => root.core?.shortcuts ?? {});
  const [listings, setListings] = useState<Listing[]>([]);

  const refresh = useCallback(() => {
    let cancelled = false;
    void rpc.core.shortcuts.list().then((rows) => {
      if (cancelled) return;
      setListings(rows as Listing[]);
    });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  useEffect(() => {
    return refresh();
  }, [refresh, overrides]);

  useEffect(() => {
    const off = events.core.shortcuts.changed.subscribe(() => {
      refresh();
    });
    return off;
  }, [events, refresh]);

  return useMemo(() => {
    const out = new Map<string, ShortcutBinding | null>();
    for (const l of listings) out.set(l.id, l.binding);
    return out;
  }, [listings]);
}

/**
 * Convenience: look up the binding for a single shortcut id. Returns
 * `null` when the binding is disabled or the id isn't registered.
 *
 * Most callers prefer this over `useShortcutBindings()` because they
 * only care about one id and don't want to think about Map lookups.
 */
export function useShortcutBinding(id: string): ShortcutBinding | null {
  const bindings = useShortcutBindings();
  return bindings.get(id) ?? null;
}

/** Compose the auto-registered id used by
 *  `SidebarViewShortcutsService` so call sites don't re-derive it. */
export function sidebarViewShortcutId(
  viewType: string,
  kind: "left" | "right",
): string {
  return `app.openSidebarView.${kind}.${viewType}`;
}

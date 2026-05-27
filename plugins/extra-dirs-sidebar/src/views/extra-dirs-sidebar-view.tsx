import { useCallback, useMemo } from "react";
import {
  useDb,
  useDbClient,
  useRpc,
  type ViewComponentProps,
} from "@zenbujs/core/react";

/**
 * Component-mode view for the "Add dir to context" right-sidebar tab.
 *
 * Runs in-process inside the host renderer realm — so it can `useDb`
 * / `useRpc` against the host's services directly. Args (`scopeId`)
 * are threaded in from the host shell so this view never has to
 * touch host-internal hooks like `useActiveScopeId` (which would
 * couple us to the host's `@/lib/...` layout).
 *
 * Lists `scope.extraDirectories` for the active scope. Each entry
 * uses a small bordered row with a "…" hover button that opens a
 * native context menu with Reveal / Copy / Remove actions.
 * Removing a directory simply edits the DB; the host's
 * `SessionsService` picks up the change and reloads the resource
 * loader behind the scenes.
 */
type ExtraDirsArgs = { scopeId?: string | null };

export default function ExtraDirsSidebarView({
  args,
}: ViewComponentProps<ExtraDirsArgs>) {
  const activeScopeId = args?.scopeId ?? null;
  const dirs = useDb((root) => {
    if (!activeScopeId) return null;
    const scope = root.app.scopes[activeScopeId];
    if (!scope) return null;
    return scope.extraDirectories;
  });
  const dbClient = useDbClient();
  const rpc = useRpc();

  const rows = useMemo(() => dirs ?? [], [dirs]);

  const handleRemove = useCallback(
    async (dir: string) => {
      if (!activeScopeId) return;
      await dbClient.update((root) => {
        const scope = root.app.scopes[activeScopeId];
        if (!scope) return;
        scope.extraDirectories = scope.extraDirectories.filter((d) => d !== dir);
      });
    },
    [activeScopeId, dbClient],
  );

  const handleReveal = useCallback(
    async (dir: string) => {
      try {
        const { error } = await rpc.app.dialog.openInFileBrowser({ path: dir });
        if (error) console.warn("[extra-dirs] openInFileBrowser:", error);
      } catch (err) {
        console.warn("[extra-dirs] openInFileBrowser threw:", err);
      }
    },
    [rpc],
  );

  const handleCopyPath = useCallback(async (dir: string) => {
    try {
      await navigator.clipboard.writeText(dir);
    } catch (err) {
      console.warn("[extra-dirs] clipboard.writeText failed:", err);
    }
  }, []);

  const handleAdd = useCallback(async () => {
    if (!activeScopeId) return;
    try {
      const result = await rpc.app.dialog.pickFolder();
      if (result.cancelled) return;
      const picked = result.path;
      await dbClient.update((root) => {
        const scope = root.app.scopes[activeScopeId];
        if (!scope) return;
        if (scope.extraDirectories.includes(picked)) return;
        if (scope.directory === picked) return;
        scope.extraDirectories = [...scope.extraDirectories, picked];
      });
    } catch (err) {
      console.warn("[extra-dirs] pickFolder failed:", err);
    }
  }, [activeScopeId, dbClient, rpc]);

  if (!activeScopeId) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
        Open a chat to add directories to its context.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col px-1.5">
      <div className="px-2 pt-2 pb-1">
        <div className="text-[12px] font-medium text-foreground">
          Add dir to context
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((dir) => (
          <ExtraDirRow
            key={dir}
            path={dir}
            onOpenMenu={async (e) => {
              const rect = (
                e.currentTarget as HTMLButtonElement
              ).getBoundingClientRect();
              const { chosenId } = await rpc.app.contextMenu.show({
                x: Math.round(rect.right),
                y: Math.round(rect.bottom),
                items: [
                  { id: "reveal", label: "Reveal in file browser", enabled: true },
                  { id: "copy", label: "Copy path", enabled: true },
                  { type: "separator" },
                  { id: "remove", label: "Remove from session", enabled: true },
                ],
              });
              if (chosenId === "reveal") void handleReveal(dir);
              else if (chosenId === "copy") void handleCopyPath(dir);
              else if (chosenId === "remove") void handleRemove(dir);
            }}
          />
        ))}
        <AddDirRow onClick={handleAdd} />
      </div>
    </div>
  );
}

function AddDirRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hg-row group relative flex min-h-[30px] min-w-0 cursor-default select-none items-center gap-2 overflow-hidden rounded-md border border-dashed border-border/60 py-1.5 pl-1.5 pr-2 text-[13px] text-muted-foreground hover:border-border"
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <PlusIcon />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">Add dir to context</span>
    </button>
  );
}

function ExtraDirRow({
  path,
  onOpenMenu,
}: {
  path: string;
  onOpenMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="group relative flex min-h-[30px] min-w-0 items-center gap-2 overflow-hidden rounded-md border border-border/60 bg-foreground/[0.025] py-1.5 pl-1.5 pr-2 text-muted-foreground">
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {basename(path) || path}
      </span>
      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
        <RowActionButton title="Actions" onClick={onOpenMenu}>
          <MoreIcon />
        </RowActionButton>
      </span>
    </div>
  );
}

function RowActionButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="flex h-[20px] w-[20px] items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
    >
      {children}
    </button>
  );
}

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

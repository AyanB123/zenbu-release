import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TerminalTabEntry = {
  id: string;
  title: string;
};

export type TerminalTabsProps = {
  entries: TerminalTabEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
  /** Kept on the public API for callers, but the bottom corner is always
   * flush against the outer app shell now — it owns the bottom-right
   * curve. */
  rightAdjacent?: boolean;
};

/** Vertical VS Code-style tab list rendered down the right edge of the
 * terminal panel. The panel intentionally shares its background with the
 * terminal pane (and the active tab uses a subtle `--muted` tint) so the
 * whole bottom strip reads as one surface, with the title list quietly
 * indexing the running shells. The new-terminal control is a single
 * icon-only `+` at the top, the close affordance is a trash icon that
 * fades in on row hover. */
export function TerminalTabs({
  entries,
  activeId,
  onSelect,
  onClose,
  onCreate,
  rightAdjacent = false,
}: TerminalTabsProps) {
  // We keep the bottom border so the shell's bottom edge stays visible;
  // the outer `overflow-hidden rounded-[10px]` clips it into the outer
  // curve. What we drop is `rounded-br-lg` so we don't stack on top of
  // the shell's bottom-right corner.
  void rightAdjacent
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden border-b border-r bg-background"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-1">
        {entries.map((entry) => (
          <TerminalTabRow
            key={entry.id}
            title={entry.title}
            isActive={entry.id === activeId}
            onSelect={() => onSelect(entry.id)}
            onClose={() => onClose(entry.id)}
          />
        ))}
        <NewTerminalRow onCreate={onCreate} />
      </div>
    </div>
  );
}

function TerminalTabRow({
  title,
  isActive,
  onSelect,
  onClose,
}: {
  title: string;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const display = stripShellPrefix(title);
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex h-7 select-none items-center gap-2 px-3 text-[12px] text-muted-foreground",
        isActive
          ? "bg-muted text-foreground"
          : "hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span
        aria-label={title}
        className="min-w-0 flex-1 truncate text-left"
        style={{ direction: "rtl" }}
      >
        {display}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close terminal"
        className="grid size-4 place-items-center text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function NewTerminalRow({ onCreate }: { onCreate: () => void }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      aria-label="New terminal"
      className="flex h-7 items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground"
    >
      <PlusIcon />
    </button>
  );
}

/** Many shells set the terminal title to `user@host: cwd` (bash default)
 * or `user@host — cwd` (zsh/macOS). The host prefix burns most of the
 * available width in a narrow tab list and tells the user nothing about
 * which shell this is, so drop it when present. */
function stripShellPrefix(title: string): string {
  const m = title.match(/^[^\s@:]+@[^\s:]+\s*[:\u2014-]\s*(.+)$/);
  return m ? m[1] : title;
}

function PlusIcon(): ReactNode {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon(): ReactNode {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

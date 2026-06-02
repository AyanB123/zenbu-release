import { ErrorBoundary } from "../common/error-boundary";
import { ArchiveWorktreeDialog } from "../dialogs/archive-worktree-dialog";
import { CreateWorktreeDialog } from "../dialogs/create-worktree-dialog";
import { LeftSidebar } from "./left-sidebar";
import { WorkspaceTitleBar } from "./workspace-title-bar";
import { WorkspaceBody } from "./workspace-body";
import { WorkspaceRailPane } from "./workspace-rail-pane";
import { useAgentSidebarEvents } from "../../hooks/use-agent-sidebar-events";
import { useFocusPaneShortcut } from "../../hooks/use-focus-pane-shortcut";
import { useNavigateTabsShortcut } from "../../hooks/use-navigate-tabs-shortcut";
import { useFocusActiveComposerShortcut } from "../../hooks/use-focus-active-composer-shortcut";
import { useOpenSidebarViewEvent } from "../../hooks/use-open-sidebar-view-event";
import {
  setCreateWorktreeDialogOpen,
  useCreateWorktreeDialogState,
} from "@/lib/create-worktree-dialog-store";
import { useActiveRepo } from "../../hooks/use-sidebar-selectors";
import { useOnWorktreeCreated } from "../../hooks/use-on-worktree-created";
import { useHasTrafficLights } from "@/lib/window-state/has-traffic-lights";

/** The application window's workspace shell.
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ WorkspaceTitleBar                                       │
 *   ├─────┬───────────────────────────────────────────────────┤
 *   │     │ WorkspaceBody                                     │
 *   │ R   │ ┌────────────┬─────────────────────┬────────────┐ │
 *   │ a   │ │            │ ChatsArea           │ RightSide- │ │
 *   │ i   │ │AgentSidebar│                     │ bar        │ │
 *   │ l   │ │            ├─────────────────────┴────────────┤ │
 *   │     │ │            │ BottomPanel                      │ │
 *   │     │ └────────────┴──────────────────────────────────┘ │
 *   └─────┴───────────────────────────────────────────────────┘
 *
 *  */
export function WorkspaceShell() {
  useAgentSidebarEvents();
  useFocusPaneShortcut();
  useNavigateTabsShortcut();
  useFocusActiveComposerShortcut();
  useOpenSidebarViewEvent();
  const framed = useHasTrafficLights();

  return (
    <div
      className={
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-muted bg-clip-padding" +
        (framed ? " border" : "")
      }
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <ErrorBoundary label="Title bar">
        <WorkspaceTitleBar />
      </ErrorBoundary>

      <div
        className="flex min-h-0 min-w-0 flex-1 flex-row"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <WorkspaceRailPane />
        <div className="relative min-h-0 min-w-0 flex-1">
          <ErrorBoundary label="Workspace">
            <WorkspaceBody sidebarSlot={<LeftSidebar />} />
          </ErrorBoundary>
        </div>
      </div>

      <CreateWorktreeDialogConnected />
      <ArchiveWorktreeDialog />
    </div>
  );
}

function CreateWorktreeDialogConnected() {
  const dialog = useCreateWorktreeDialogState();
  const activeRepo = useActiveRepo();
  const onCreated = useOnWorktreeCreated();
  return (
    <CreateWorktreeDialog
      open={dialog.open}
      onOpenChange={setCreateWorktreeDialogOpen}
      repoId={activeRepo?.id ?? null}
      mainWorktreePath={activeRepo?.mainWorktreePath ?? null}
      mainWorktreeBranch={
        activeRepo?.worktrees.find(
          (w) => w.path === activeRepo.mainWorktreePath,
        )?.branch ?? null
      }
      defaultSourceRef={dialog.sourceRef}
      onCreated={onCreated}
    />
  );
}

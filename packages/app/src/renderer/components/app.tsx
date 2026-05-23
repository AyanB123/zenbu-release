import { useEffect, useState } from "react";
import { useDb, useDbClient } from "@zenbujs/core/react";
import { AgentSidebarPane } from "./agent-sidebar-pane";
import { AgentsPalette } from "./command-palette/agents-palette";
import { CommandPalette } from "./command-palette/palette";
import { Settings } from "./settings";
import { useThemeSync } from "@/lib/theme";
import {
  selectWorkspaceInRoot,
  useActiveView,
  useShowOnboardingView,
  useWindowId,
} from "@/lib/window-state";

export function App() {
  const workspaces = useDb((root) =>
    Object.values(root.app.workspaces).filter((w) => !w.archived),
  );
  const activeView = useActiveView();
  const windowId = useWindowId();
  const dbClient = useDbClient();
  const showOnboardingView = useShowOnboardingView();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useThemeSync();

  // Reconcile `activeView` with the set of available workspaces.
  //
  //   - `onboarding` is intentional user state (rail "+"), so we
  //     never override it. On a fresh install with no workspaces
  //     it's also the schema default, which is correct.
  //   - `workspace` pointing at a missing / archived workspace can
  //     happen after delete / archive. Pick the newest remaining
  //     non-archived workspace, or drop to onboarding when none
  //     are left.
  useEffect(() => {
    if (activeView.kind !== "workspace") return;
    if (workspaces.some((w) => w.id === activeView.workspaceId)) return;
    const newest = workspaces
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (newest) {
      void dbClient.update((root) => {
        selectWorkspaceInRoot(root, windowId, newest.id);
      });
    } else {
      showOnboardingView();
    }
  }, [workspaces, activeView, dbClient, windowId, showOnboardingView]);

  return (
    <>
      <div className="flex h-full flex-col ">
        <div className="min-h-0 flex-1">
          <AgentSidebarPane onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </div>
      <Settings open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CommandPalette />
      <AgentsPalette />
    </>
  );
}

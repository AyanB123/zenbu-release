import { useEffect, useState } from "react";
import { useDb, useDbClient } from "@zenbujs/core/react";
import { AgentSidebarPane } from "./agent-sidebar-pane";
import { AgentsPalette } from "./command-palette/agents-palette";
import { CommandPalette } from "./command-palette/palette";
import { Settings } from "./settings";
import { useThemeSync } from "@/lib/theme";
import {
  selectWorkspaceInRoot,
  useActiveWorkspaceId,
  useWindowId,
} from "@/lib/window-state";

export function App() {
  const workspaces = useDb((root) =>
    Object.values(root.app.workspaces).filter((w) => !w.archived),
  );
  const activeWorkspaceId = useActiveWorkspaceId();
  const windowId = useWindowId();
  const dbClient = useDbClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useThemeSync();

  // Auto-select a workspace on boot when the window has none or the
  // remembered one was deleted. Picks the newest non-archived workspace.
  useEffect(() => {
    if (
      activeWorkspaceId &&
      workspaces.some((w) => w.id === activeWorkspaceId)
    )
      return;
    const newest = workspaces
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!newest) return;
    void dbClient.update((root) => {
      selectWorkspaceInRoot(root, windowId, newest.id);
    });
  }, [workspaces, activeWorkspaceId, dbClient, windowId]);

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

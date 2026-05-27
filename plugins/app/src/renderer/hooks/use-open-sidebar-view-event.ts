import { useEffect } from "react";
import { useEvents } from "@zenbujs/core/react";
import {
  useLeftSidebarOpen,
  useLeftSidebarTab,
  useSetLeftSidebarOpen,
  useSetLeftSidebarTab,
} from "@/lib/window-state/workspace-ui";
import {
  useRightSidebarOpenType,
  useSetRightSidebarOpenType,
} from "@/lib/window-state/scope-ui";

export function useOpenSidebarViewEvent() {
  const events = useEvents();
  const leftOpen = useLeftSidebarOpen();
  const leftTab = useLeftSidebarTab();
  const setLeftOpen = useSetLeftSidebarOpen();
  const setLeftTab = useSetLeftSidebarTab();
  const rightOpenType = useRightSidebarOpenType();
  const setRightOpenType = useSetRightSidebarOpenType();

  useEffect(() => {
    const off = events.app.openSidebarView.subscribe(({ viewType, kind }) => {
      if (kind === "left") {
        // Already showing this view in an open sidebar -> close.
        if (leftOpen && leftTab === viewType) {
          setLeftOpen(false);
          return;
        }
        // Otherwise open + switch. `useSetLeftSidebarOpen` and
        // `useSetLeftSidebarTab` write to different keys in the
        // same scope; fire both so the view appears immediately.
        if (!leftOpen) setLeftOpen(true);
        if (leftTab !== viewType) setLeftTab(viewType);
        return;
      }

      // kind === "right"
      if (rightOpenType === viewType) {
        setRightOpenType(null);
        return;
      }
      setRightOpenType(viewType);
    });
    return off;
  }, [
    events,
    leftOpen,
    leftTab,
    setLeftOpen,
    setLeftTab,
    rightOpenType,
    setRightOpenType,
  ]);
}

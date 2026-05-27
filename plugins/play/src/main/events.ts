export type Events = {
  /** A chunk of stdout/stderr from a running play-button run. The
   * renderer subscribes to the same data via the `logs` collection
   * on the workspace's playConfig — this event is only useful for
   * cases where you want to react to output without re-rendering
   * the whole list (we don't currently). Kept around for parity
   * with the host's `terminalData` and as a future hook for
   * streaming notifications. */
  playLog: {
    workspaceId: string
    runId: string
    stream: "stdout" | "stderr" | "system"
    data: string
  }
  /** A play-button run finished (or errored). */
  playExit: {
    workspaceId: string
    runId: string
    /** Process exit code, or null when we never got far enough to
     * spawn (e.g. shell-env failure). */
    exitCode: number | null
    /** Best-effort error message when the spawn itself blew up. */
    error?: string
  }
}

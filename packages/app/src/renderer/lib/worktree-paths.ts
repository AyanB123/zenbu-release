/**
 * Derive a default on-disk path for a new worktree from the repo's
 * main worktree path and a branch name.
 *
 *   <parentDir>/<repoName>-<safeBranch>
 *
 * Slashes/colons/backslashes inside the branch are folded to `-` so the
 * resulting path is a valid POSIX directory name. Shared by:
 *
 *   - `CreateWorktreeDialog` (the full "Create worktree" dialog).
 *   - `WorkspaceSelector` (the `/workspace` slash command panel).
 *
 * Kept side-effect-free and renderer-safe (no node `path` import).
 */
export function defaultWorktreePath(
  mainWorktreePath: string,
  branch: string,
): string {
  const parentDir = parentOf(mainWorktreePath)
  const repoName = basenameOf(mainWorktreePath)
  const safeBranch = branch.replace(/[/\\:]+/g, "-")
  return `${parentDir}/${repoName}-${safeBranch}`
}

function parentOf(p: string): string {
  const idx = p.replace(/\/+$/, "").lastIndexOf("/")
  if (idx <= 0) return "/"
  return p.slice(0, idx)
}

function basenameOf(p: string): string {
  const trimmed = p.replace(/\/+$/, "")
  const idx = trimmed.lastIndexOf("/")
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

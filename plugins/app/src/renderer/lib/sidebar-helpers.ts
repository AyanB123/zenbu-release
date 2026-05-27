import type { Schema } from "../../main/schema"

type Chat = Schema["chats"][string]
type Scope = Schema["scopes"][string]
type Workspace = Schema["workspaces"][string]
type Repo = Schema["repos"][string]

export function workspaceLabel(workspace: Workspace): string {
  return workspace.name
}

export function directoryBasename(dir: string): string {
  const parts = dir.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? dir
}

/** Label for a worktree-group header row. Prefers the worktree's
 * branch name when we have repo metadata for it, falling back to
 * the directory basename when the scope isn't backed by a git
 * worktree or repo info hasn't been synced yet. */
export function worktreeGroupLabel(
  scope: Scope,
  repo: Repo | null,
): string {
  if (repo) {
    const wt = repo.worktrees.find(w => w.path === scope.directory)
    if (wt?.branch) return wt.branch
  }
  return directoryBasename(scope.directory)
}

export function scopeForChat(
  scopeId: string,
  scopes: Scope[],
): Scope | undefined {
  return scopes.find(s => s.id === scopeId)
}

/** A sidebar row is "active" when the chat currently focused in
 * the active pane belongs to the same session as the row's
 * representative chat. Ensures ⌘/ splits don't visually split the
 * row — one row stays lit while the user toggles between panes
 * that share the session. */
export function isChatActiveForSession(
  row: Chat,
  activeChatId: string | null,
  allChats: Chat[],
): boolean {
  if (!activeChatId) return false
  if (row.id === activeChatId) return true
  if (row.session.kind !== "ready") return false
  const active = allChats.find(c => c.id === activeChatId)
  if (!active || active.session.kind !== "ready") return false
  return active.session.sessionId === row.session.sessionId
}

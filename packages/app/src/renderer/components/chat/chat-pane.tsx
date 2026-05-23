import { useEffect, useMemo, useRef, useState } from "react"
import { useCollection, useDb, useDbClient, useRpc } from "@zenbujs/core/react"
import { ChatDisplay } from "./chat-display"
import { InvariantOverlay } from "./devtools/invariant-overlay"
import { useMessageDeliveryInvariant } from "./devtools/use-message-delivery-invariant"
import { materializeMessages } from "./lib/materialize"
import { QueuedMessages } from "./queued-messages"
import { ForkSelector } from "./fork-selector"
import { TreeSelector } from "./tree-selector"
import { WorkspaceSelector } from "./workspace-selector"
import { WorktreeHandoffSelector } from "./worktree-handoff-selector"
import { Composer, type ComposerSubmitPayload } from "../composer/composer"
import { useChatDraft } from "./lib/use-chat-draft"
import { AppStatusBar } from "../status-bar/app-status-bar"
import type { AgentConfig } from "../composer/composer-toolbar"
import type { ComboboxOption } from "../composer/combobox"
import type { FileEntry, SlashCommand } from "../composer/types"
import { cn } from "@/lib/utils"
import { ErrorBoundary } from "../common/error-boundary"
import { FileIndexContext } from "./lib/file-index-context"
import {
  useChatBackground,
  useChatBackgroundUrl,
} from "@/lib/chat-background"
import { openChatInNewTabInRoot, useWindowId } from "@/lib/window-state"
import type { Schema } from "../../../main/schema"

type Chat = Schema["chats"][string]
type Session = Schema["sessions"][string]

const PI_AGENT_ID = "pi"
const THINKING_LEVELS: ReadonlyArray<{
  value: Session["thinkingLevel"]
  name: string
}> = [
  { value: "off", name: "Off" },
  { value: "minimal", name: "Minimal" },
  { value: "low", name: "Low" },
  { value: "medium", name: "Medium" },
  { value: "high", name: "High" },
  { value: "xhigh", name: "Extra High" },
]

export type ChatPaneProps = {
  chat: Chat | null
  /** When false, the chat-pane rounds its left corners (no adjacent panel). */
  leftAdjacent?: boolean
  /** When true, another panel sits flush below (e.g. terminal). Kept on the
   * public API for callers, but the chat-pane no longer draws a bottom
   * border or bottom corner rounding either way — the outer app shell owns
   * the bottom edge. */
  bottomAdjacent?: boolean
  /** When true, another panel sits flush to the right (e.g. a sidebar
   * view). Strips the chat-pane's right corners so the two panes read
   * as one continuous frame. */
  rightAdjacent?: boolean
  /** When true, something sits flush above this pane (e.g. a tab bar).
   * Drops the top border + top corner rounding so the bar above owns
   * the top edge of the frame instead. */
  topAdjacent?: boolean
}

export function ChatPane({
  chat,
  leftAdjacent = false,
  bottomAdjacent = false,
  rightAdjacent = false,
  topAdjacent = false,
}: ChatPaneProps) {
  const windowId = useWindowId()
  const rpc = useRpc()
  const dbClient = useDbClient()
  const scrollToBottomRef = useRef<(() => void) | null>(null)

  const sessionId =
    chat?.session.kind === "ready" ? chat.session.sessionId : null

  useEffect(() => {
    if (!sessionId) return
    const subscriberId = `window-${windowId}-${sessionId}`
    rpc.app.sessions
      .subscribe({ sessionId, subscriberId })
      .catch(err => console.error("[chat] subscribe failed:", err))
    return () => {
      rpc.app.sessions
        .unsubscribe({ sessionId, subscriberId })
        .catch(err => console.error("[chat] unsubscribe failed:", err))
    }
  }, [sessionId, windowId, rpc])

  const background = useChatBackground()
  const backgroundUrl = useChatBackgroundUrl(background)

  const session = useDb(root =>
    sessionId ? root.app.sessions[sessionId] : undefined,
  )
  const eventLogRef = useDb(root =>
    sessionId ? root.app.sessions[sessionId]?.eventLog : undefined,
  )
  const { items: events } = useCollection(eventLogRef)
  const models = useDb(root => root.app.models)

  // Per-scope path index, maintained by FileTreeService. Reading it through
  // useDb means the @ menu opens with files already populated — no RPC,
  // no waiting on the first walk to finish, and updates stream in as the
  // service publishes chunks.
  const filePaths = useDb(root =>
    chat ? root.app.fileTreeIndexes[chat.scopeId]?.paths : undefined,
  )
  // Worktree directory the chat is anchored at. Threaded through
  // `materializeMessages` so the post-turn summary card knows which
  // `directory` to forward when it opens a `git-diff` split, and so
  // it can strip the absolute-path prefix off edit-tool args (most
  // tools record `file_path` as an absolute path).
  const chatDirectory = useDb(root =>
    chat ? root.app.scopes[chat.scopeId]?.directory ?? null : null,
  )
  // Workspace + scope the chat owns. Threaded through to the
  // turn-summary card so clicking a file opens the diff in *this*
  // chat's workspace/worktree instead of whatever the window's
  // active workspace happens to be at click time. Without this the
  // shell falls back to `activeWorkspaceIdOf(ws)` and the diff can
  // end up in a sibling workspace's pane state — silently teleporting
  // the user there.
  const chatScopeId = chat?.scopeId ?? null
  const chatWorkspaceId = useDb(root =>
    chat ? root.app.scopes[chat.scopeId]?.workspaceId ?? null : null,
  )
  const files = useMemo<FileEntry[]>(() => {
    if (!filePaths) return []
    const out: FileEntry[] = new Array(filePaths.length)
    for (let i = 0; i < filePaths.length; i++) {
      const p = filePaths[i]!
      const slash = p.lastIndexOf("/")
      out[i] = { path: p, name: slash >= 0 ? p.slice(slash + 1) : p }
    }
    return out
  }, [filePaths])

  const currentModelValue =
    session?.model ? `${session.model.provider}/${session.model.id}` : undefined
  const currentModel: Schema["models"][string] | undefined =
    currentModelValue ? models[currentModelValue] : undefined

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    return Object.values(models).map(m => ({
      value: `${m.provider}/${m.id}`,
      name: m.name,
      description: m.provider,
    }))
  }, [models])

  const thinkingOptions = useMemo<ComboboxOption[]>(() => {
    if (!currentModel || !currentModel.reasoning) return []
    return THINKING_LEVELS.filter(l => {
      const map = currentModel.thinkingLevelMap
      if (!map) return true
      const mapped = map[l.value]
      return mapped !== null
    }).map(l => ({ value: l.value, name: l.name }))
  }, [currentModel])

  const agentConfigs = useMemo<AgentConfig[]>(
    () => [
      {
        id: PI_AGENT_ID,
        name: "pi",
        availableModels: modelOptions,
        availableThinkingLevels: thinkingOptions,
      },
    ],
    [modelOptions, thinkingOptions],
  )

  // Per-chat lock state. When `locked`, the composer refuses to submit
  // and shows a lock icon in place of the interrupt button. Stored in
  // the DB so it survives reloads and follows the chat as you switch.
  const locked = useDb(root =>
    chat ? root.app.chatStates[chat.id]?.locked ?? false : false,
  )

  // What the plain Enter key does while streaming: queue (followUp)
  // or steer. Configurable from Settings; also flippable in-line via
  // the `/set-default-...` slash command. Mod-Enter and the `/steer`
  // / `/queue` slash commands ignore this and force their own intent.
  const defaultSendMode = useDb(root => root.app.settings.defaultSendMode)

  // The slash menu lists:
  //   - `/queue` and `/steer`: send the current input with that
  //     intent right now. Picking the command IS the send — no
  //     sticky mode chip in the input.
  //   - exactly one of `/set-default-queue` or `/set-default-steer`:
  //     whichever flips the current default. Showing both would let
  //     the user pick the no-op.
  //   - exactly one of `/lock` or `/unlock`, same idea.
  const slashCommands = useMemo<SlashCommand[]>(() => {
    const sendCmds: SlashCommand[] = [
      {
        id: "queue",
        label: "queue",
        description: "send now, queue after the current turn finishes",
        submitWith: "followUp",
      },
      {
        id: "steer",
        label: "steer",
        description: "send now, interject before the agent's next LLM call",
        submitWith: "steer",
      },
    ]
    const defaultCmd: SlashCommand =
      defaultSendMode === "followUp"
        ? {
            id: "set-default-steer",
            label: "set default to steer",
            description: "plain Enter while streaming will steer",
            action: "set-default-steer",
          }
        : {
            id: "set-default-queue",
            label: "set default to queue",
            description: "plain Enter while streaming will queue",
            action: "set-default-queue",
          }
    const lockCmd: SlashCommand = locked
      ? {
          id: "unlock",
          label: "unlock",
          description: "allow Enter to send again",
          action: "unlock",
        }
      : {
          id: "lock",
          label: "lock",
          description: "lock the input so Enter inserts a newline",
          action: "lock",
        }
    const treeCmd: SlashCommand = {
      id: "tree",
      label: "tree",
      description: "browse the session tree (vim nav + search)",
      action: "openTree",
    }
    const cloneCmd: SlashCommand = {
      id: "clone",
      label: "clone",
      description: "duplicate the session at the current position",
      action: "clone",
    }
    const forkCmd: SlashCommand = {
      id: "fork",
      label: "fork",
      description: "fork at a user message (re-edit in a new tab)",
      action: "openFork",
    }
    const workspaceCmd: SlashCommand = {
      id: "workspace",
      label: "move-to-workspace",
      description: "move this chat into a new git worktree",
      action: "openWorkspace",
    }
    const handoffCmd: SlashCommand = {
      id: "worktree-handoff",
      label: "worktree-handoff",
      description:
        "bring this worktree's commits onto another worktree's branch",
      action: "openHandoff",
    }
    return [
      ...sendCmds,
      treeCmd,
      forkCmd,
      workspaceCmd,
      handoffCmd,
      cloneCmd,
      defaultCmd,
      lockCmd,
    ]
  }, [locked, defaultSendMode])

  // Panel state for slash commands that take over the composer
  // slot. `/tree` and `/fork` share the same component with
  // different confirmation flows; `/workspace` is its own panel
  // (branch-name input). All three render at the same DOM slot,
  // mutually exclusive, so we model them in one union here.
  const [treePanel, setTreePanel] = useState<
    | { kind: "closed" }
    | { kind: "navigate" }
    | { kind: "fork" }
    | { kind: "workspace" }
    | { kind: "handoff" }
  >({ kind: "closed" })
  const treePanelOpen = treePanel.kind !== "closed"

  const handleSlashAction = (action: string) => {
    if (!chat) return
    if (action === "openTree") {
      if (!sessionId) return
      setTreePanel({ kind: "navigate" })
      return
    }
    if (action === "openFork") {
      if (!sessionId) return
      setTreePanel({ kind: "fork" })
      return
    }
    if (action === "openWorkspace") {
      // Unlike `/tree` and `/fork`, `/workspace` does NOT require a
      // live session id — a pending chat still has a scope, and
      // moving it before the first prompt is a sensible flow
      // ("branch off before I start").
      setTreePanel({ kind: "workspace" })
      return
    }
    if (action === "openHandoff") {
      // `/worktree-handoff` also works on pending chats: the source
      // is the current chat's scope/worktree; we don't need an
      // active session to inspect git state.
      setTreePanel({ kind: "handoff" })
      return
    }
    if (action === "clone") {
      if (!sessionId) return
      // Clone now opens the new session in a SIBLING tab inside the
      // active pane (instead of replacing the active tab's chat).
      // The cloned session lives next to the original so the user
      // can switch between them — the cloning point is itself a
      // "branch and keep both" gesture.
      void (async () => {
        try {
          const result = await rpc.app.sessions.clone({ sessionId })
          dbClient.update(root => {
            openChatInNewTabInRoot(root, windowId, result.chatId)
          })
        } catch (err) {
          console.error("[chat] clone failed:", err)
        }
      })()
      return
    }
    if (action === "lock") {
      // Direct replica update — see project rule on preferring replica
      // writes over RPC for instant feedback.
      dbClient.update(root => {
        const prev = root.app.chatStates[chat.id]
        root.app.chatStates[chat.id] = {
          chatId: chat.id,
          locked: true,
          draft: prev?.draft ?? "",
        }
      })
    } else if (action === "unlock") {
      dbClient.update(root => {
        const existing = root.app.chatStates[chat.id]
        if (existing) existing.locked = false
      })
    } else if (action === "set-default-steer") {
      dbClient.update(root => {
        root.app.settings.defaultSendMode = "steer"
      })
    } else if (action === "set-default-queue") {
      dbClient.update(root => {
        root.app.settings.defaultSendMode = "followUp"
      })
    }
  }

  const handleUnlock = () => {
    if (!chat) return
    dbClient.update(root => {
      const existing = root.app.chatStates[chat.id]
      if (existing) existing.locked = false
    })
  }

  const messages = useMemo(() => {
    if (!session) return []
    return materializeMessages(events, {
      directory: chatDirectory,
      workspaceId: chatWorkspaceId,
      scopeId: chatScopeId,
    })
  }, [events, session, chatDirectory, chatWorkspaceId, chatScopeId])

  // Detector for the "sent a message, it didn't render" class of
  // bug. Calls into the renderer-side invariant store when an
  // expected user_prompt event or queueDraft entry doesn't show up
  // within the timeout. `track()` is invoked from handleSubmit
  // below right before the corresponding RPC.
  const deliveryInvariant = useMessageDeliveryInvariant({
    chatId: chat?.id ?? null,
    sessionId,
    events,
    queueDraft: session?.queueDraft ?? [],
    eventLogRef: (eventLogRef as unknown as
      | { collectionId: string; debugName: string }
      | null) ?? null,
  })

  // Live stats for the streaming "Xs, N tokens" footer.
  //
  // We read the context-window measurement (`stats.contextUsage.tokens`)
  // — the same value the context-view and status-bar already surface.
  // Subtracting the snapshot taken on `agent_start`
  // (`runStartContextTokens`) yields the tokens this run added to
  // the conversation. We intentionally do NOT use the billing
  // rollup `stats.tokens.input/output/...`: that field sums every
  // LLM call's `usage.input` and double-counts the growing context
  // across multi-turn (tool-call) runs, so it balloons WAY past
  // what the context view shows.
  //
  // Start timestamp: the wall-clock of the most recent user prompt
  // we've materialized. Loading derives elapsed seconds from this.
  const cumulativeContextTokens = session?.stats.contextUsage?.tokens ?? 0
  const baselineContextTokens =
    session?.runStartContextTokens ?? cumulativeContextTokens
  const loadingStats = useMemo(() => {
    let startTimestamp: number | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "user" && m.timeSent) {
        startTimestamp = m.timeSent
        break
      }
    }
    // Clamp to >=0: if a turn lands before runStartContextTokens
    // is set (race on agent_start ordering), the subtraction would
    // briefly go negative.
    const tokens = Math.max(
      0,
      cumulativeContextTokens - baselineContextTokens,
    )
    return { startTimestamp, tokens }
  }, [messages, cumulativeContextTokens, baselineContextTokens])

  // Per-chat draft persistence. Returns "" + no-op handlers when
  // there's no chat yet (pre-empty-state); the hook itself guards
  // against writes to an empty chatId.
  const { initialText, onDraftChange, flushDraft } = useChatDraft(
    chat?.id ?? "",
  )

  const cornerClass = cornerRoundingClass({
    leftAdjacent,
    rightAdjacent,
    topAdjacent,
  })
  // We still draw the bottom border so the bottom edge of the shell stays
  // visible — the outer shell's `overflow-hidden rounded-[10px]` clips it
  // into the outer curve. What we *don't* draw is the bottom corner
  // rounding, because that would stack on top of the shell's curve.
  // When something sits above us (e.g. the tab bar), it owns the top
  // border too — otherwise we'd double up the line.
  void bottomAdjacent
  const borderClass = [
    topAdjacent ? null : "border-t",
    bottomAdjacent ? null : "border-b",
    rightAdjacent ? null : "border-r",
  ]
    .filter(Boolean)
    .join(" ")

  if (!chat) {
    return (
      <ChatEmptyState
        message="No chat selected."
        cornerClass={cornerClass}
        borderClass={borderClass}
      />
    )
  }

  const isReady = chat.session.kind === "ready" && !!session
  const streaming = isReady ? session.isStreaming : false
  const displayMessages = isReady
    ? messages
    : materializeMessages([], {
        directory: chatDirectory,
        workspaceId: chatWorkspaceId,
        scopeId: chatScopeId,
      })

  const handleSubmit = async (payload: ComposerSubmitPayload) => {
    if (!isReady || !sessionId) return
    // Composer clears its own doc on submit — the resulting
    // onDraftChange("") schedules a debounced flush. We deliberately
    // do NOT call flushDraft() here: at this point in handleSubmit
    // the doc still contains the just-sent text (Composer's clear
    // dispatch happens AFTER onSubmit returns), so an eager flush
    // would persist it. The 250ms debounce + cleanup-time flush is
    // enough to handle a hot reload before submit completes.
    void flushDraft
    // Intent resolution:
    //   not streaming  → ignore intent, send as a regular prompt.
    //   streaming      → explicit intent wins; default is followUp.
    // Use the display text for invariant tracking — that's what the
    // user-message bubble (and queue-draft entry) actually persist,
    // so matching against `events`/`queueDraft` works.
    const trackedText = payload.displayText ?? payload.text
    if (!session.isStreaming) {
      deliveryInvariant.track(trackedText, "prompt")
      try {
        await rpc.app.sessions.prompt({
          sessionId,
          text: payload.text,
          displayText: payload.displayText,
          images: payload.images,
          imageRefs: payload.imageRefs,
        })
      } catch (err) {
        console.error("[chat] prompt failed:", err)
      }
      return
    }
    // Explicit intent (Mod-Enter, `/steer`, `/queue`) wins. Otherwise
    // fall back to the user's configured default send mode.
    const kind: "steer" | "followUp" =
      payload.intent === "steer" || payload.intent === "followUp"
        ? payload.intent
        : defaultSendMode
    deliveryInvariant.track(trackedText, "enqueue")
    try {
      await rpc.app.sessions.enqueue({
        sessionId,
        text: payload.text,
        displayText: payload.displayText,
        images: payload.images,
        imageRefs: payload.imageRefs,
        kind,
      })
    } catch (err) {
      console.error("[chat] enqueue failed:", err)
    }
  }

  /**
   * Resolve the pi entry id for the Nth user message on the current
   * session path. Pulled on demand rather than cached so the bubble
   * always anchors to the right entry even if the tree changed
   * since the user last opened the chat. Returns `null` when the
   * index is out of range.
   */
  const resolveUserEntryId = async (
    userMessageIndex: number,
  ): Promise<string | null> => {
    if (!sessionId) return null
    const { entries, leafId } = await rpc.app.sessions.getEntryTree({
      sessionId,
    })
    // Walk leaf → root, collect user messages, then reverse so
    // index 0 is the oldest user message on the current path.
    const byId = new Map(entries.map(e => [e.id, e] as const))
    const userPath: string[] = []
    let cur: string | null = leafId
    while (cur) {
      const e = byId.get(cur)
      if (!e) break
      if (e.kind === "message" && e.messageRole === "user") {
        userPath.push(e.id)
      }
      cur = e.parentId
    }
    userPath.reverse()
    return userPath[userMessageIndex] ?? null
  }

  /**
   * Edit-to-branch flow: rewind the session to before this user
   * message via `navigateTree` (with the chosen summary mode), then
   * ship the edited text as a fresh prompt on the same session.
   * Same tab, same chat, no session juggling — the materialized
   * message stream just rebuilds to drop the abandoned suffix and
   * stamp the new user message at the leaf.
   */
  const handleEditSubmit = async (args: {
    userMessageIndex: number
    text: string
    displayText: string
    choice: import("./lib/branch-summary-choice").BranchSummaryChoice
  }) => {
    if (!sessionId) return
    try {
      const entryId = await resolveUserEntryId(args.userMessageIndex)
      if (!entryId) {
        console.error(
          "[chat] handleEditSubmit: no user entry at index",
          args.userMessageIndex,
        )
        return
      }
      await rpc.app.sessions.navigateTree({
        sessionId,
        entryId,
        summarize:
          args.choice.kind === "default" || args.choice.kind === "custom",
        customInstructions:
          args.choice.kind === "custom"
            ? args.choice.customInstructions
            : undefined,
      })
      await rpc.app.sessions.prompt({
        sessionId,
        text: args.text,
        displayText: args.displayText,
      })
    } catch (err) {
      console.error("[chat] handleEditSubmit failed:", err)
    }
  }

  /**
   * Revert flow: rewind the session via `navigateTree` (with the
   * chosen summary mode), then emit `appendComposerDraft` so the
   * live composer picks up the picked message's text. Whatever the
   * user was already drafting stays put — the appended text lands
   * after a separating newline.
   *
   * navigateTree returns the picked entry's user text in
   * `editorText` when the target is a user message, which is
   * exactly what we want to drop into the composer.
   */
  const handleRevertSubmit = async (args: {
    userMessageIndex: number
    choice: import("./lib/branch-summary-choice").BranchSummaryChoice
  }) => {
    if (!sessionId || !chat) return
    try {
      const entryId = await resolveUserEntryId(args.userMessageIndex)
      if (!entryId) {
        console.error(
          "[chat] handleRevertSubmit: no user entry at index",
          args.userMessageIndex,
        )
        return
      }
      const result = await rpc.app.sessions.navigateTree({
        sessionId,
        entryId,
        summarize:
          args.choice.kind === "default" || args.choice.kind === "custom",
        customInstructions:
          args.choice.kind === "custom"
            ? args.choice.customInstructions
            : undefined,
      })
      const text = result.editorText
      if (text == null || text.length === 0) return
      await rpc.app.sessions.appendComposerDraft({
        composerId: chat.id,
        text,
      })
    } catch (err) {
      console.error("[chat] handleRevertSubmit failed:", err)
    }
  }

  const handleInterrupt = async () => {
    if (!isReady || !sessionId) return
    try {
      await rpc.app.sessions.abort({ sessionId })
    } catch (err) {
      console.error("[chat] abort failed:", err)
    }
  }

  const handleChangeModel = async (value: string) => {
    if (!isReady || !sessionId) return
    const slash = value.indexOf("/")
    if (slash < 0) return
    const provider = value.slice(0, slash)
    const id = value.slice(slash + 1)
    try {
      await rpc.app.sessions.setModel({ sessionId, provider, id })
    } catch (err) {
      console.error("[chat] setModel failed:", err)
    }
  }

  const handleChangeThinking = async (value: string) => {
    if (!isReady || !sessionId) return
    try {
      await rpc.app.sessions.setThinkingLevel({
        sessionId,
        level: value as Session["thinkingLevel"],
      })
    } catch (err) {
      console.error("[chat] setThinkingLevel failed:", err)
    }
  }

  return (
    <div
      className={cn(
        // No `bg-clip-padding`: when this pane draws its own `border-t`
        // (minimal mode, no chat-tabs above), letting `bg-background`
        // paint under the border keeps the seam composited against
        // the same surface as every other border in the app.
        "relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
        borderClass,
        cornerClass,
      )}
    >
      <ChatBackgroundLayer url={backgroundUrl} opacity={background?.opacity} />
      <InvariantOverlay chatId={chat.id} />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <FileIndexContext.Provider value={files}>
        <ErrorBoundary label="Chat">
          <ChatDisplay
            messages={displayMessages}
            streaming={streaming}
            loadingStats={loadingStats}
            scrollToBottomRef={scrollToBottomRef}
            onEditSubmit={handleEditSubmit}
            onRevertSubmit={handleRevertSubmit}
          />
        </ErrorBoundary>
        {sessionId && <QueuedMessages sessionId={sessionId} />}
        {chat && treePanelOpen ? (
          // The selector takes the composer's slot entirely while
          // open. Putting it side-by-side made focus state
          // ambiguous ("do my keys go to the tree or the input?")
          // — swapping the surface makes it unambiguous: if you can
          // see the selector, your keys go to the selector.
          //
          // Outer guard is `chat` (not `sessionId`) because the
          // `/workspace` panel works on pending chats too — it
          // only needs the chat's scope, not a live session.
          // `tree` / `fork` still require a sessionId and bail
          // out below if it's missing.
          <ErrorBoundary label="Selector">
            {treePanel.kind === "workspace" ? (
              <WorkspaceSelector
                scopeId={chat.scopeId}
                isStreaming={streaming}
                onConfirm={async ({ branch, worktreePath, commitFirst }) => {
                  try {
                    // The RPC owns the whole move transaction:
                    // optionally commit the source's pending
                    // changes, then `git worktree add`, abort any
                    // in-flight turn, dispose the live
                    // AgentSession, and flip chat.scopeId +
                    // session.scopeId. By the time it resolves,
                    // the chat is parked in the new worktree and
                    // the next prompt will re-activate pi with
                    // the new cwd.
                    await rpc.app.sessions.moveToNewWorktree({
                      chatId: chat.id,
                      branch,
                      worktreePath,
                      windowId,
                      commitFirst,
                    })
                    setTreePanel({ kind: "closed" })
                  } catch (err) {
                    console.error(
                      "[chat] moveToNewWorktree failed:",
                      err,
                    )
                    // Re-throw so the selector keeps its panel
                    // open and surfaces the error inline.
                    throw err
                  }
                }}
                onCancel={() => setTreePanel({ kind: "closed" })}
              />
            ) : treePanel.kind === "handoff" ? (
              // `/worktree-handoff` panel — cross-worktree commit
              // transfer. Source is *this* chat's scope; the panel
              // picks the target from the same repo's worktrees.
              // The panel handles its own multi-stage flow
              // (pickTarget → preview/conflict → applying); the
              // chat-pane just provides callbacks to close on
              // success / agent-handoff.
              <WorktreeHandoffSelector
                chatId={chat.id}
                sourceScopeId={chat.scopeId}
                onCancel={() => setTreePanel({ kind: "closed" })}
                onApplied={() => setTreePanel({ kind: "closed" })}
                onAgentResolutionRequested={() =>
                  setTreePanel({ kind: "closed" })
                }
              />
            ) : !sessionId ? null : treePanel.kind === "fork" ? (
              <ForkSelector
                sessionId={sessionId}
                refreshKey={session?.lastActivityAt ?? 0}
                activeLeafId={session?.currentLeafEntryId ?? null}
                onConfirm={async ({ entryId }) => {
                  try {
                    // The fork RPC handles the chat + chatState
                    // draft + new tab + window state in ONE main-
                    // side transaction. By the time it resolves
                    // the new tab is already active and the
                    // composer's draft is pre-populated.
                    await rpc.app.sessions.forkAtUserMessage({
                      sessionId,
                      entryId,
                      windowId,
                    })
                  } catch (err) {
                    console.error(
                      "[chat] forkAtUserMessage failed:",
                      err,
                    )
                  } finally {
                    setTreePanel({ kind: "closed" })
                  }
                }}
                onCancel={() => setTreePanel({ kind: "closed" })}
              />
            ) : (
              <TreeSelector
                sessionId={sessionId}
                refreshKey={session?.lastActivityAt ?? 0}
                activeLeafId={session?.currentLeafEntryId ?? null}
                onConfirm={async ({ entryId, choice }) => {
                  try {
                    await rpc.app.sessions.navigateTree({
                      sessionId,
                      entryId,
                      summarize: choice.kind !== "none",
                      customInstructions:
                        choice.kind === "custom"
                          ? choice.customInstructions
                          : undefined,
                    })
                  } catch (err) {
                    console.error("[chat] navigateTree failed:", err)
                  } finally {
                    setTreePanel({ kind: "closed" })
                  }
                }}
                onCancel={() => setTreePanel({ kind: "closed" })}
              />
            )}
          </ErrorBoundary>
        ) : (
          <ErrorBoundary label="Composer">
            <Composer
              composerKey={chat.id}
              // Stamps this composer as `chat.id` so the bubble-side
              // revert flow can target it with an
              // `appendComposerDraft` event without clobbering live
              // drafts in other chats.
              composerId={chat.id}
              initialText={initialText}
              onDraftChange={onDraftChange}
              onSubmit={handleSubmit}
              files={files}
              slashCommands={slashCommands}
              onSlashAction={handleSlashAction}
              locked={locked}
              onUnlock={handleUnlock}
              streaming={streaming}
              onInterrupt={handleInterrupt}
              agentConfigs={agentConfigs}
              currentAgentConfigId={PI_AGENT_ID}
              currentModel={currentModelValue}
              onChangeModel={handleChangeModel}
              currentThinkingLevel={session?.thinkingLevel}
              onChangeThinkingLevel={handleChangeThinking}
            />
          </ErrorBoundary>
        )}
        <AppStatusBar sessionId={sessionId} />
        </FileIndexContext.Provider>
      </div>
    </div>
  )
}

function ChatBackgroundLayer({
  url,
  opacity,
}: {
  url: string | null
  opacity: number | undefined
}) {
  if (!url) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        backgroundImage: `url(${url})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        opacity: opacity ?? 0.15,
      }}
    />
  )
}

function ChatEmptyState({
  message,
  cornerClass,
  borderClass,
}: {
  message: string
  cornerClass: string
  borderClass: string
}) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center bg-background bg-clip-padding text-[12px] text-muted-foreground",
        borderClass,
        cornerClass,
      )}
    >
      {message}
    </div>
  )
}

function cornerRoundingClass(_args: {
  leftAdjacent: boolean
  rightAdjacent: boolean
  topAdjacent: boolean
}): string {
  // The outer app shell owns every window curve via
  // `overflow-hidden rounded-[10px]`, so the chat pane never rounds
  // its own corners. The seam against the title bar (when there's no
  // tab strip above us) is the pane's own `border-t` — a clean 1px
  // intersection line, matching the rest of the shell.
  void _args
  return ""
}

import { app, webContents, type WebContents } from "electron"
import { Service } from "@zenbujs/core/runtime"
import { RpcService } from "@zenbujs/core/services"

/**
 * Pragmatic window-level shortcut bus. We hook
 * `app.on("web-contents-created", ...)` so every WebContents the app
 * spawns — the main entrypoint webContents *and* every WebContentsView
 * iframe registered via the view registry — gets an identical
 * `before-input-event` listener. That fires before the renderer keydown,
 * so the shortcut still works while focus is in an iframe (e.g. the
 * composer / a plugin view).
 *
 * Each registered shortcut emits an event on the bus; the renderer
 * subscribes via `useEvents()`. Real plugins can later add their own
 * (id, matcher, eventName) tuples — for now we hard-code the
 * command-palette open shortcut.
 */
export class ShortcutsService extends Service.create({
  key: "shortcuts",
  deps: { rpc: RpcService },
}) {
  evaluate() {
    this.setup("watch-web-contents", () => {
      // (webContents → handler) so we can `.off()` exactly the
      // handler we registered on hot reload. A `WeakSet` of seen
      // contents (the previous shape) tracked attachment but had no
      // way to remove the listener — every service re-evaluate would
      // stack another handler on every existing webContents, so a
      // single keypress fired the shortcut N times after N edits.
      // That manifested as terminal/sidebar toggles "flickering"
      // because `setX(o => !o)` ran twice (or 0/4/6 times) per
      // press, landing back on the original state.
      type BeforeInputHandler = (
        event: Electron.Event,
        input: Electron.Input,
      ) => void
      const attached = new Map<WebContents, BeforeInputHandler>()
      const attach = (contents: WebContents) => {
        if (attached.has(contents)) return
        const handler = (event: Electron.Event, input: Electron.Input) => {
          if (input.type !== "keyDown") return
          if (matchesToggleAgentsPalette(input)) {
            event.preventDefault()
            this.ctx.rpc.emit.app.toggleAgentsPalette({
              source: contents.getURL(),
            })
          }
          if (matchesTogglePalette(input)) {
            event.preventDefault()
            this.ctx.rpc.emit.app.toggleCommandPalette({
              source: contents.getURL(),
            })
          }
          if (matchesToggleTerminal(input)) {
            // Every other shortcut in this file calls
            // `event.preventDefault()`. Without it, the keydown
            // propagates into whichever WebContents currently has
            // focus — and once the bottom panel opens and we move
            // focus into the terminal iframe, xterm writes the
            // literal "j" into the pty.
            event.preventDefault()
            this.ctx.rpc.emit.app.toggleTerminal({
              source: contents.getURL(),
            })
          }
          if (matchesToggleSidebar(input)) {
            event.preventDefault()
            this.ctx.rpc.emit.app.toggleSidebar({
              source: contents.getURL(),
            })
          }
          if (matchesToggleWorkspaceRail(input)) {
            event.preventDefault()
            this.ctx.rpc.emit.app.toggleWorkspaceRail({
              source: contents.getURL(),
            })
          }
          if (matchesNewChatInCurrentPane(input)) {
            event.preventDefault()
            this.ctx.rpc.emit.app.newChatInCurrentPane({
              source: contents.getURL(),
            })
          }
          if (matchesNewChatN(input)) {
            // ⌘N mirrors the sidebar's "New Chat" button: REPLACES
            // the active tab's chat (vs. ⌘T which appends a new
            // tab). Distinct event so the renderer can wire them to
            // different code paths.
            event.preventDefault()
            this.ctx.rpc.emit.app.newChatReplaceActive({
              source: contents.getURL(),
            })
          }
          if (matchesSplitSameSession(input)) {
            event.preventDefault()
            this.ctx.rpc.emit.app.splitPaneSameSession({
              source: contents.getURL(),
            })
          }
          if (matchesSplitNewChat(input)) {
            event.preventDefault()
            this.ctx.rpc.emit.app.splitPaneNewChat({
              source: contents.getURL(),
            })
          }
          if (matchesTabHistoryBack(input)) {
            event.preventDefault()
            this.ctx.rpc.emit.app.tabHistoryBack({
              source: contents.getURL(),
            })
          }
          if (matchesTabHistoryForward(input)) {
            event.preventDefault()
            this.ctx.rpc.emit.app.tabHistoryForward({
              source: contents.getURL(),
            })
          }
          if (matchesCloseActivePane(input)) {
            // Cmd+W is normally bound to the macOS File menu's
            // "Close Window" via the `fileMenu` role.
            // `event.preventDefault()` also blocks menu accelerators
            // per Electron's contract, so the renderer wins.
            event.preventDefault()
            this.ctx.rpc.emit.app.closeActivePane({
              source: contents.getURL(),
            })
          }
        }
        contents.on("before-input-event", handler)
        attached.set(contents, handler)
        contents.once("destroyed", () => {
          attached.delete(contents)
        })
      }

      for (const contents of webContents.getAllWebContents()) {
        attach(contents)
      }

      const onCreated = (
        _event: Electron.Event,
        contents: WebContents,
      ) => attach(contents)
      app.on("web-contents-created", onCreated)

      return () => {
        app.off("web-contents-created", onCreated)
        // Detach every handler we attached this evaluate. Without
        // this, hot-reloading this service piles up listeners on
        // every webContents (one per save) and shortcuts fire N
        // times per press.
        for (const [contents, h] of attached) {
          if (contents.isDestroyed()) continue
          try {
            contents.off("before-input-event", h)
          } catch {}
        }
        attached.clear()
      }
    })
  }
}

type ShortcutInput = {
  key: string
  code?: string
  meta?: boolean
  control?: boolean
  alt?: boolean
  shift?: boolean
}

const IS_MAC = process.platform === "darwin"

/** ⌘⇧P (mac) / ⌃⇧P (win/linux) opens the general command palette.
 * ⌃P is still reserved for the palette's own vim-style row nav. */
function matchesTogglePalette(input: ShortcutInput): boolean {
  const key = input.key?.toLowerCase()
  if (key !== "p") return false
  if (input.alt) return false
  if (!input.shift) return false
  if (IS_MAC) return !!input.meta && !input.control
  return !!input.control && !input.meta
}

/** ⌘P (mac) / ⌃P (win/linux) opens the agents palette — a focused
 * picker that just searches chats. */
function matchesToggleAgentsPalette(input: ShortcutInput): boolean {
  const key = input.key?.toLowerCase()
  if (key !== "p") return false
  if (input.alt || input.shift) return false
  if (IS_MAC) return !!input.meta && !input.control
  return !!input.control && !input.meta
}

function matchesToggleTerminal(input: ShortcutInput): boolean {
  const key = input.key?.toLowerCase()
  if (key !== "j") return false
  if (input.alt || input.shift) return false
  if (IS_MAC) return !!input.meta && !input.control
  return !!input.control && !input.meta
}

/** Cmd+/ or Cmd+\ (and the Ctrl- equivalents on win/linux). We accept
 * both `Slash` and `Backslash` codes / `/` and `\` keys so the split
 * shortcut works on layouts where the slash key surfaces as backslash,
 * and so the iTerm-style `\` muscle memory for splits also works. */
function matchesSlash(input: ShortcutInput, requireShift: boolean): boolean {
  if (input.alt) return false
  if (requireShift ? !input.shift : input.shift) return false
  const isSplitCode =
    input.code === "Slash" || input.code === "Backslash"
  const isSplitKey = requireShift
    ? input.key === "/" ||
      input.key === "?" ||
      input.key === "\\" ||
      input.key === "|"
    : input.key === "/" || input.key === "\\"
  if (!isSplitCode && !isSplitKey) return false
  if (IS_MAC) return !!input.meta && !input.control
  return !!input.control && !input.meta
}

function matchesSplitSameSession(input: ShortcutInput): boolean {
  return matchesSlash(input, /* requireShift */ false)
}

function matchesSplitNewChat(input: ShortcutInput): boolean {
  return matchesSlash(input, /* requireShift */ true)
}

function matchesCloseActivePane(input: ShortcutInput): boolean {
  const key = input.key?.toLowerCase()
  if (key !== "w") return false
  if (input.alt || input.shift) return false
  if (IS_MAC) return !!input.meta && !input.control
  return !!input.control && !input.meta
}

function matchesToggleSidebar(input: ShortcutInput): boolean {
  const key = input.key?.toLowerCase()
  if (key !== "b") return false
  if (input.alt || input.shift) return false
  if (IS_MAC) return !!input.meta && !input.control
  return !!input.control && !input.meta
}

/** ⌘⇧B (mac) / ⌃⇧B (win/linux) toggles the workspace rail — the
 * narrow column on the far left that holds the workspace icons. */
function matchesToggleWorkspaceRail(input: ShortcutInput): boolean {
  const key = input.key?.toLowerCase()
  if (key !== "b") return false
  if (input.alt) return false
  if (!input.shift) return false
  if (IS_MAC) return !!input.meta && !input.control
  return !!input.control && !input.meta
}

function matchesNewChatInCurrentPane(input: ShortcutInput): boolean {
  const key = input.key?.toLowerCase()
  if (key !== "t") return false
  if (input.alt || input.shift) return false
  if (IS_MAC) return !!input.meta && !input.control
  return !!input.control && !input.meta
}

/** ⌘N (mac) / ⌃N (win/linux) — alias for ⌘T. Mirrors the sidebar's
 * "New Chat" button so both surface and shortcut produce the same
 * behaviour (new tab in the active pane, composer auto-focused). */
function matchesNewChatN(input: ShortcutInput): boolean {
  const key = input.key?.toLowerCase()
  if (key !== "n") return false
  if (input.alt || input.shift) return false
  if (IS_MAC) return !!input.meta && !input.control
  return !!input.control && !input.meta
}

/** ⌘[ / ⌘] (mac) and ⌃[ / ⌃] (win/linux) walk the active tab's
 * per-tab navigation history back/forward. Matches the browser
 * convention used by Chrome/Safari/Firefox and the bracket-key
 * convention used by VS Code's "Go Back" / "Go Forward" (⌃-).
 *
 * We match on both `key` and `code`:
 *  - `key` (`[`, `]`) is what the user logically pressed once the
 *    OS-level layout has mapped the keystroke.
 *  - `code` (`BracketLeft`, `BracketRight`) is the physical key,
 *    used as a fallback for layouts where the bracket characters
 *    require a modifier and the `key` value is something else.
 */
function matchesBracket(input: ShortcutInput, side: "left" | "right"): boolean {
  if (input.alt || input.shift) return false
  const wantKey = side === "left" ? "[" : "]"
  const wantCode = side === "left" ? "BracketLeft" : "BracketRight"
  if (input.key !== wantKey && input.code !== wantCode) return false
  if (IS_MAC) return !!input.meta && !input.control
  return !!input.control && !input.meta
}

function matchesTabHistoryBack(input: ShortcutInput): boolean {
  return matchesBracket(input, "left")
}

function matchesTabHistoryForward(input: ShortcutInput): boolean {
  return matchesBracket(input, "right")
}


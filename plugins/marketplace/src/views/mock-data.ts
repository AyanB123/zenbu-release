/**
 * Mock catalog for the marketplace view. Everything is fake — no
 * install / publish action is wired up yet. Swap this file for a
 * real index (e.g. an RPC backed by a registry server) once that
 * exists.
 *
 * Shaped to look like an IDE plugin registry (VS Code / Raycast /
 * JetBrains) rather than a consumer app store: each entry carries a
 * version, install count, last-updated timestamp, tags, and a long
 * description so the detail page has something to render.
 *
 * Each plugin id also has a matching
 * `./mock-screenshots/<id>.png` produced by
 * `scripts/gen-plugin-screenshots.sh`. The marketplace view uses
 * those as the card thumbnail; the URL map below resolves them
 * through Vite so the bundler picks them up as assets.
 */
import linearTrackerScreenshot from "./mock-screenshots/linear-tracker.png"
import markdownPreviewScreenshot from "./mock-screenshots/markdown-preview.png"
import branchWidgetScreenshot from "./mock-screenshots/branch-widget.png"
import colorPickerScreenshot from "./mock-screenshots/color-picker.png"
import aiSearchScreenshot from "./mock-screenshots/ai-search.png"
import snippetsScreenshot from "./mock-screenshots/snippets.png"
import regexLabScreenshot from "./mock-screenshots/regex-lab.png"
import moodboardScreenshot from "./mock-screenshots/moodboard.png"
import focusTimerScreenshot from "./mock-screenshots/focus-timer.png"
import translateScreenshot from "./mock-screenshots/translate.png"
import teamPresenceScreenshot from "./mock-screenshots/team-presence.png"
import teamDeployScreenshot from "./mock-screenshots/team-deploy.png"
import teamHandbookScreenshot from "./mock-screenshots/team-handbook.png"
import mineTasklogScreenshot from "./mock-screenshots/mine-tasklog.png"
import mineShortcutsScreenshot from "./mock-screenshots/mine-shortcuts.png"

/**
 * Map from plugin id → imported screenshot URL. Vite's import-as-URL
 * handling means each entry resolves to a hashed asset path the
 * dev server / production build can serve.
 */
export const SCREENSHOTS: Record<string, string> = {
  "linear-tracker": linearTrackerScreenshot,
  "markdown-preview": markdownPreviewScreenshot,
  "branch-widget": branchWidgetScreenshot,
  "color-picker": colorPickerScreenshot,
  "ai-search": aiSearchScreenshot,
  snippets: snippetsScreenshot,
  "regex-lab": regexLabScreenshot,
  moodboard: moodboardScreenshot,
  "focus-timer": focusTimerScreenshot,
  translate: translateScreenshot,
  "team-presence": teamPresenceScreenshot,
  "team-deploy": teamDeployScreenshot,
  "team-handbook": teamHandbookScreenshot,
  "mine-tasklog": mineTasklogScreenshot,
  "mine-shortcuts": mineShortcutsScreenshot,
}
export type CategoryId =
  | "productivity"
  | "developer"
  | "design"
  | "ai"
  | "writing"
  | "utilities"
  | "fun"

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "productivity", label: "Productivity" },
  { id: "developer", label: "Developer" },
  { id: "design", label: "Design" },
  { id: "ai", label: "AI" },
  { id: "writing", label: "Writing" },
  { id: "utilities", label: "Utilities" },
  { id: "fun", label: "Fun" },
]

export type MarketplacePlugin = {
  id: string
  name: string
  /** Short slug shown in the detail header (e.g. "linear-tracker"). */
  slug: string
  author: string
  version: string
  /** One-line summary used in the row. */
  tagline: string
  /** Long-form README-style body for the detail page. Plain text;
   * paragraphs separated by blank lines. */
  readme: string
  category: CategoryId
  scope: "public" | "team"
  /** Lifetime installs reported by the registry. */
  installs: number
  /** Last-updated timestamp (epoch ms). */
  updatedAt: number
  tags: string[]
  installed?: boolean
  /** Single character / emoji painted into the icon tile. */
  glyph: string
  /** Solid background color for the icon tile. Plain hex, no
   * gradients — keeps the catalog reading as a developer registry
   * rather than a consumer storefront. */
  color: string
}

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()

export const PLUGINS: MarketplacePlugin[] = [
  {
    id: "linear-tracker",
    name: "Linear Tracker",
    slug: "linear-tracker",
    author: "Petr Nikolaev",
    version: "1.4.2",
    tagline:
      "Linear-style issue tracker docked in the right sidebar, synced per workspace.",
    readme:
      "Adds a Linear-flavored issue tracker as a right-sidebar panel. Pulls issues for the active workspace, lets you triage inline (status, assignee, priority), and opens detail in a pane view.\n\nWorks per-workspace: switching workspaces switches projects automatically. Issues are cached in the local DB so it stays usable offline.",
    category: "productivity",
    scope: "public",
    installs: 12400,
    updatedAt: now - 3 * DAY,
    tags: ["sidebar", "issues", "linear"],
    glyph: "L",
    color: "#5E6AD2",
  },
  {
    id: "markdown-preview",
    name: "Markdown Preview",
    slug: "markdown-preview",
    author: "Alex Subbotin",
    version: "0.9.1",
    tagline:
      "Live Markdown rendering next to the editor with GFM, KaTeX, and Mermaid.",
    readme:
      "Registers a pane view that mirrors the active editor as rendered Markdown. Supports GitHub-flavored Markdown, KaTeX math, and Mermaid diagrams out of the box.\n\nScroll position is synced both ways, so jumping in the editor jumps the preview and vice versa.",
    category: "writing",
    scope: "public",
    installs: 8200,
    updatedAt: now - 11 * DAY,
    tags: ["pane", "markdown", "preview"],
    glyph: "M",
    color: "#2563EB",
  },
  {
    id: "branch-widget",
    name: "Branch Widget",
    slug: "branch-widget",
    author: "Samuel Kraft",
    version: "2.0.0",
    tagline:
      "Status-bar widget showing the current git branch, ahead/behind, and PR status.",
    readme:
      "A tiny status-bar widget that surfaces the current branch name, ahead/behind counts, and the most recent PR status for the active scope.\n\nClick to open a popover with quick actions: switch branch, open PR, copy branch name. Uses advice to inject itself next to the existing status bar.",
    category: "developer",
    scope: "public",
    installs: 15600,
    updatedAt: now - 1 * DAY,
    tags: ["status-bar", "git", "advice"],
    installed: true,
    glyph: "⎇",
    color: "#10B981",
  },
  {
    id: "color-picker",
    name: "Color Picker",
    slug: "color-picker",
    author: "Maya Patel",
    version: "1.1.0",
    tagline:
      "Pick colors anywhere on screen and copy them as hex, hsl, or oklch.",
    readme:
      "Adds a command-palette entry and a status-bar trigger that opens a screen color picker. Copies the picked color to the clipboard in your preferred format and keeps a recent-pick history per workspace.",
    category: "design",
    scope: "public",
    installs: 5400,
    updatedAt: now - 22 * DAY,
    tags: ["command", "color", "clipboard"],
    glyph: "◐",
    color: "#F472B6",
  },
  {
    id: "ai-search",
    name: "AI Search",
    slug: "ai-search",
    author: "Jonas Lindberg",
    version: "0.4.3",
    tagline:
      "Ask questions across every file in your workspace with citations.",
    readme:
      "Indexes the active scope and exposes a chat-style ask UI in the right sidebar. Answers cite the files they were drawn from and link back to specific line ranges.\n\nIndex is incremental: edits in the editor update the index in the background, so answers stay current.",
    category: "ai",
    scope: "public",
    installs: 22100,
    updatedAt: now - 5 * DAY,
    tags: ["ai", "search", "rag"],
    glyph: "✺",
    color: "#6366F1",
  },
  {
    id: "snippets",
    name: "Snippets",
    slug: "snippets",
    author: "Hana Mori",
    version: "3.2.1",
    tagline:
      "Reusable code & prose snippets with variables, tags, and quick insert.",
    readme:
      "A snippet manager that lives in the command palette. Supports variables ({{cursor}}, {{date}}, {{clipboard}}), tag-based filtering, and per-workspace overrides on a shared global library.",
    category: "productivity",
    scope: "public",
    installs: 9800,
    updatedAt: now - 8 * DAY,
    tags: ["palette", "snippets", "templates"],
    glyph: "⌘",
    color: "#F59E0B",
  },
  {
    id: "regex-lab",
    name: "Regex Lab",
    slug: "regex-lab",
    author: "Daniel Park",
    version: "0.7.0",
    tagline:
      "Interactive regex playground with named captures and step-through matching.",
    readme:
      "Opens a pane view for testing regular expressions against sample input. Highlights matches, surfaces named captures, and steps through the matching state machine so you can see why a pattern does (or doesn't) match.",
    category: "developer",
    scope: "public",
    installs: 3300,
    updatedAt: now - 41 * DAY,
    tags: ["pane", "regex", "debug"],
    glyph: ".*",
    color: "#14B8A6",
  },
  {
    id: "moodboard",
    name: "Moodboard",
    slug: "moodboard",
    author: "Studio Nine",
    version: "0.3.0",
    tagline:
      "Pin images, swatches, and screenshots into a freeform canvas per workspace.",
    readme:
      "Registers a freeform canvas pane view. Drag images and files in from anywhere; pin swatches and short notes; canvases are scoped per workspace so each project gets its own.",
    category: "design",
    scope: "public",
    installs: 2100,
    updatedAt: now - 17 * DAY,
    tags: ["pane", "canvas", "images"],
    glyph: "▦",
    color: "#EC4899",
  },
  {
    id: "focus-timer",
    name: "Focus Timer",
    slug: "focus-timer",
    author: "Robin Vega",
    version: "1.2.5",
    tagline:
      "Pomodoro timer with session history, break reminders, and Do Not Disturb.",
    readme:
      "A pomodoro timer that lives in the status bar. Configurable session lengths, break reminders, and per-day session history. Pauses notifications during focus blocks.",
    category: "productivity",
    scope: "public",
    installs: 14200,
    updatedAt: now - 2 * DAY,
    tags: ["status-bar", "timer", "focus"],
    glyph: "◷",
    color: "#EF4444",
  },
  {
    id: "translate",
    name: "Inline Translate",
    slug: "inline-translate",
    author: "Yuki Tanaka",
    version: "0.5.2",
    tagline:
      "Translate selections in chat or files between 40+ languages without leaving the IDE.",
    readme:
      "Right-click any selection to translate it in place or into a side panel. Supports 40+ languages via the user's configured provider; defaults to a local model if available.",
    category: "writing",
    scope: "public",
    installs: 4100,
    updatedAt: now - 30 * DAY,
    tags: ["context-menu", "translation"],
    glyph: "文",
    color: "#22D3EE",
  },

  // --- Team-only entries ---------------------------------------------------
  {
    id: "team-presence",
    name: "Presence",
    slug: "presence",
    author: "Internal Tools",
    version: "0.2.0",
    tagline:
      "See teammates currently in the same workspace and their active files.",
    readme:
      "Adds a presence indicator to the workspace title bar and a teammates panel in the right sidebar. Shows who's currently in the same workspace, which file they have focused, and recent activity.",
    category: "productivity",
    scope: "team",
    installs: 48,
    updatedAt: now - 6 * DAY,
    tags: ["title-bar", "sidebar", "collaboration"],
    glyph: "●",
    color: "#10B981",
  },
  {
    id: "team-deploy",
    name: "Deploy Console",
    slug: "deploy-console",
    author: "Platform",
    version: "1.0.4",
    tagline:
      "Trigger and tail deploys to staging / prod without leaving the IDE.",
    readme:
      "Wires the team's deploy pipelines into a pane view. Browse environments, kick off deploys with the same auth as the rest of the internal tools, and tail logs in real time.",
    category: "developer",
    scope: "team",
    installs: 72,
    updatedAt: now - 4 * DAY,
    tags: ["pane", "deploy", "logs"],
    glyph: "⌁",
    color: "#0EA5E9",
  },
  {
    id: "team-handbook",
    name: "Handbook",
    slug: "handbook",
    author: "People Ops",
    version: "0.3.1",
    tagline:
      "Inline answers from the company handbook with source citations.",
    readme:
      "Command-palette entry that answers questions from the internal handbook with citations back to the source pages. Indexed nightly from the team wiki.",
    category: "writing",
    scope: "team",
    installs: 31,
    updatedAt: now - 14 * DAY,
    tags: ["palette", "ai", "handbook"],
    glyph: "§",
    color: "#F59E0B",
  },
]

/**
 * Mock entries for the "Published" tab — plugins the *current user*
 * has authored. Real implementation will read these off the
 * registry, scoped by the signed-in account.
 */
export type PublishedPlugin = {
  id: string
  name: string
  slug: string
  version: string
  status: "draft" | "published"
  /** epoch ms, null while still a draft */
  publishedAt: number | null
  /** Listing views over the last 30 days. */
  views: number
  installs: number
  glyph: string
  color: string
}

export const PUBLISHED_PLUGINS: PublishedPlugin[] = [
  {
    id: "mine-tasklog",
    name: "Task Log",
    slug: "task-log",
    version: "0.2.0",
    status: "published",
    publishedAt: now - 9 * DAY,
    views: 142,
    installs: 17,
    glyph: "☑",
    color: "#0EA5E9",
  },
  {
    id: "mine-shortcuts",
    name: "Shortcut Cheatsheet",
    slug: "shortcut-cheatsheet",
    version: "0.1.0",
    status: "draft",
    publishedAt: null,
    views: 0,
    installs: 0,
    glyph: "⌨",
    color: "#A855F7",
  },
]

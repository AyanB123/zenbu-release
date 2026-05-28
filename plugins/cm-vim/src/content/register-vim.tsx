import { StrictMode, useMemo } from "react"
import { createRoot } from "react-dom/client"
import {
  useDb,
  useRegisterFunction,
  ZenbuProvider,
} from "@zenbujs/core/react"
import type { Extension } from "@codemirror/state"
import vimExtension from "../extension"
import { VimModeStatusItem } from "../components/vim-mode-status-item"

/**
 * Content script entry point. Mounts a hidden React root that does
 * one job: read `db.app.settings.vimMode` and (un)register the vim
 * CodeMirror extension under `meta.kind = "cm.composer-extension"`
 * accordingly.
 *
 * The host composer reads the function registry directly and will
 * reconfigure its compartment whenever this registration appears or
 * disappears — so toggling the setting flips vim on/off live, with
 * no editor remount.
 *
 * Single global registration; uses a fixed function name. We use a
 * content script instead of a per-composer advice so multiple
 * composer instances don't fight over the same registry slot.
 */

const FUNCTION_NAME = "cm-vim.vim"
const FLAG_ATTR = "data-cm-vim-mounted"

function VimRegistrar() {
  const enabled = useDb(root => root.app.settings.vimMode)
  // useRegisterFunction is reactive; when `enabled` flips, we
  // unregister + re-register with a different value. The empty
  // array (`[]`) is a valid no-op CodeMirror extension.
  const value = useMemo<Extension>(
    () => (enabled ? vimExtension : []),
    [enabled],
  )
  // Editable-only: a read-only user-message bubble has no use for
  // vim's fat cursor / modal keymaps. The host composer filters
  // this kind out when `readOnly` is true.
  useRegisterFunction(FUNCTION_NAME, value, {
    kind: "cm.composer-extension-editable",
    label: "Vim mode",
  })
  // Status-bar item — same registry, different kind. The
  // `pi-footer` plugin's container renders every component
  // registered under `pi-footer.item` (anchored to `position`,
  // sorted by `order`).
  useRegisterFunction(
    "cm-vim.status-bar.vim-mode",
    VimModeStatusItem,
    {
      kind: "pi-footer.item",
      label: "Vim mode",
      position: "right",
      order: 10,
    },
  )
  return null
}

function mount() {
  if (document.body?.dataset.cmVimMounted === "1") return
  if (document.body) document.body.dataset.cmVimMounted = "1"

  const host = document.createElement("div")
  host.setAttribute(FLAG_ATTR, "1")
  host.style.display = "none"
  document.body.appendChild(host)

  createRoot(host).render(
    <StrictMode>
      <ZenbuProvider>
        <VimRegistrar />
      </ZenbuProvider>
    </StrictMode>,
  )
}

mount()

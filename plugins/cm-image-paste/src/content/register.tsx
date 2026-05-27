import { StrictMode, useEffect } from "react"
import { createRoot } from "react-dom/client"
import {
  useDbClient,
  useRegisterFunction,
  ZenbuProvider,
} from "@zenbujs/core/react"
import imagePasteExtension from "../extension"
import { setDbClient } from "../lib/db-client-ref"

/**
 * Content script entry point.
 *
 *   1. Mirrors `useDbClient()` into the plugin's module-level
 *      `dbClientRef` so the CodeMirror paste handler (which runs
 *      outside React) can reach it.
 *
 *   2. Registers the paste extension under
 *      `meta.kind = "cm.composer-extension"`. The host composer
 *      reads the registry directly and merges the extension into
 *      its compartment.
 */

function Registrar() {
  const dbClient = useDbClient()
  useEffect(() => {
    setDbClient(dbClient)
    return () => {
      setDbClient(null)
    }
  }, [dbClient])
  // Editable-only: a read-only user-message bubble can't accept
  // pastes, so there's no reason to install the paste handler
  // there. The host composer filters this kind out when `readOnly`
  // is true.
  useRegisterFunction(
    "cm-image-paste.paste",
    imagePasteExtension,
    { kind: "cm.composer-extension-editable", label: "Image paste" },
  )
  return null
}

function mount() {
  if (document.body?.dataset.cmImagePasteMounted === "1") return
  if (document.body) document.body.dataset.cmImagePasteMounted = "1"

  const host = document.createElement("div")
  host.setAttribute("data-cm-image-paste", "1")
  host.style.display = "none"
  document.body.appendChild(host)

  createRoot(host).render(
    <StrictMode>
      <ZenbuProvider>
        <Registrar />
      </ZenbuProvider>
    </StrictMode>,
  )
}

mount()

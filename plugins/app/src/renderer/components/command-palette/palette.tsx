import { useCallback, useEffect, useMemo, useState } from "react"
import { useEvents } from "@zenbujs/core/react"
import { ActiveView } from "./active-view"
import { RootMenu } from "./root-menu"
import { useCommands } from "./use-commands"
import type { Command, CommandView } from "./types"

type State =
  | { kind: "closed" }
  | { kind: "root" }
  | { kind: "active"; command: Command; view: CommandView }

export function CommandPalette() {
  const events = useEvents()
  const commands = useCommands()
  const [state, setState] = useState<State>({ kind: "closed" })

  useEffect(() => {
    const off = events.app.toggleCommandPalette.subscribe(() => {
      setState(prev => (prev.kind === "closed" ? { kind: "root" } : { kind: "closed" }))
    })
    return off
  }, [events])

  const close = useCallback(() => setState({ kind: "closed" }), [])
  const back = useCallback(() => setState({ kind: "root" }), [])

  const ctx = useMemo(() => ({ close, back }), [close, back])

  const onActivate = useCallback(
    async (command: Command) => {
      try {
        const result = await command.onSelect()
        if (result && typeof result === "object" && "render" in result) {
          setState({ kind: "active", command, view: result })
        } else {
          setState({ kind: "closed" })
        }
      } catch (err) {
        console.error("[command-palette] command failed:", err)
        setState({ kind: "closed" })
      }
    },
    [],
  )

  if (state.kind === "closed") return null

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center pt-[12vh]"
      onClick={close}
    >
      {state.kind === "root" && (
        <RootMenu
          commands={commands}
          onActivate={onActivate}
          onClose={close}
        />
      )}
      {state.kind === "active" && (
        <ActiveView view={state.view} ctx={ctx} />
      )}
    </div>
  )
}

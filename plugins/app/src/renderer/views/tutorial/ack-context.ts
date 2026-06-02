import { createContext } from "react"

/** Non-null only for the live `awaitAck` widget the pump is
 * paused on; it renders an "Okay, done!" button that advances. */
export const LiveWidgetAckContext = createContext<(() => void) | null>(null)

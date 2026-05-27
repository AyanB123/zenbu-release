import { useCallback, useRef } from "react"

/** Returns a callback with stable identity that always invokes the
 * latest function passed in. Use this when you want to pass a
 * callback to a `React.memo` child without busting its memo on
 * every parent render. */
export function useStableCallback<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: TArgs) => ref.current(...args), [])
}

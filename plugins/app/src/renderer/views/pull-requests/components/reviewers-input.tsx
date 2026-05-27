import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { useRpc } from "@zenbujs/core/react"
import { Spinner } from "@zenbu/ui/spinner"
import { cn } from "@/lib/utils"
import type { GhUser } from "../types"

type Props = {
  directory: string
  /** Current value, comma-separated logins. The parent keeps the
   *  string form so the existing `gh pr create --reviewer` call can
   *  use it verbatim; we split / re-join internally. */
  value: string
  onChange: (next: string) => void
  autoFocus?: boolean
}

/**
 * GitHub-style reviewers picker. Selected reviewers render as chips
 * inside an input shell; typing into the trailing input filters a
 * dropdown of assignable users (fetched once via the cached
 * `listAssignableUsers` RPC), Enter / click commits the highlight to
 * a chip, Backspace on an empty input pops the last chip.
 *
 * Keeps the parent's API as a plain comma-separated string so the
 * downstream `gh pr create --reviewer` call doesn't need to change.
 * Internally splits / rejoins as needed.
 */
export function ReviewersInput({
  directory,
  value,
  onChange,
  autoFocus,
}: Props) {
  const rpc = useRpc()
  const [users, setUsers] = useState<GhUser[] | null>(null)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)

  // Load the assignable users once. Cached on the service side, so
  // re-mounts within the same session are basically free.
  useEffect(() => {
    let cancelled = false
    void rpc.app.github.listAssignableUsers({ directory }).then(res => {
      if (cancelled) return
      if (res.ok) setUsers(res.users)
      else setUsersError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [directory, rpc])

  // Comma-separated logins → chip list. Preserves order so the user
  // can read the chips left-to-right in the order they typed them.
  const selected = useMemo<string[]>(
    () =>
      value
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean),
    [value],
  )
  const setSelected = useCallback(
    (next: string[]) => onChange(next.join(", ")),
    [onChange],
  )

  // Suggestions = assignable users minus already-selected ones,
  // ranked by the same scorer as the `@mention` typeahead so the
  // ranking feels consistent across the view. Cap at 8 rows to
  // match the menu we use elsewhere.
  const suggestions = useMemo(() => {
    if (!users) return []
    const taken = new Set(selected.map(s => s.toLowerCase()))
    const q = query.toLowerCase().trim()
    return users
      .filter(u => !taken.has(u.login.toLowerCase()))
      .map(u => ({
        user: u,
        score: scoreUser(q, u.login.toLowerCase(), (u.name ?? "").toLowerCase()),
      }))
      .filter(r => q === "" || r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }, [users, selected, query])

  // Clamp highlight whenever the suggestion list shrinks.
  useEffect(() => {
    if (highlighted >= suggestions.length) setHighlighted(0)
  }, [suggestions.length, highlighted])

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (!shellRef.current) return
      if (!shellRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [open])

  const addChip = useCallback(
    (login: string) => {
      const trimmed = login.trim().replace(/^@/, "")
      if (!trimmed) return
      if (selected.some(s => s.toLowerCase() === trimmed.toLowerCase())) return
      setSelected([...selected, trimmed])
      setQuery("")
      setHighlighted(0)
      inputRef.current?.focus()
    },
    [selected, setSelected],
  )

  const removeChip = useCallback(
    (login: string) => {
      setSelected(selected.filter(s => s.toLowerCase() !== login.toLowerCase()))
    },
    [selected, setSelected],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setOpen(true)
      setHighlighted(i => (suggestions.length === 0 ? 0 : (i + 1) % suggestions.length))
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setOpen(true)
      setHighlighted(i =>
        suggestions.length === 0
          ? 0
          : (i - 1 + suggestions.length) % suggestions.length,
      )
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      if (open && suggestions[highlighted]) {
        addChip(suggestions[highlighted].user.login)
      } else if (query.trim()) {
        // Free-text reviewer (e.g. user types a login that didn't
        // appear in the assignable list \u2014 still send it through to
        // `gh pr create` and let GitHub validate).
        addChip(query.trim())
      }
      return
    }
    if (e.key === "Tab" && open && suggestions[highlighted]) {
      e.preventDefault()
      addChip(suggestions[highlighted].user.login)
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === "," && !e.shiftKey) {
      // Type `,` to commit the current query as a chip \u2014 mirrors
      // GitHub's compose page muscle memory.
      if (query.trim()) {
        e.preventDefault()
        addChip(query.trim())
      }
      return
    }
    if (e.key === "Backspace" && query === "" && selected.length > 0) {
      e.preventDefault()
      setSelected(selected.slice(0, -1))
      return
    }
  }

  return (
    <div className="relative" ref={shellRef}>
      <div
        // Shaped like our other inputs (`h-8`, rounded border,
        // focus-within ring) so the field reads as a single control
        // even though it's a flex container internally.
        className={cn(
          "flex min-h-8 w-full flex-wrap items-center gap-1 rounded border border-input bg-transparent px-2 py-1 text-sm shadow-xs transition-[color,box-shadow]",
          "focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map(login => (
          <Chip key={login} login={login} onRemove={() => removeChip(login)} />
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected.length === 0 ? "Reviewers" : ""}
          autoFocus={autoFocus}
          className="min-w-[120px] flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </div>

      {open && (
        // Dropdown anchored to the input. Same visual treatment as
        // the in-editor TypeaheadMenu so both feel like one system.
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-sm border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="max-h-64 overflow-y-auto p-0.5">
            {users == null && !usersError ? (
              <div className="flex items-center px-2 py-2 text-muted-foreground">
                <Spinner size={12} />
              </div>
            ) : usersError ? (
              <div className="px-2 py-2 text-[12px] text-destructive">
                {usersError}
              </div>
            ) : suggestions.length === 0 ? (
              <div className="px-2 py-2 text-[12px] text-muted-foreground">
                {query.trim()
                  ? "No matching contributors"
                  : "Type to search contributors"}
              </div>
            ) : (
              suggestions.map(({ user }, i) => {
                const isActive = i === highlighted
                return (
                  <div
                    key={user.login}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setHighlighted(i)}
                    onMouseDown={e => {
                      // mousedown beats blur \u2014 keeps the input
                      // focused so the user can keep adding chips.
                      e.preventDefault()
                      addChip(user.login)
                    }}
                    className={cn(
                      "flex items-baseline gap-2 rounded-[2px] px-2 py-1.5 text-[12px]",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50",
                    )}
                  >
                    <span className="text-foreground">
                      @{user.login}
                    </span>
                    {user.name && (
                      <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                        {user.name}
                      </span>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Chip({
  login,
  onRemove,
}: {
  login: string
  onRemove: () => void
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[11.5px]">
      @{login}
      <button
        type="button"
        // mousedown so we beat the input's blur \u2014 same trick the
        // dropdown uses.
        onMouseDown={e => {
          e.preventDefault()
          onRemove()
        }}
        aria-label={`Remove ${login}`}
        className="text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </span>
  )
}

function scoreUser(query: string, login: string, name: string): number {
  if (!query) return 1
  let score = 0
  if (login.startsWith(query)) score += 100
  if (login.includes(query)) score += 50
  if (name.includes(query)) score += 10
  return score
}

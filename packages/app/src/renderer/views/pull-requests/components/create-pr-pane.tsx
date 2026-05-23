import { useCallback, useEffect, useMemo, useState } from "react"
import { useRpc } from "@zenbujs/core/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { MarkdownEditor } from "@/components/common/markdown-editor"
import type {
  TypeaheadItem,
  TypeaheadTrigger,
} from "@/components/common/markdown-typeahead"
import { cn } from "@/lib/utils"
import { CommitMessageSection } from "./commit-message-section"
import { PrCommitsList } from "./pr-commits-list"
import { PrDiffViewer } from "./pr-diff-viewer"
import { WorkingTreeDiff } from "./working-tree-diff"
import { ErrorBanner } from "./error-banner"
import { ReviewersInput } from "./reviewers-input"
import { modifierOpenMode, useOpenPrView } from "../lib/use-open-pr-view"
import type { GhCommit, GhRepoInfo } from "../types"

type Props = {
  directory: string
}

type RepoState =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "ready"; info: GhRepoInfo }

type SubmitState =
  | { kind: "idle" }
  | { kind: "creating"; step: string }
  | { kind: "success"; url: string; number: number }

/**
 * "New pull request" surface, modelled after GitHub's compare page.
 *
 * Layout is a single overflow-scrolling column with a sticky top
 * bar and a sticky bottom action bar. No vertical splitters — the
 * original allotment-split version felt loud and unfinished when
 * either pane was empty. Form fields use plain inline labels (not
 * uppercase tracking-wide headers) for the same reason.
 *
 * Errors from every async step (`gh repo view`, `gh pr create`,
 * commit, push) are surfaced inline via `<ErrorBanner>` so the
 * user always knows what's wrong without opening devtools.
 */
export function CreatePrPane({ directory }: Props) {
  const rpc = useRpc()
  // Forward navigation out of the composer goes through the
  // panel-event system so each click can choose new-tab / split /
  // replace. Defaults are tuned per-button: see each `onClick`
  // below.
  const openPrView = useOpenPrView(directory)

  // GitHub-style typeahead in the description editor. Both triggers
  // hit cached service RPCs, so subsequent keystrokes are basically
  // free; the first one warms the cache. We rank locally with a
  // tiny substring/prefix scorer (full fuzzy is overkill for
  // <=100-row lists) and cap at 8 rows to match the menu's
  // `MAX_VISIBLE`.
  const descriptionTriggers = useMemo<readonly TypeaheadTrigger[]>(() => {
    const limit = 8
    return [
      {
        char: "@",
        emptyLabel: "No matching contributors",
        fetch: async (query: string): Promise<TypeaheadItem[]> => {
          const res = await rpc.app.github.listAssignableUsers({ directory })
          if (!res.ok) return []
          const q = query.toLowerCase()
          const ranked = res.users
            .map(u => ({
              user: u,
              score: scoreCandidate(
                q,
                u.login.toLowerCase(),
                (u.name ?? "").toLowerCase(),
              ),
            }))
            .filter(r => q === "" || r.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
          return ranked.map(({ user }) => ({
            key: user.login,
            label: user.login,
            insertText: `@${user.login}`,
            display: (
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="text-foreground">
                  @{user.login}
                </span>
                {user.name && (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    {user.name}
                  </span>
                )}
              </span>
            ),
          }))
        },
      },
      {
        char: "#",
        // Match GitHub: `#` triggers issue autocomplete *everywhere*
        // it could be a reference, including at the start of a
        // line. The previous "require whitespace before" rule was
        // meant to suppress the menu flash on `# Heading`, but it
        // also killed the primary use case (`#1` at line start),
        // which matters far more. The flash on `# ` is fine — the
        // detector already drops the trigger as soon as whitespace
        // is typed after `#`, so the menu closes itself.
        emptyLabel: "No matching issues",
        fetch: async (query: string): Promise<TypeaheadItem[]> => {
          const res = await rpc.app.github.listIssues({ directory })
          if (!res.ok) return []
          const q = query.toLowerCase()
          const ranked = res.issues
            .map(issue => ({
              issue,
              score: scoreCandidate(
                q,
                String(issue.number),
                issue.title.toLowerCase(),
              ),
            }))
            .filter(r => q === "" || r.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
          return ranked.map(({ issue }) => ({
            key: String(issue.number),
            label: `#${issue.number}`,
            insertText: `#${issue.number}`,
            display: (
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  className={cn(
                    "text-[11px]",
                    issue.state === "OPEN"
                      ? "text-green-600 dark:text-green-400"
                      : "text-muted-foreground",
                  )}
                >
                  #{issue.number}
                </span>
                <span className="min-w-0 truncate text-foreground">
                  {issue.title}
                </span>
              </span>
            ),
          }))
        },
      },
    ]
  }, [directory, rpc])
  const [repo, setRepo] = useState<RepoState>({ kind: "loading" })
  const [base, setBase] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [titleEdited, setTitleEdited] = useState(false)
  const [reviewers, setReviewers] = useState("")
  const [body, setBody] = useState("")
  const [bodyEdited, setBodyEdited] = useState(false)
  const [generatingBody, setGeneratingBody] = useState(false)
  const [draft, setDraft] = useState(false)
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" })
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [commits, setCommits] = useState<GhCommit[] | null>(null)
  const [commitsError, setCommitsError] = useState<string | null>(null)
  const [dirty, setDirty] = useState<boolean>(false)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)

  // Load repo info up front. The service has usually already
  // prefetched this, so `getRepoInfo` lands instantly.
  useEffect(() => {
    let cancelled = false
    setRepo({ kind: "loading" })
    void rpc.app.github.getRepoInfo({ directory }).then(res => {
      if (cancelled) return
      if (!res.ok) {
        setRepo({ kind: "error", error: res.error })
        return
      }
      setRepo({ kind: "ready", info: res })
      setBase(res.defaultBranch)
    })
    return () => {
      cancelled = true
    }
  }, [directory, rpc])

  const reload = useCallback(async () => {
    if (repo.kind !== "ready" || !base) return
    setCommitsError(null)
    const [commitsRes, dirtyRes] = await Promise.all([
      rpc.app.github.getBranchCommits({ directory, base }),
      rpc.app.github.getWorkingTreeSummary({ directory }),
    ])
    if (commitsRes.ok) {
      setCommits(commitsRes.commits)
      if (commitsRes.commits.length > 0) {
        if (!titleEdited) {
          setTitle(commitsRes.commits[0].subject)
        }
        setSelectedCommit(prev => {
          if (prev && commitsRes.commits.some(c => c.sha === prev)) return prev
          return commitsRes.commits[0]?.sha ?? null
        })
      } else {
        setSelectedCommit(null)
      }
    } else {
      setCommitsError(commitsRes.error)
      setCommits([])
    }
    if (dirtyRes.ok) {
      setDirty(dirtyRes.dirty)
    } else {
      setDirty(false)
    }
  }, [base, directory, repo.kind, rpc, titleEdited])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleGenerateBody = useCallback(async () => {
    if (repo.kind !== "ready" || !base) return
    setGeneratingBody(true)
    try {
      const res = await rpc.app.github.generatePrBody({
        directory,
        base,
        title: title || "Untitled PR",
      })
      if (res.ok) {
        setBody(res.body)
        setBodyEdited(true)
      } else {
        setSubmitError(res.error)
      }
    } finally {
      setGeneratingBody(false)
    }
  }, [base, directory, repo.kind, rpc, title])

  const canSubmit =
    repo.kind === "ready" &&
    !!base &&
    !!title.trim() &&
    !dirty &&
    (commits?.length ?? 0) > 0 &&
    submit.kind !== "creating"

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || repo.kind !== "ready" || !base) return
    setSubmitError(null)
    setSubmit({ kind: "creating", step: "Pushing branch…" })
    const reviewerList = reviewers
      .split(/[\s,]+/)
      .map(r => r.trim())
      .filter(Boolean)
    const res = await rpc.app.github.createPullRequest({
      directory,
      title: title.trim(),
      body,
      base,
      reviewers: reviewerList,
      draft,
    })
    if (!res.ok) {
      setSubmit({ kind: "idle" })
      setSubmitError(res.error)
      return
    }
    setSubmit({ kind: "success", url: res.url, number: res.number })
  }, [base, body, canSubmit, directory, draft, repo.kind, reviewers, rpc, title])

  if (repo.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12px] text-muted-foreground">
        <Spinner className="size-3" />
        Loading repository…
      </div>
    )
  }
  if (repo.kind === "error") {
    return (
      <div className="flex h-full flex-col gap-3 p-6">
        <ErrorBanner title="Could not load repository" detail={repo.error} />
        <div className="text-[12px] text-muted-foreground">
          Make sure <code>gh</code> is installed and authenticated
          (<code>gh auth login</code>),
          and that the current directory is a GitHub repo.
        </div>
      </div>
    )
  }

  if (submit.kind === "success") {
    return (
      <SuccessScreen
        url={submit.url}
        number={submit.number}
        onShowList={e =>
          openPrView({
            mode: "list",
            openMode: modifierOpenMode(e, "new-tab"),
          })
        }
        onShowPr={e =>
          openPrView({
            mode: "detail",
            prNumber: submit.number,
            openMode: modifierOpenMode(e, "new-tab"),
          })
        }
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        info={repo.info}
        base={base}
        // "Open PRs" is forward navigation to a different page —
        // default to a fresh tab so the in-progress draft on the
        // composer survives in the pane the user came from. Shift
        // opens it side-by-side; Cmd/middle-click also new-tab
        // (browser parity).
        onShowList={e =>
          openPrView({
            mode: "list",
            openMode: modifierOpenMode(e, "new-tab"),
          })
        }
        onRefresh={() => void reload()}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-5">
          {dirty ? (
            // Phase 1: working tree dirty. The PR form is irrelevant
            // — the user literally cannot submit until they commit
            // — so we hide it entirely. The commit composer mounts
            // auto-focused; the working-tree diff renders below it
            // so the user can see *what they're about to commit*
            // while they write the message. Once they commit,
            // `reload()` flips `dirty` to false and the surface
            // swaps to Phase 2 (the PR composer).
            <>
              <CommitMessageSection
                directory={directory}
                autoFocus
                onCommitted={() => void reload()}
              />
              <WorkingTreeDiff directory={directory} />
            </>
          ) : (
            // Phase 2: working tree clean. PR form. Reviewers /
            // draft / AI helper are tucked behind progressive
            // disclosure so a first-time user sees one big input
            // (title) and one big input (description) — the GitHub
            // compose-PR shape — with everything else discoverable
            // via a single "More options" affordance below.
            <>
              <FormFields
                directory={directory}
                title={title}
                onTitleChange={v => {
                  setTitle(v)
                  setTitleEdited(true)
                }}
                reviewers={reviewers}
                onReviewersChange={setReviewers}
                body={body}
                onBodyChange={v => {
                  setBody(v)
                  setBodyEdited(true)
                }}
                bodyEdited={bodyEdited}
                generatingBody={generatingBody}
                onGenerateBody={() => void handleGenerateBody()}
                descriptionTriggers={descriptionTriggers}
              />
              {submitError && (
                <ErrorBanner
                  title="Could not create pull request"
                  detail={submitError}
                  onDismiss={() => setSubmitError(null)}
                />
              )}
              <CommitsSection
                directory={directory}
                commits={commits}
                commitsError={commitsError}
                selected={selectedCommit}
                onSelect={setSelectedCommit}
              />
            </>
          )}
        </div>
      </div>

      {!dirty && (
        <BottomBar
          canSubmit={canSubmit}
          submitting={submit.kind === "creating"}
          submitStep={submit.kind === "creating" ? submit.step : null}
          hasCommits={(commits?.length ?? 0) > 0}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={() => void handleSubmit()}
        />
      )}
    </div>
  )
}

function TopBar({
  info,
  base,
  onShowList,
  onRefresh,
}: {
  info: GhRepoInfo
  base: string | null
  onShowList: (e: React.MouseEvent) => void
  onRefresh: () => void
}) {
  // Single-line, fixed-height header. The two text segments use
  // `min-w-0 truncate` so they ellipsize on a narrow pane instead
  // of wrapping the row to two lines; the separator and the action
  // cluster are `shrink-0` so they never get clipped first. Browsers
  // happily soft-break at hyphens and arrows otherwise, which is
  // what was puffing the bar up.
  const branch = info.currentBranch ?? "(detached)"
  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 overflow-hidden border-b px-3 text-[12px]"
      // Native tooltip with the full path, since we may have
      // truncated the visible text.
      title={`${info.owner}/${info.name} — ${branch} → ${base ?? "?"}`}
    >
      <span className="min-w-0 shrink truncate text-muted-foreground">
        {info.owner}/{info.name}
      </span>
      <span className="shrink-0 text-muted-foreground/40">·</span>
      <span className="flex min-w-0 shrink items-baseline gap-1">
        <span className="min-w-0 truncate text-foreground">{branch}</span>
        <span className="shrink-0 text-muted-foreground">→</span>
        <span className="min-w-0 truncate text-foreground">{base ?? "?"}</span>
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="h-6 px-1.5 text-[11px]"
        >
          Refresh
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onShowList}
          // Native tooltip explains the keyboard story — it's the
          // same vocabulary every PR forward-nav button uses, so
          // worth being explicit on the first one users meet.
          title="Open in new tab · Shift: split · Alt: replace"
          className="h-6 px-1.5 text-[11px]"
        >
          Open PRs
        </Button>
      </div>
    </div>
  )
}

function FormFields({
  directory,
  title,
  onTitleChange,
  reviewers,
  onReviewersChange,
  body,
  onBodyChange,
  bodyEdited,
  generatingBody,
  onGenerateBody,
  descriptionTriggers,
}: {
  directory: string
  title: string
  onTitleChange: (v: string) => void
  reviewers: string
  onReviewersChange: (v: string) => void
  body: string
  onBodyChange: (v: string) => void
  bodyEdited: boolean
  generatingBody: boolean
  onGenerateBody: () => void
  descriptionTriggers: readonly TypeaheadTrigger[]
}) {
  // "Reviewers" is collapsed by default — a first-time user sees
  // two big inputs (title, description) and a single quiet "Add
  // reviewers" link, mirroring GitHub's sidebar-style affordance.
  // The input expands inline only when asked for, or when the user
  // has already typed something into it (so an AI-prefilled value
  // survives a re-render and stays visible).
  const [reviewersOpen, setReviewersOpen] = useState(
    () => reviewers.trim().length > 0,
  )
  return (
    <div className="flex flex-col gap-3">
      <Input
        value={title}
        onChange={e => onTitleChange(e.target.value)}
        placeholder="Title"
        autoFocus
        // Title is the one always-required field. Larger text so
        // it's the first thing the eye lands on — GitHub's compose
        // page does the same.
        className="h-10 text-[15px]"
      />
      <div className="flex flex-col gap-1">
        <MarkdownEditor
          value={body}
          onChange={onBodyChange}
          // Short placeholder, matching GitHub. The @/# affordances
          // are discoverable by typing; no need to advertise them in
          // the empty state.
          placeholder={bodyEdited ? "" : "Description"}
          className="min-h-[160px] resize-y"
          triggers={descriptionTriggers}
        />
        {/* The only inline action on the description — keep it
         *  subtle and right-aligned, no checkboxes / extra hint
         *  text that compete for attention. */}
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onGenerateBody}
            disabled={generatingBody}
            className="h-6 px-2 text-[11px] text-muted-foreground"
          >
            {generatingBody ? (
              <>
                <Spinner className="size-3" /> Generating
              </>
            ) : (
              "Generate with AI"
            )}
          </Button>
        </div>
      </div>
      {reviewersOpen ? (
        <ReviewersInput
          directory={directory}
          value={reviewers}
          onChange={onReviewersChange}
          autoFocus={reviewers.trim().length === 0}
        />
      ) : (
        <button
          type="button"
          onClick={() => setReviewersOpen(true)}
          className="self-start text-[12px] text-muted-foreground hover:text-foreground"
        >
          + Add reviewers
        </button>
      )}
    </div>
  )
}

function CommitsSection({
  directory,
  commits,
  commitsError,
  selected,
  onSelect,
}: {
  directory: string
  commits: GhCommit[] | null
  commitsError: string | null
  selected: string | null
  onSelect: (sha: string) => void
}) {
  if (commitsError) {
    return <ErrorBanner title="Could not load commits" detail={commitsError} />
  }
  if (commits == null) {
    // Skip the noisy "Loading commits…" placeholder. The single
    // empty frame is shorter than the user reads the spinner.
    return null
  }
  if (commits.length === 0) {
    return (
      <div className="rounded border border-dashed p-3 text-[12px] text-muted-foreground">
        No commits on this branch yet. Commit your changes above to add them
        to the PR.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-medium">
        Commits{" "}
        <span className="text-muted-foreground">({commits.length})</span>
      </div>
      <div className="overflow-hidden rounded border">
        <PrCommitsList
          commits={commits}
          selected={selected}
          onSelect={onSelect}
          variant="inline"
        />
      </div>
      {selected && (
        <div className="overflow-hidden rounded border">
          <PrDiffViewer
            key={selected}
            directory={directory}
            sha={selected}
            commit={commits.find(c => c.sha === selected) ?? null}
            variant="inline"
          />
        </div>
      )}
    </div>
  )
}

function BottomBar({
  canSubmit,
  submitting,
  submitStep,
  hasCommits,
  draft,
  onDraftChange,
  onSubmit,
}: {
  canSubmit: boolean
  submitting: boolean
  submitStep: string | null
  hasCommits: boolean
  draft: boolean
  onDraftChange: (v: boolean) => void
  onSubmit: () => void
}) {
  // The dirty-tree case is handled upstream by hiding the bar
  // entirely, so we only have to explain "no commits yet" here.
  const helper = !hasCommits ? "No commits to put in this PR." : null

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-t bg-background px-3">
      {helper && (
        <span className="text-[12px] text-muted-foreground">{helper}</span>
      )}
      {submitting && submitStep && (
        <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Spinner className="size-3" /> {submitStep}
        </span>
      )}
      {/* "Open as draft" lives next to the Create button rather
       *  than inline with the description — it modifies the
       *  submit action, so it belongs in the action cluster. */}
      <label className="ml-auto flex select-none items-center gap-1.5 text-[12px] text-muted-foreground">
        <input
          type="checkbox"
          checked={draft}
          onChange={e => onDraftChange(e.target.checked)}
        />
        Open as draft
      </label>
      <Button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        size="sm"
        className={cn("h-7 px-3 text-[12px]")}
      >
        {submitting ? "Creating…" : "Create pull request"}
      </Button>
    </div>
  )
}

/**
 * Tiny scorer for the typeahead. Substring matches in either field
 * count; prefix matches in the primary field win. Returns 0 when the
 * query matches nothing in either field.
 *
 * Deliberately not full fuzzy — the lists are capped at ~100 rows
 * and a quick substring sort feels more predictable than a fuzzy
 * scorer that promotes unrelated rows just because they happen to
 * share characters in order.
 */
function scoreCandidate(
  query: string,
  primary: string,
  secondary: string,
): number {
  if (!query) return 1
  let score = 0
  if (primary.startsWith(query)) score += 100
  if (primary.includes(query)) score += 50
  if (secondary.includes(query)) score += 10
  return score
}

function SuccessScreen({
  url,
  number,
  onShowList,
  onShowPr,
}: {
  url: string
  number: number
  onShowList: (e: React.MouseEvent) => void
  onShowPr: (e: React.MouseEvent) => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <div className="text-[14px] font-medium">
        Pull request #{number} created.
      </div>
      <div className="break-all text-[12px] text-muted-foreground">
        {url}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="default"
          className="h-7 px-3 text-[12px]"
          onClick={onShowPr}
        >
          View PR
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-3 text-[12px]"
          onClick={onShowList}
        >
          All open PRs
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-3 text-[12px]"
          onClick={() => {
            const a = document.createElement("a")
            a.href = url
            a.target = "_blank"
            a.rel = "noopener noreferrer"
            a.click()
          }}
        >
          Open in browser
        </Button>
      </div>
    </div>
  )
}

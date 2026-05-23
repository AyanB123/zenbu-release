/**
 * Re-export the RPC-level types from the main process so renderer
 * code doesn't import from the main barrel. Wire shape matches the
 * `GithubService` exports 1:1.
 */
export type {
  GhCommit,
  GhRepoInfo,
  PrSummary,
  PrDetails,
} from "../../../main/services/github"

export type PullRequestsViewMode = "create" | "list" | "detail"

export type PullRequestsViewArgs = {
  directory?: string | null
  /** Which sub-page the iframe should mount on first load. */
  mode?: PullRequestsViewMode
  /** Required when `mode === "detail"`. */
  prNumber?: number
}

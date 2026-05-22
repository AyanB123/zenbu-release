/**
 * Re-export the RPC-level types so renderer modules don't pull from
 * the main process barrel directly. The shape is identical on
 * purpose — these are the wire types.
 */
export type {
  GitStatus,
  GitFileStatus,
  GitCommit,
  GitBranch,
} from "../../../main/services/pr"

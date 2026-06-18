import { describe, expect, it } from "vitest"
import { parsePiPackageDetailId, piPackageDetailId } from "./pi-package-store"

describe("Pi package detail ids", () => {
  it("round-trips source and scope for installed package details", () => {
    const id = piPackageDetailId("npm:pi-subagents", "project")

    expect(parsePiPackageDetailId(id)).toEqual({
      scope: "project",
      source: "npm:pi-subagents",
    })
  })

  it("keeps compatibility with source-only ids", () => {
    expect(parsePiPackageDetailId("pi:npm:pi-subagents")).toEqual({
      scope: null,
      source: "npm:pi-subagents",
    })
  })
})

import { describe, expect, it } from "vitest"
import { shouldEnableDbReplicaTracer } from "./db-replica-tracer"

describe("shouldEnableDbReplicaTracer", () => {
  it("is disabled by default in dev", () => {
    expect(
      shouldEnableDbReplicaTracer({
        dev: true,
        search: "",
        localStorageValue: null,
      }),
    ).toBe(false)
  })

  it("enables in dev when requested by query string", () => {
    expect(
      shouldEnableDbReplicaTracer({
        dev: true,
        search: "?dbTrace=1",
        localStorageValue: null,
      }),
    ).toBe(true)
  })

  it("enables in dev when requested by localStorage", () => {
    expect(
      shouldEnableDbReplicaTracer({
        dev: true,
        search: "",
        localStorageValue: "1",
      }),
    ).toBe(true)
  })

  it("stays disabled outside dev even when requested", () => {
    expect(
      shouldEnableDbReplicaTracer({
        dev: false,
        search: "?dbTrace=1",
        localStorageValue: "1",
      }),
    ).toBe(false)
  })
})

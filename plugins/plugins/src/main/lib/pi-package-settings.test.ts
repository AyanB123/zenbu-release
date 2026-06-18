import { describe, expect, it } from "vitest"
import {
  createDisabledPackageEntry,
  isPackageDisabled,
  setPiPackageEnabledInList,
} from "./pi-package-settings"

describe("Pi package settings transforms", () => {
  it("disables string package entries without removing the package", () => {
    const result = setPiPackageEnabledInList({
      packages: ["npm:pi-subagents"],
      backups: {},
      source: "npm:pi-subagents",
      enabled: false,
    })

    expect(result.changed).toBe(true)
    expect(result.packages).toEqual([
      {
        source: "npm:pi-subagents",
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      },
    ])
    expect(isPackageDisabled(result.packages[0])).toBe(true)
  })

  it("re-enables disabled package entries as string entries when no backup exists", () => {
    const result = setPiPackageEnabledInList({
      packages: [createDisabledPackageEntry("npm:pi-subagents")],
      backups: {},
      source: "npm:pi-subagents",
      enabled: true,
    })

    expect(result.changed).toBe(true)
    expect(result.packages).toEqual(["npm:pi-subagents"])
  })

  it("preserves existing package resource filters across disable and enable", () => {
    const disabled = setPiPackageEnabledInList({
      packages: [
        {
          source: "npm:pi-subagents",
          extensions: ["./src/extension/index.ts"],
          skills: ["./skills/reviewer.md"],
        },
      ],
      backups: {},
      source: "npm:pi-subagents",
      enabled: false,
    })

    expect(disabled.backups).toEqual({
      "npm:pi-subagents": {
        extensions: ["./src/extension/index.ts"],
        skills: ["./skills/reviewer.md"],
      },
    })

    const enabled = setPiPackageEnabledInList({
      packages: disabled.packages,
      backups: disabled.backups,
      source: "npm:pi-subagents",
      enabled: true,
    })

    expect(enabled.packages).toEqual([
      {
        source: "npm:pi-subagents",
        extensions: ["./src/extension/index.ts"],
        skills: ["./skills/reviewer.md"],
      },
    ])
    expect(enabled.backups).toEqual({})
  })

  it("leaves unrelated packages unchanged", () => {
    const result = setPiPackageEnabledInList({
      packages: ["npm:pi-web-access"],
      backups: {},
      source: "npm:pi-subagents",
      enabled: false,
    })

    expect(result.changed).toBe(false)
    expect(result.packages).toEqual(["npm:pi-web-access"])
  })
})

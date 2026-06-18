import { useCallback, useMemo } from "react"
import { useDb, useRpc } from "@zenbujs/core/react"
import type {
  PiInstalledPackage,
  PiPackageListing,
} from "../main/services/pi-packages"

export function usePiCatalog(): PiPackageListing[] {
  const catalog = useDb(root =>
    ((root.plugins as unknown as { piCatalog?: Record<string, PiPackageListing> })
      .piCatalog ?? {}),
  )
  return useMemo(
    () =>
      Object.values(catalog).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [catalog],
  )
}

export function useInstalledPiPackages(): PiInstalledPackage[] {
  const installed = useDb(root =>
    ((root.plugins as unknown as {
      piInstalled?: Record<string, PiInstalledPackage>
    }).piInstalled ?? {}),
  )
  return useMemo(
    () =>
      Object.values(installed).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [installed],
  )
}

export function usePiPackageActions() {
  const rpc = useRpc()
  const piPackages = (rpc.plugins as unknown as { piPackages: PiPackagesRpc })
    .piPackages
  return useMemo(
    () => ({
      refresh: (cwd?: string | null) => piPackages.listInstalledPiPackages({ cwd }),
      install: (source: string, local = false) =>
        piPackages.installPiPackage({ source, local }),
      setEnabled: (
        pkg: Pick<PiInstalledPackage, "source" | "scope">,
        enabled: boolean,
      ) =>
        piPackages.setPiPackageEnabled({
          source: pkg.source,
          scope: pkg.scope,
          enabled,
        }),
      remove: (pkg: Pick<PiInstalledPackage, "source" | "scope">) =>
        piPackages.removePiPackage({ source: pkg.source, scope: pkg.scope }),
      update: (source?: string) => piPackages.updatePiPackage({ source }),
      readDetail: (pkg: Pick<PiInstalledPackage, "source" | "scope">) =>
        piPackages.readPiPackageDetail({ source: pkg.source, scope: pkg.scope }),
    }),
    [piPackages],
  )
}

export function useRefreshPiPackages(): () => void {
  const rpc = useRpc()
  const piPackages = (rpc.plugins as unknown as { piPackages: PiPackagesRpc })
    .piPackages
  return useCallback(() => {
    void piPackages.listInstalledPiPackages({}).catch((err: unknown) => {
      console.error("[pi-packages] refresh failed:", err)
    })
  }, [piPackages])
}

type PiPackageScope = "user" | "project"

export type PiPackageDetailRef = {
  source: string
  scope: PiPackageScope | null
}

export function piPackageDetailId(
  source: string,
  scope?: PiPackageScope,
): string {
  const encodedSource = encodeURIComponent(source)
  return scope ? `pi:${scope}:${encodedSource}` : `pi:${encodedSource}`
}

export function parsePiPackageDetailId(
  id: string | null | undefined,
): PiPackageDetailRef | null {
  if (!id?.startsWith("pi:")) return null
  const body = id.slice(3)
  const separator = body.indexOf(":")
  if (separator > 0) {
    const maybeScope = body.slice(0, separator)
    if (maybeScope === "user" || maybeScope === "project") {
      return {
        scope: maybeScope,
        source: safeDecodeURIComponent(body.slice(separator + 1)),
      }
    }
  }
  // Backward-compatible with the earlier source-only id shape,
  // including unencoded ids like `pi:npm:pi-subagents`.
  return { scope: null, source: safeDecodeURIComponent(body) }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

type PiPackagesRpc = {
  listInstalledPiPackages(args?: { cwd?: string | null }): Promise<{
    packages: PiInstalledPackage[]
  }>
  installPiPackage(args: {
    source: string
    local?: boolean
    cwd?: string | null
  }): Promise<{ ok: true; package: PiInstalledPackage | null }>
  setPiPackageEnabled(args: {
    source: string
    scope?: "user" | "project"
    enabled: boolean
    cwd?: string | null
  }): Promise<{ ok: true }>
  removePiPackage(args: {
    source: string
    scope?: "user" | "project"
    cwd?: string | null
  }): Promise<{ ok: true }>
  updatePiPackage(args: { source?: string; cwd?: string | null }): Promise<{
    ok: true
  }>
  readPiPackageDetail(args: {
    source: string
    scope?: "user" | "project"
    cwd?: string | null
  }): Promise<{ readme: string | null; packageJson: Record<string, unknown> | null }>
}

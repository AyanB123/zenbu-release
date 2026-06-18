import type { PackageSource } from "@earendil-works/pi-coding-agent"

export const PI_RESOURCE_TYPES = [
  "extensions",
  "skills",
  "prompts",
  "themes",
] as const

export type PiResourceType = (typeof PI_RESOURCE_TYPES)[number]
export type PiPackageFilters = Partial<Record<PiResourceType, string[]>>
export type PiDisabledFilterBackups = Record<string, PiPackageFilters>

export type PiPackageToggleResult = {
  packages: PackageSource[]
  backups: PiDisabledFilterBackups
  changed: boolean
}

export function getPackageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source
}

export function findPackageEntry(
  packages: readonly PackageSource[],
  source: string,
): PackageSource | null {
  return packages.find(entry => getPackageSource(entry) === source) ?? null
}

export function isPackageDisabled(entry: PackageSource | null | undefined): boolean {
  if (!entry || typeof entry === "string") return false
  return PI_RESOURCE_TYPES.every(type => {
    const values = entry[type]
    return Array.isArray(values) && values.length === 0
  })
}

export function getPackageFilters(entry: PackageSource): PiPackageFilters {
  if (typeof entry === "string") return {}
  const filters: PiPackageFilters = {}
  for (const type of PI_RESOURCE_TYPES) {
    const values = entry[type]
    if (Array.isArray(values)) filters[type] = [...values]
  }
  return filters
}

export function createDisabledPackageEntry(source: string): PackageSource {
  return {
    source,
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  }
}

export function setPiPackageEnabledInList(args: {
  packages: readonly PackageSource[]
  backups: PiDisabledFilterBackups
  source: string
  enabled: boolean
}): PiPackageToggleResult {
  const { packages, backups, source, enabled } = args
  const index = packages.findIndex(entry => getPackageSource(entry) === source)
  if (index < 0) {
    return { packages: [...packages], backups: { ...backups }, changed: false }
  }

  const current = packages[index]!
  const nextPackages = [...packages]
  const nextBackups: PiDisabledFilterBackups = { ...backups }

  if (!enabled) {
    if (isPackageDisabled(current)) {
      return { packages: nextPackages, backups: nextBackups, changed: false }
    }
    if (typeof current !== "string") {
      nextBackups[source] = getPackageFilters(current)
    }
    nextPackages[index] = createDisabledPackageEntry(source)
    return { packages: nextPackages, backups: nextBackups, changed: true }
  }

  if (!isPackageDisabled(current)) {
    return { packages: nextPackages, backups: nextBackups, changed: false }
  }

  const backup = nextBackups[source]
  if (backup && Object.keys(backup).length > 0) {
    nextPackages[index] = { source, ...cloneFilters(backup) }
    delete nextBackups[source]
    return { packages: nextPackages, backups: nextBackups, changed: true }
  }

  nextPackages[index] = source
  delete nextBackups[source]
  return { packages: nextPackages, backups: nextBackups, changed: true }
}

function cloneFilters(filters: PiPackageFilters): PiPackageFilters {
  const out: PiPackageFilters = {}
  for (const type of PI_RESOURCE_TYPES) {
    const values = filters[type]
    if (values) out[type] = [...values]
  }
  return out
}

import fs from "node:fs/promises"
import path from "node:path"
import { Service } from "@zenbujs/core/runtime"
import { DbService } from "@zenbujs/core/services"
import type {
  DefaultPackageManager,
  PackageSource,
  ResolvedResource,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"
import {
  findPackageEntry,
  getPackageFilters,
  isPackageDisabled,
  PI_RESOURCE_TYPES,
  setPiPackageEnabledInList,
  type PiDisabledFilterBackups,
  type PiPackageFilters,
  type PiResourceType,
} from "../lib/pi-package-settings"

const PI_SUBAGENTS_SOURCE = "npm:pi-subagents"
const PI_CATALOG: PiPackageListing[] = [
  {
    id: "pi-subagents",
    source: PI_SUBAGENTS_SOURCE,
    name: "pi-subagents",
    description:
      "Delegate Pi tasks to subagents with chains, parallel execution, and TUI clarification.",
    version: "0.28.0",
    author: "Nico Bailon",
    license: "MIT",
    tags: ["agents", "subagents", "parallel", "workflow"],
    types: ["extension", "skill", "prompt"],
    downloadCount: null,
    updatedAt: "2026-06-03",
    installCommand: `pi install ${PI_SUBAGENTS_SOURCE}`,
    readme: null,
    homepageUrl: "https://pi.dev/packages/pi-subagents",
    repositoryUrl: "https://github.com/nicobailon/pi-subagents",
    npmUrl: "https://www.npmjs.com/package/pi-subagents",
    securityReviewed: null,
  },
]

export type PiPackageResourceKind = PiResourceType
export type PiPackageListing = {
  id: string
  source: string
  name: string
  description: string
  version: string | null
  author: string | null
  license: string | null
  tags: string[]
  types: Array<"extension" | "skill" | "prompt" | "theme">
  downloadCount: number | null
  updatedAt: string | null
  installCommand: string
  readme: string | null
  homepageUrl: string | null
  repositoryUrl: string | null
  npmUrl: string | null
  securityReviewed: boolean | null
}

export type PiPackageResource = {
  kind: PiPackageResourceKind
  path: string
  enabled: boolean
}

export type PiInstalledPackage = {
  id: string
  source: string
  scope: "user" | "project"
  installedPath: string | null
  installed: boolean
  enabled: boolean
  filtered: boolean
  filters: PiPackageFilters | null
  name: string
  description: string | null
  version: string | null
  author: string | null
  license: string | null
  resources: Record<PiPackageResourceKind, PiPackageResource[]>
  diagnostics: string[]
}

type ConfiguredPackage = {
  source: string
  scope: "user" | "project"
  filtered: boolean
  installedPath?: string
}

export class PiPackagesService extends Service.create({
  key: "piPackages",
  deps: { db: DbService },
}) {
  evaluate() {
    this.setup("seed-pi-catalog", () => {
      void this.seedCatalog()
    })
  }

  async listPiCatalog(args: { query?: string } = {}): Promise<{
    packages: PiPackageListing[]
  }> {
    await this.seedCatalog()
    const query = args.query?.trim().toLowerCase()
    const all = Object.values(this.getPluginState().piCatalog ?? {}) as PiPackageListing[]
    if (!query) return { packages: all }
    return {
      packages: all.filter(pkg => {
        return (
          pkg.name.toLowerCase().includes(query) ||
          pkg.description.toLowerCase().includes(query) ||
          pkg.tags.some(tag => tag.toLowerCase().includes(query)) ||
          pkg.source.toLowerCase().includes(query)
        )
      }),
    }
  }

  async listInstalledPiPackages(args: {
    cwd?: string | null
  } = {}): Promise<{ packages: PiInstalledPackage[] }> {
    return { packages: await this.syncInstalled({ cwd: args.cwd }) }
  }

  async installPiPackage(args: {
    source: string
    local?: boolean
    cwd?: string | null
  }): Promise<{ ok: true; package: PiInstalledPackage | null }> {
    const source = normalizeSource(args.source)
    const { manager, packageManager } = await this.createPackageManager(args.cwd)
    await packageManager.installAndPersist(source, { local: args.local ?? false })
    await manager.flush()
    const packages = await this.syncInstalled({ cwd: args.cwd })
    return {
      ok: true,
      package: packages.find(pkg => pkg.source === source) ?? null,
    }
  }

  async setPiPackageEnabled(args: {
    source: string
    scope?: "user" | "project"
    enabled: boolean
    cwd?: string | null
  }): Promise<{ ok: true }> {
    const source = normalizeSource(args.source)
    const scope = args.scope ?? "user"
    const { manager } = await this.createPackageManager(args.cwd)
    const settings = scope === "project"
      ? manager.getProjectSettings()
      : manager.getGlobalSettings()
    const packages = settings.packages ?? []
    const allBackups = this.getDisabledBackups()
    const backupKey = piPackageKey(source, scope)
    const backups = allBackups[backupKey]
      ? { [source]: allBackups[backupKey] }
      : {}
    const result = setPiPackageEnabledInList({
      packages,
      backups,
      source,
      enabled: args.enabled,
    })
    if (!result.changed) return { ok: true }

    if (scope === "project") manager.setProjectPackages(result.packages)
    else manager.setPackages(result.packages)
    await manager.flush()

    if (result.backups[source]) allBackups[backupKey] = result.backups[source]
    else delete allBackups[backupKey]
    await this.setDisabledBackups(allBackups)
    await this.syncInstalled({ cwd: args.cwd })
    return { ok: true }
  }

  async removePiPackage(args: {
    source: string
    scope?: "user" | "project"
    cwd?: string | null
  }): Promise<{ ok: true }> {
    const source = normalizeSource(args.source)
    const scope = args.scope ?? "user"
    const { manager, packageManager } = await this.createPackageManager(args.cwd)
    await packageManager.removeAndPersist(source, { local: scope === "project" })
    await manager.flush()
    const backups = this.getDisabledBackups()
    delete backups[piPackageKey(source, scope)]
    delete backups[source]
    await this.setDisabledBackups(backups)
    await this.syncInstalled({ cwd: args.cwd })
    return { ok: true }
  }

  async updatePiPackage(args: {
    source?: string
    cwd?: string | null
  }): Promise<{ ok: true }> {
    const { packageManager } = await this.createPackageManager(args.cwd)
    await packageManager.update(args.source ? normalizeSource(args.source) : undefined)
    await this.syncInstalled({ cwd: args.cwd })
    return { ok: true }
  }

  async readPiPackageDetail(args: {
    source: string
    scope?: "user" | "project"
    cwd?: string | null
  }): Promise<{ readme: string | null; packageJson: Record<string, unknown> | null }> {
    const source = normalizeSource(args.source)
    const scope = args.scope ?? "user"
    const { packageManager } = await this.createPackageManager(args.cwd)
    const installedPath = packageManager.getInstalledPath(source, scope)
    if (!installedPath) return { readme: null, packageJson: null }
    const [readme, packageJson] = await Promise.all([
      readFirstExisting([
        path.join(installedPath, "README.md"),
        path.join(installedPath, "readme.md"),
      ]),
      readPackageJson(installedPath),
    ])
    return { readme, packageJson }
  }

  private async seedCatalog(): Promise<void> {
    await this.ctx.db.client.update(root => {
      const plugins = root.plugins as unknown as PluginStateWithPi
      plugins.piCatalog ??= {}
      for (const pkg of PI_CATALOG) plugins.piCatalog[pkg.source] = pkg
    })
  }

  private async syncInstalled(args: {
    cwd?: string | null
  }): Promise<PiInstalledPackage[]> {
    const { manager, packageManager } = await this.createPackageManager(args.cwd)
    const configured = packageManager.listConfiguredPackages() as ConfiguredPackage[]
    const resolved = await packageManager.resolve(async () => "skip")
    const entries = {
      user: manager.getGlobalSettings().packages ?? [],
      project: manager.getProjectSettings().packages ?? [],
    }
    const packages = await Promise.all(
      configured.map(pkg => this.buildInstalledPackage(pkg, resolved, entries)),
    )
    await this.ctx.db.client.update(root => {
      const plugins = root.plugins as unknown as PluginStateWithPi
      plugins.piInstalled = Object.fromEntries(
        packages.map(pkg => [piPackageKey(pkg.source, pkg.scope), pkg]),
      )
    })
    return packages
  }

  private async buildInstalledPackage(
    configured: ConfiguredPackage,
    resolved: {
      extensions: ResolvedResource[]
      skills: ResolvedResource[]
      prompts: ResolvedResource[]
      themes: ResolvedResource[]
    },
    entries: Record<"user" | "project", PackageSource[]>,
  ): Promise<PiInstalledPackage> {
    const entry = findPackageEntry(entries[configured.scope], configured.source)
    const filters = entry && typeof entry !== "string" ? getPackageFilters(entry) : null
    const disabled = isPackageDisabled(entry)
    const resources = collectResourcesForPackage(configured, resolved)
    const packageJson = configured.installedPath
      ? await readPackageJson(configured.installedPath)
      : null
    const catalog = this.getPluginState().piCatalog?.[configured.source] as
      | PiPackageListing
      | undefined
    const name = readString(packageJson?.name) ?? catalog?.name ?? sourceName(configured.source)

    return {
      id: sourceName(configured.source),
      source: configured.source,
      scope: configured.scope,
      installedPath: configured.installedPath ?? null,
      installed: configured.installedPath != null,
      enabled: !disabled,
      filtered: configured.filtered,
      filters,
      name,
      description: readString(packageJson?.description) ?? catalog?.description ?? null,
      version: readString(packageJson?.version) ?? catalog?.version ?? null,
      author: readAuthor(packageJson?.author) ?? catalog?.author ?? null,
      license: readString(packageJson?.license) ?? catalog?.license ?? null,
      resources,
      diagnostics: configured.installedPath ? [] : ["Package source is configured but not installed."],
    }
  }

  private async createPackageManager(cwd?: string | null): Promise<{
    manager: SettingsManager
    packageManager: DefaultPackageManager
  }> {
    const {
      DefaultPackageManager,
      getAgentDir,
      SettingsManager,
    } = await import("@earendil-works/pi-coding-agent")
    const agentDir = getAgentDir()
    const manager = SettingsManager.create(cwd || process.cwd(), agentDir)
    const packageManager = new DefaultPackageManager({
      cwd: cwd || process.cwd(),
      agentDir,
      settingsManager: manager,
    })
    return { manager, packageManager }
  }

  private getPluginState(): PluginStateWithPi {
    return this.ctx.db.client.readRoot().plugins as unknown as PluginStateWithPi
  }

  private getDisabledBackups(): PiDisabledFilterBackups {
    return { ...(this.getPluginState().piDisabledFilterBackups ?? {}) }
  }

  private async setDisabledBackups(
    backups: PiDisabledFilterBackups,
  ): Promise<void> {
    await this.ctx.db.client.update(root => {
      const plugins = root.plugins as unknown as PluginStateWithPi
      plugins.piDisabledFilterBackups = backups
    })
  }
}

type PluginStateWithPi = {
  piCatalog?: Record<string, PiPackageListing>
  piInstalled?: Record<string, PiInstalledPackage>
  piDisabledFilterBackups?: PiDisabledFilterBackups
}

function collectResourcesForPackage(
  configured: ConfiguredPackage,
  resolved: {
    extensions: ResolvedResource[]
    skills: ResolvedResource[]
    prompts: ResolvedResource[]
    themes: ResolvedResource[]
  },
): Record<PiPackageResourceKind, PiPackageResource[]> {
  const resources = {
    extensions: [] as PiPackageResource[],
    skills: [] as PiPackageResource[],
    prompts: [] as PiPackageResource[],
    themes: [] as PiPackageResource[],
  }
  for (const kind of PI_RESOURCE_TYPES) {
    resources[kind] = resolved[kind]
      .filter(resource => {
        return (
          resource.metadata.source === configured.source &&
          resource.metadata.scope === configured.scope
        )
      })
      .map(resource => ({ kind, path: resource.path, enabled: resource.enabled }))
  }
  return resources
}

function normalizeSource(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) throw new Error("Pi package source is required.")
  if (!/^(npm:|git:|file:|\.\.?[\\/]|~[\\/]|[A-Za-z]:[\\/])/.test(trimmed)) {
    throw new Error(
      "Use a Pi package source such as npm:pi-subagents, git:https://..., or a local path.",
    )
  }
  return trimmed
}

function piPackageKey(source: string, scope: "user" | "project"): string {
  return `${scope}:${source}`
}

function sourceName(source: string): string {
  if (source.startsWith("npm:")) return source.slice(4).replace(/^@/, "")
  const withoutRef = source.split("#", 1)[0] ?? source
  return withoutRef.split(/[\\/:]/).filter(Boolean).at(-1)?.replace(/\.git$/, "") ?? source
}

async function readFirstExisting(paths: string[]): Promise<string | null> {
  for (const filePath of paths) {
    try {
      return await fs.readFile(filePath, "utf8")
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "EISDIR") throw err
    }
  }
  return null
}

async function readPackageJson(
  packageDir: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(path.join(packageDir, "package.json"), "utf8")
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function readAuthor(value: unknown): string | null {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return readString((value as { name?: unknown }).name)
  }
  return null
}

export const PI_SUBAGENTS_PACKAGE_SOURCE = PI_SUBAGENTS_SOURCE

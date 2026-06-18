# Zenbu Ecosystem — Deep Analysis & Design Review

**Date:** 2026-06-17
**Scope:** Cross-repo review of Zenbu (`@zenbujs/core`), the `zenbu-release` working tree, Pi (`@earendil-works/pi-coding-agent`) integration, and the framework docs. Findings synthesized from 5 specialist subagent reports (framework core, Pi contract, local-tree audit, plugin authoring, docs), calibrated against direct verification.

**How to read this:** Part A is the ecosystem map. Part B is the prioritized findings table (the actionable list). Part C is the fundamental design issues. Part D is the recommended redesign path. Part E covers the future "plugins contribute custom UI" direction.

---

## Part A — Ecosystem & Intent

### The pieces
| Repo | Role | Stars | Status |
|---|---|---|---|
| `zenbu-labs/zenbu.js` | **The framework** (`@zenbujs/core`). Plugin runtime, Service/DB/RPC/advice, the `zen` CLI, build/publish. | 238 | Public, the canonical source. The installed `node_modules/@zenbujs/core@0.4.4` is **patched** (64 KB patch across 10 dist files). |
| `zenbu-labs/docs` | Framework docs (Mintlify). ~14 pages: plugins, services, state/DB, injections, advice, views, production/mirror. | 1 | Authoritative for intent, but THIN on enable/disable, marketplace, Windows, patches. |
| `zenbu-labs/zenbu-release` | **This repo.** The source mirror the launcher clones on first run. The "app" — an IDE built ON the framework, hosting Pi. | 11 | Public; git log is "sync source" commits. **All real work is the uncommitted tree.** |
| `zenbu-labs/updater-test-plugin` | Reference plugin for the auto-updater. Canonical plugin structure example. | 0 | Reference only. |
| `earendil-works/pi` | **Pi** (`@earendil-works/pi-coding-agent`). The AI agent toolkit this IDE hosts: unified LLM API, agent loop, TUI, coding CLI, package manager. | 63,601 | Public, pre-1.0, fast-moving (Zenbu pins `^0.78.0`; latest 0.79.6). |

### How they fit
- **Zenbu framework** = host shell + plugin runtime. Plugins extend it via `definePlugin` → `Service` (main process) + views/injections (renderer) + DB sections + RPC (auto-reflected).
- **The `app` plugin** (in this repo) = the IDE itself (sessions, terminals, file-tree, repos, window, composer, marketplace).
- **The `pi-commands` plugin** = Pi slash commands + Pi settings section + composer advice.
- **The `plugins` plugin** = the plugin marketplace AND the new Pi Packages integration.
- **Pi** is consumed two ways: (1) its package manager (`DefaultPackageManager`/`SettingsManager`) to install/enable Pi packages, (2) its agent loop via the `app` plugin's `sessions` service (which appears to be a hand-rolled bridge, not Pi's SDK/RPC client).

---

## Part B — Prioritized Findings

> Severity: **P0** = correctness/security/blocker · **P1** = high-impact design flaw · **P2** = tech debt / drift risk · **P3** = nitpick. "Verified" = I confirmed directly, not just from a subagent.

### P0 — Correctness & blockers
| # | Finding | Evidence | Verified |
|---|---|---|---|
| P0-1 | **`file-tree.ts` runtime bug** — `this.suppressWatcherSelfWrites(scopeId)` is spliced *inside* the computed-property-index expression `readRoot().app.fileTreeIndexes[ … scopeId ]` (lines ~349-353), and the method `suppressWatcherSelfWrites` is defined **outside the class body** (class closes at line 471; method at 472-479). `tsc` accepts it, so it's not a build error, but the side-effect-inside-property-access and detached-method-with-`this` is a real runtime smell. The method is also only called inside `if (trace)` blocks, so production gets no self-write suppression. | `plugins/app/src/main/services/file-tree.ts:349-353, 471-479` | ✅ direct |
| P0-2 | **Fresh-clone install is broken** — `package.json` declares `pnpm.patchedDependencies` but `patches/` is **untracked** (`git status` shows `?? patches/`). A clean clone + `pnpm install` will fail to apply the core patch. Same for `.npmrc`, `scripts/`, `docs/`. The release mirror is the source of truth for the launcher — these must be committed. | `git status`; `package.json:49-53` | ✅ direct |
| P0-3 | **`.npmrc` forces `script-shell=powershell.exe`** — breaks `pnpm install`/`pnpm dev` on macOS/Linux even though `build:mac:intel` exists. Should be Windows-conditional or moved to a Windows-only npmrc. | `.npmrc` | ✅ direct |

### P1 — High-impact design flaws
| # | Finding | Evidence | Verified |
|---|---|---|---|
| P1-1 | **Core patching (64 KB across 10 dist files) with no upstream path & no docs.** Windows fixes, shutdown hardening, cache repair, lazy injection are all living in `patches/@zenbujs__core@0.4.4.patch`. This is the single highest-risk area: every `@zenbujs/core` upgrade re-breaks it, the team is operating without framework docs on patching, and some patches are workarounds (cache repair, shutdown guards) rather than root-cause fixes. | `patches/@zenbujs__core@0.4.4.patch`; docs gap G6 | ✅ framework + docs reports |
| P1-2 | **Hand-rolled `SessionsApi` type drifts from Pi.** `pi-commands.ts:25-49` re-declares a slice of Pi's RPC/SDK surface (`clone`, `setModel`, `compact`, `exportSession`, `reload`, `getSessionInfo`, `getLastAssistantText`, `setSessionName`). At least `reload` and `setSessionName`/`getLastAssistantText` are **not** standalone Pi RPC commands — they're TUI-only or ride on `get_state`. This will silently break as Pi evolves. Should consume Pi's typed `RpcClient` or `AgentSessionRuntime`. | `plugins/pi-commands/src/main/services/pi-commands.ts:25-49`; Pi `docs/rpc.md` | ✅ Pi report |
| P1-3 | **`/share` is labeled as a Pi capability but isn't.** Pi implements gist sharing only in its TUI (`interactive-mode.ts`), not as an RPC/SDK call. Zenbu's `SessionsApi.shareSession → {gistUrl, viewerUrl}` is necessarily a host-side reimplementation but is typed as if Pi provides it. Misleads future maintainers. | `pi-commands.ts:42-45`; Pi report §5 | ✅ Pi report |
| P1-4 | **`pi:<scope>:<source>` URI scheme is an invented sub-protocol.** Zenbu's marketplace detail-pane convention is a plain `args.pluginId` string. The Pi integration encodes scope+source into a URI inside that field (`pi-package-store.ts:83-109`). Cleaner: a distinct `viewType: "pi-package-detail"` or structured `args: { kind:"pi", source, scope }`. | `plugins/plugins/src/lib/pi-package-store.ts:83-109`; plugin-authoring report | ✅ authoring report |
| P1-5 | **`AdviceSpec.view` is absent from the shipped runtime despite being in upstream docs/types.** The framework's `<View>` injection model has drifted from the docs. This directly affects the user's future goal of plugins contributing custom UI — the documented `view` advice kind doesn't exist in 0.4.4. Any custom-UI redesign must reconcile this. | framework report §5; docs report cross-source discrepancy | ✅ framework report |
| P1-6 | **`dependsOn` is type-only, but widely assumed to be runtime DI.** Both the framework and docs reports confirm `dependsOn` only affects `zen link` type resolution; runtime DI is the separate `deps: {}` field. Misunderstanding this leads to plugins that silently fail to wait for their "dependencies." The local plugins use both correctly, but it's a sharp edge. | framework report §1; docs report §2 | ✅ two reports |

### P2 — Tech debt & drift risk
| # | Finding | Evidence |
|---|---|---|
| P2-1 | **`as unknown as PluginStateWithPi` casts** in `pi-packages.ts` and `pi-package-store.ts` indicate the typed DB root wasn't regenerated (`zen link`/`zen db generate` stale). The schema additions exist natively; the casts are a workaround. | `pi-packages.ts:236,256,326,336`; `pi-package-store.ts:10,24` |
| P2-2 | **Dynamic `import("@earendil-works/pi-coding-agent")`** in `createPackageManager` (`pi-packages.ts:312`) repeats on every call. Pi's own AGENTS.md bans inline dynamic imports; here it's a lazy-init smell. Top-level import (types are already top-level) is cleaner and avoids repeated dynamic-import overhead. | `pi-packages.ts:305-322` |
| P2-3 | **`PI_CATALOG` is a hand-pinned single-entry array** (`pi-subagents` v0.28.0, hardcoded `updatedAt`). Pi has no catalog API so Zenbu must curate this, but a pinned single entry will silently rot. Needs a refresh mechanism or a real registry source. | `pi-packages.ts:23-44` |
| P2-4 | **`/trust` is not registered** even though Zenbu loads project `.pi/` resources (project-scoped packages). Users can't change a saved trust decision from the chat surface. Pi exposes `ProjectTrustStore` + `/trust`. | `pi-commands.ts:73-104`; Pi report §5 |
| P2-5 | **`plugin-detail-view.tsx` README effect thrash risk** — the README-fetch effect keys on the object identity of `installed`; combined with `syncInstalled` rewriting the DB on every list call, the effect can refetch unnecessarily. Cancel-handling is correct, but the dependency should be `installed?.source + installed?.scope`, not the object. | `plugins/plugins/src/views/plugin-detail-view.tsx` (README effect) |
| P2-6 | **`auth.ts` lazy getters throw if read before `ready()`** — `pi-commands` and `pi-packages` paths that touch auth need the same `auth.ready()` guard `sessions` got, or they'll throw on early access. | `plugins/app/src/main/services/auth.ts` |
| P2-7 | **Windows-only scripts in root `package.json`** use backslash paths; breaks on macOS/Linux dev. Pair with P0-3. | `package.json:8-14` |
| P2-8 | **Stale framework `AGENTS.md`** in `zenbu-labs/zenbu.js` documents a pre-refactor API (out-of-process iframe Views, Content Scripts) that no longer exists. Anyone reading it will be misled. | docs report cross-source discrepancy |

### P3 — Nitpicks / observations
- `normalizeSource` accepts a `file:` prefix that Pi itself doesn't special-case (harmless disambiguator).
- Several Pi slash commands hidden with `// TEMP: hidden — no GUI panel yet` (scoped-models, import, changelog, hotkeys, login, logout, resume). All are real Pi builtins — deferred, not invented. Good.
- The 23 Pi settings Zenbu exposes are **all real Pi settings**; zero invented. Setter calls go through typed methods. Clean.

---

## Part C — Fundamental Design Issues

These are the deep ones — structural problems worth solving before more feature work piles on.

### C1. Two parallel extension models, neither first-class
Zenbu has **two** ways to extend the IDE, and the Pi integration uses a third:
1. **Zenbu injections/advise** — the documented framework primitive (`inject`/`advise`, rendered via `<View>`). One primitive, 8 slot *conventions* enforced by hardcoded host consumers.
2. **Zenbu's own `app` plugin internals** — the marketplace, settings UI, sessions, composer are all in the `app` plugin and reach across each other freely.
3. **Pi's extension system** — `pi.registerTool`/`registerCommand`/`registerShortcut`/`on(...)`, the idiomatic way Pi expects hosts and packages to hook the agent loop.

**The problem:** Nothing wires Zenbu-side features *as* Pi extensions, and nothing surfaces Pi extensions *as* Zenbu UI. The `/skill:` commands, the extension UI sub-protocol (`ctx.ui.select/confirm/...`), the `before_agent_start`/`tool_call` permission gates — all unused. Zenbu and Pi run **side by side**, not integrated. This is the biggest missed opportunity and the core design gap.

### C2. The host shell slot taxonomy is implicit, not contractual
The 8 injection slots (`left-sidebar`, `right-sidebar`, `bottom-panel`, `workspace-rail`, `title-bar`, `footer.item`, `view`, `embed`) are conventions enforced by hardcoded consumers in `plugins/app/src/renderer/lib/*-views.ts`. The docs don't enumerate them authoritatively, and `AdviceSpec.view` is missing from the shipped runtime. **A plugin author cannot discover the full slot surface without reading host source.** For the user's stated goal — plugins contributing custom UI components — this is the #1 thing to fix: make slots a documented, stable contract.

### C3. The package manager for Pi packages is bolted onto the Zenbu marketplace plugin
The `plugins` plugin now owns BOTH the Zenbu plugin marketplace AND the Pi package lifecycle. They share a DB section (`root.plugins`) and a detail-pane route. But they're fundamentally different models:
- **Zenbu plugins**: framework plugins (`definePlugin`), enabled via `zenbu.plugins.jsonc`, run in-process.
- **Pi packages**: npm/git/local packages managed by Pi's `DefaultPackageManager`, discovered by Pi's resource loader, scoped user-vs-project.

Smashing them into one plugin + one detail-pane URI scheme (P1-4) is the source of several findings. They should either be separate plugins or have a clear internal boundary.

### C4. The sessions↔Pi bridge is untyped and partial
`pi-commands` declares a `SessionsApi` that pretends Pi exposes `clone`/`reload`/`setSessionName`/etc. as stable RPC. Some of those aren't Pi RPC commands. The actual sessions service (in `app`) is the real bridge, and its contract to Pi is invisible from the audited files. This is a drift timebomb (P1-2) and makes "undo and redesign" harder because the boundary isn't drawn.

### C5. Core patches as the de facto Windows port
Windows support lives almost entirely in `patches/@zenbujs__core@0.4.4.patch` rather than upstream. This means the framework itself doesn't officially support Windows — the team is maintaining a fork-via-patch. Every framework upgrade is a merge conflict. The right long-term answer is upstreaming the legitimate fixes (parcel `backend:"windows"`, `.exe` resolution, `ELECTRON_RUN_AS_NODE` stripping) and keeping only true workarounds local.

---

## Part D — Recommended Redesign Path

The user is open to undoing in-tree hacks to redesign properly. Here's the staged path, ordered so each stage is independently shippable.

### Stage 0 — Stabilize & commit the release mirror (do first, ~hours)
- Commit `patches/`, `.npmrc`, `scripts/`, `docs/`, `mcp/`, `performance-review/` to the release repo (P0-2). The launcher clones this — untracked infra is broken-by-default.
- Make `.npmrc` + Windows scripts cross-platform-safe (P0-3, P2-7).
- Fix `file-tree.ts` (P0-1): move `suppressWatcherSelfWrites` inside the class, move the call out of the property-index expression, and call it unconditionally (not just under `trace`).
- Regenerate DB types (`zen link` / `zen db generate`) to kill the `as unknown as` casts (P2-1).

### Stage 1 — Draw the Pi boundary explicitly (~1-2 days)
- Split Pi package management out of the `plugins` marketplace plugin into a dedicated `pi-packages` plugin (C3). Owns its own DB section (`root.piPackages`), its own detail-pane `viewType`, its own settings.
- Replace the `pi:<scope>:<source>` URI with a structured `args` / dedicated `viewType` (P1-4).
- Add `/trust` (P2-4).

### Stage 2 — Type the Pi bridge (~2-3 days)
- Replace the hand-rolled `SessionsApi` with either Pi's typed `RpcClient` (if RPC mode) or `AgentSessionRuntime` (if SDK mode) (P1-2).
- Relabel `/share` as host-side (P1-3); either implement it cleanly in the `app` sessions service or drop it.
- Document (in an AGENTS.md) which Pi surface Zenbu consumes and how.

### Stage 3 — Upstream the core patches (~1 week, cross-org)
- Triage `patches/@zenbujs__core@0.4.4.patch` into: (a) legitimate upstream candidates (Windows, shutdown, lazy injection), (b) local-only workarounds (cache repair). Open PRs to `zenbu-labs/zenbu.js` for (a). Shrink the patch to just (b) (C5, P1-1).
- Reconcile `AdviceSpec.view` with upstream — decide if the `<View>` injection drift is intentional and get it documented (P1-5).

### Stage 4 — Unified extension model (the real redesign, ~2-4 weeks)
- Make the host shell slot taxonomy a **documented contract**: enumerate slots in `zenbu-labs/docs`, expose a `<Slot name>` primitive, and let plugins declare new fillable slots (C2).
- Bridge Pi's extension system into Zenbu: a Pi extension that calls `pi.registerCommand` should surface as a Zenbu slash command; `ctx.ui.*` should render via Zenbu dialogs; `before_agent_start`/`tool_call` should route through Zenbu's permission UI (C1).
- This is the foundation for the user's "plugins create custom UI components" goal (Part E).

---

## Part E — Custom UI Components for Plugins (future direction)

The user's stated future goal: plugins should be able to create custom UI components for the IDE, and there should be a powerful plugin import/selection story. Here's what exists vs. what's needed.

### What exists today
- **Injections** (`inject`/`advise`): one primitive, 8 slot conventions. A plugin can fill a known host slot.
- **Settings body views** (`{ kind:"view", viewType }`): the bespoke-UI escape hatch for settings.
- **Composer advice** (`type:"around"`): Pi uses this for input advice.
- **In-React `useRegisterInjection`**: runtime injection from a component.

### What's missing for "plugins contribute arbitrary UI"
1. **Generic host `<Slot name>` primitive** — today slots are hardcoded consumer components; a generic slot would let plugins fill arbitrary named regions.
2. **Documented slot taxonomy** — the 8 kinds live in host source; they need to be a public contract (Part D Stage 4).
3. **Nested/composite slots** — a plugin-contributed view should be able to expose its own fillable slots.
4. **API for plugins to DECLARE new slots** — so a plugin can say "I add a panel that other plugins can fill."
5. **Reconcile `AdviceSpec.view`** — the documented `view` advice kind must actually exist in the runtime, or be replaced by the new `<Slot>` model.
6. **Component registry / type-safe props** — injections today are loosely typed; a registry with typed props would make custom UI components safe.

### Recommended sequencing
Stage 4 (Part D) is the prerequisite. Once slots are a contract and Pi extensions bridge in, the "plugins create custom UI" model falls out naturally as: a plugin declares a slot + a component → the host renders it → other plugins can fill it. This is the design that makes the IDE truly "hackable" (the framework's own tagline) rather than hardcoded.

---

## Appendix — What the Pi integration got RIGHT (credit where due)
- Consumes Pi's **real public API** (`SettingsManager`, `DefaultPackageManager`), not internals — cleaner than reference integrations (openclaw vendors a forked package-manager).
- Package lifecycle calls (`installAndPersist`, `removeAndPersist`, `update`, `resolve`) all match real `PackageManager` interface signatures.
- User-vs-project scope handling is faithful (correct `setPackages` vs `setProjectPackages` branching).
- All 23 Pi settings are real; zero invented. All setters go through typed methods.
- All 14 active slash commands are real Pi builtins; the 7 hidden ones are also real (deferred).
- `pi-package-settings.ts` correctly implements the disable-via-empty-filter transform per Pi docs, with tests.
- Resource attribution uses `ResolvedResource.metadata.source`/`scope` — exactly Pi's intended fields.

The Pi integration is **more correct than it is wrong**. The problems are structural (where it lives, how it's typed, what it bypasses), not a misuse of Pi.

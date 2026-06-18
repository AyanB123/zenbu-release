# Zenbu Release — Repository Context

## What this repo is
- **Zenbu** (`@zenbujs/core` 0.4.4) Electron-based IDE. Originally a macOS IDE for Pi, now being worked on with **Windows** as the primary dev/runtime.
- This is the public **source mirror** for the launcher: `zenbu-labs/zenbu-release`. Git history is "chore: sync source <sha>" commits; treat the working tree + uncommitted diff as the real state, not git log.
- `zenbu.config.ts` sets `mirror: { target: "zenbu-labs/zenbu-release", branch: "main" }`. The launcher clones this source on first run.

## Issue tracking
- **Fork:** `AyanB123/zenbu-release` (write access; upstream `zenbu-labs/zenbu-release` is read-only for this account).
- **Milestone #1:** "Stage 0 - Stabilize and Release Mirror" — 8 open issues (P0 closure + P1 backlog).
- Issues #1–#8 cover: P0 fixes (done), file-tree latent call-site bugs, hand-rolled Pi SessionsApi, dependsOn runtime DI, AdviceSpec.view enforcement, version-drift guard, docs gaps, boot-perf parallelization.
- Push `f6d39b0` upstream to `zenbu-labs/zenbu-release` once write access is granted.

## Key project structure
- `plugins/app` — main Zenbu app plugin (sessions, terminals, file-tree, repos, github, window, etc.). Bulk of the perf work lives in `plugins/app/src/main/services/`.
- `plugins/pi-commands` — Pi slash commands (`/model`, `/fork`, `/tree`, `/export`, `/share`, `/compact`, etc.) + Composer input advice + Pi settings section.
- `plugins/plugins` — plugin marketplace + **Pi Packages** integration (`@earendil-works/pi-coding-agent`). New work: `pi-packages.ts` service, `pi-package-store.ts` hooks, Pi detail/marketplace views.
- `packages/ui`, `packages/view-theme` — shared UI.
- `patches/` — `@zenbujs__core@0.4.4.patch` and `@zenbujs__hmr@0.0.2.patch`. Critical: all core fixes must be represented here (patchedDependencies in root `package.json`).

## Pi integration contract (verified against `earendil-works/pi` repo, Pi 0.78–0.79)
- Zenbu pins `@earendil-works/pi-coding-agent` `^0.78.0` (latest published 0.79.6). Public API barrel: `packages/coding-agent/src/index.ts`.
- Zenbu uses Pi's **exported public APIs only** (not internals): `SettingsManager.create(cwd, getAgentDir())` + ~31 typed get/set methods (all verified present), `new DefaultPackageManager({cwd, agentDir, settingsManager})` with `installAndPersist / removeAndPersist / update / resolve / listConfiguredPackages / getInstalledPath`, and types `PackageSource`, `ResolvedResource`. Constructor signature and methods match Pi's `PackageManager` interface in `src/core/package-manager.ts` and `examples/sdk/10-settings.ts`.
- Zenbu does NOT use `createAgentSession` / `AgentSessionRuntime` / `runRpcMode` / `RpcClient` in the audited files; Zenbu's own `sessions` service drives the agent (out of scope). `sessions.*` methods Zenbu calls (setModel, clone, compact, exportSession, shareSession, reload, getSessionInfo, getLastAssistantText, setSessionName) are Zenbu's RPC surface, not Pi's.
- **Package model**: sources `npm:`, `git:`, `https/ssh:` URLs, local paths. 4 resource types `extensions|skills|prompts|themes`. `PackageSource` = `string` (all) or `{source, extensions?, skills?, prompts?, themes?}` (`[]` disables). Scope `user` (global `~/.pi/agent/settings.json`) vs `project` (`.pi/settings.json`); project wins. Zenbu's `pi-package-settings.ts` correctly implements the disable/filter+backup transform per `docs/packages.md`.
- **Native slash commands**: `packages/coding-agent/src/core/slash-commands.ts` → `BUILTIN_SLASH_COMMANDS` (22). Zenbu registers 14 (faithful), comments out 7 ("no GUI panel yet": scoped-models, import, changelog, hotkeys, login, logout, resume), and omits `/trust` entirely.
- **`/share` is TUI-only in Pi** (gist logic in `interactive-mode.ts`/`config.ts`). NOT a Pi RPC command and NOT an exported SDK function. Zenbu's `SessionsApi.shareSession` is Zenbu's own.
- **`/settings` in Pi** opens the TUI settings screen. Zenbu redefines it as `{kind:"openSettings", tab:"plugins", sectionId:"pi"}` (host UX).
- Pi RPC commands (from `docs/rpc.md`): prompt, steer, follow_up, abort, new_session, get_state, get_messages, set_model, cycle_model, get_available_models, set_thinking_level, cycle_thinking_level, set_steering_mode, set_follow_up_mode, compact, set_auto_compaction, set_auto_retry, abort_retry, bash, abort_bash, get_session_stats, export_html, switch_session, fork, clone (+ extension UI sub-protocol). share/copy/name/session/reload/settings UIs are TUI-only → host must reimplement.
- `createAgentSession` does NOT auto-install missing project packages; `DefaultPackageManager.resolve(onMissing => "install"|"skip"|"error")` is the hook. Zenbu calls `resolve(async () => "skip")` in `syncInstalled` (intentional skip-during-listing).
- Reference integrations: `vercel/ai` `packages/harness-pi` (uses `SettingsManager.inMemory()` + `createAgentSession` — pure SDK, no package mgr UI); `openclaw/openclaw` (Pi's own recommended example) VENDORS a forked `package-manager.ts` reading `pkg.openclaw` from `~/.openclaw/agent` — it does NOT consume Pi's exported `DefaultPackageManager`. Zenbu's approach (consume the real exports) is cleaner than openclaw's.
- Style nit: Pi's `AGENTS.md` forbids inline `await import()`. Zenbu's `pi-packages.ts` uses `await import("@earendil-works/pi-coding-agent")` in `createPackageManager()`. It's Zenbu's code so not binding, but a likely lazy-init smell.

## Commands (run from repo root)
- `pnpm run typecheck` — `tsc --noEmit` (whole repo). **Currently passes.**
- `pnpm test` — `vitest run`. **3 files / 10 tests, currently passing.**
- `pnpm run dev:windows` — launch Zenbu on Windows (foreground window, restart loop).
- `pnpm run perf:startup` — `scripts/perf/startup-probe.ps1` startup probe (boot trace + logs).
- `pnpm run debug:launch` / `debug:cdp` — debug harness (CDP on 127.0.0.1:9222, logs to `.zenbu/logs/debug/`).
- `pnpm run build:mac:intel` / `build:windows` — electron-builder artifacts in `dist/electron/`.
- `pnpm install --offline` — verify patch durability after patch changes.

## Session state & history locations
- `.omx/` — OMX goal/plan tracking. Active goal: `zenbu-freeze-crash-v2` (status: `validation_failed`, last validation 2026-06-08).
- `.omx/plans/zenbu-freeze-crash-performance-stabilization-plan-20260608.md` — the stabilization plan (Phases 0–6).
- `.omx/goals/performance/zenbu-freeze-crash-v2/{state.json,ledger.jsonl}` — goal state + event ledger.
- `.omx/logs/omx-*.jsonl` — session logs.
- `.zenbu/logs/perf/startup-probe-*.log` — startup probe outputs.
- `traces/boot/*.json` — boot traces (`latest.json` is most recent). Written with `ZENBU_BOOT_TRACE=1`.
- `performance-review/zenbu-freezing-crashing-performance-analysis-v2.md` — **the canonical handoff doc**. Section 13.4 is "Known Remaining Work / Next-Agent Resume Points". Section 14 is the latest Codex resume update (2026-06-08).

## Current state (as of 2026-06-17)
- Typecheck + 10 tests green.
- Boot trace `latest.json` (2026-06-14): **plugins evaluated t+12.3s, ready t+20.5s** — big improvement over the failed-validation run (59.6s / 102.6s).
- Lots of uncommitted work in the tree (app perf fixes + Pi package feature). See `git status`.

## Worked-on and DONE
### Performance stabilization (Phases 1–4 of the plan)
- Removed main-thread blocking in hot paths: `spawnSync("gh auth status")` → async w/ timeout in `sessions.ts`; `readFileSync` loop in `recent-projects.ts` → async; child-process Promises given timeouts in `create-plugin.ts`, `context-menu.ts`.
- Empty `catch {}` and silent `.catch(()=>{})` in main services replaced with `console.warn` diagnostics (sessions, github, terminal, file-tree, apps, list-nav, playground, repos, shell-env, shortcuts, sidebar-view-shortcuts, workspace-icon).
- Chromium cache repair at startup (durable, not clear-on-every-launch). `Invalid cache` errors gone.
- `react-scan` moved to dev-only/gated; `db-replica-tracer` default-off (opt-in via `?dbTrace=1` / `localStorage.zenbuDbTrace`).
- Core patch regenerated: loader stats, MessageChannel bridge, `linkProject` opt-in (`ZENBU_LINK_ON_BOOT=1`), Windows watcher fixes, TS warning suppression, lazy component injection, process-exit shutdown flag.
- Pi package startup deferral: `piPackages.evaluate()` only seeds catalog; `syncInstalled` runs only on explicit RPC (listInstalled/install/update/remove/enable/disable) or Pi UI mount. This is Phase 3 of the plan and is **implemented**.

### Pi feature work (in progress, uncommitted)
- `plugins/plugins/src/main/services/pi-packages.ts` — full Pi package lifecycle (catalog, install, enable/disable, remove, update, read detail) backed by `@earendil-works/pi-coding-agent` `DefaultPackageManager`.
- `plugins/plugins/src/lib/pi-package-store.ts` + test — React hooks (`usePiCatalog`, `useInstalledPiPackages`, `usePiPackageActions`, `useRefreshPiPackages`) + detail-id parsing.
- `plugins/plugins/src/views/plugin-detail-view.tsx` (+406 lines) — `PiPackageDetailPane` with install/toggle/update/remove, README loading, resource breakdown.
- `plugins/plugins/src/views/marketplace-sidebar-view.tsx` (+160 lines) — Pi catalog rows in marketplace.
- `plugins/plugins/src/main/schema.ts` (+64 lines) — `piCatalog`, `piInstalled`, `piDisabledFilterBackups` DB sections + migration.
- `plugins/pi-commands` — slash commands wired; some commands hidden (`// TEMP: hidden — no GUI panel yet`) pending panels: scoped-models, import, changelog, hotkeys, login/logout, resume.

## Known remaining work (from v2 doc §13.4 + plan)
1. **Startup probe auto-quit/shutdown still times out** after `ready`. Investigate `ZENBU_AUTO_QUIT_AFTER_IDLE_MS` + setup-gate auto-quit / runtime.whenIdle() / app.quit() handlers in `node_modules/@zenbujs/core/dist/setup-gate.mjs`. (Note: later core patch added a process-exit shutdown flag that skips `viteServer.close()` during auto-quit — verify this resolves it.)
2. **Lazy plugin loading not implemented** — the biggest startup recommendation. Core patch has lazy view-injection but not lazy service/plugin evaluation. Needs per-plugin boot-trace analysis first.
3. **DB / `readRoot()` optimization** — selective reads, write batching, de-bloating. File-tree incremental collection already present.
4. **Layout/React rendering** — 3 nested Allotments still there; no memoization; layout churn not yet instrumented.
5. **React 19** left in place (downgrade is high-risk, separate migration).
6. **More empty catches + sync fs calls** exist outside the hot-path services (renderer UI, plugin installer, open-in, scripts/build). Don't blind-replace; review each.
7. **Pi feature gaps**: several `/pi` commands hidden pending GUI panels; Pi package UI detail pane is new and should be QA'd (install/enable/remove flows + tests already pass).

## Conventions
- LF→CRLF warnings from git on Windows are normal; don't "fix" them.
- When touching `@zenbujs/core`, always update `patches/@zenbujs__core@0.4.4.patch` and run `pnpm install --offline` to verify.
- Targeted perf scan after main-service edits: `rg -n "spawnSync|readFileSync|catch \{\}|new Promise\(" plugins/app/src/main/services`.

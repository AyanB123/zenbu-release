#!/usr/bin/env node
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BUN_VERSION = "1.3.12";
const BUN_TARGET = "windows-x64";
const NODE_VERSION = "22.19.0";
const NODE_TARGET = "win-x64";

if (process.platform !== "win32" || process.arch !== "x64") {
  console.error(
    "build:windows must run on a Windows x64 host. " +
      `Current host is ${process.platform}/${process.arch}.`,
  );
  process.exit(1);
}

const projectDir = process.cwd();
const require = createRequire(import.meta.url);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function expandMirrorUrl(target) {
  if (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("git@")
  ) {
    return target;
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(target)) return `https://github.com/${target}.git`;
  return target;
}

function currentSourceSha(dir) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
  } catch {
    return "uncommitted";
  }
}

function resolveCoreDist() {
  const pkgPath = require.resolve("@zenbujs/core/package.json");
  return path.join(path.dirname(pkgPath), "dist");
}

function resolveCoreDistFile(fileName) {
  const candidate = path.join(resolveCoreDist(), fileName);
  if (fs.existsSync(candidate)) return candidate;
  throw new Error(
    `Cannot locate @zenbujs/core/dist/${fileName}. Run pnpm install first.`,
  );
}

function resolveCoreDistGlob(prefix, suffix) {
  const dist = resolveCoreDist();
  const match = fs
    .readdirSync(dist)
    .find((name) => name.startsWith(prefix) && name.endsWith(suffix));
  if (!match) throw new Error(`Cannot locate @zenbujs/core/dist/${prefix}*${suffix}.`);
  return path.join(dist, match);
}

function resolveElectronBuilder() {
  const candidates = [
    path.join(projectDir, "node_modules", "electron-builder", "out", "cli", "cli.js"),
    path.join(projectDir, "node_modules", ".bin", "electron-builder.cmd"),
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  throw new Error("electron-builder is missing. Run pnpm install first.");
}

function findElectronBuilderConfig() {
  const configPath = path.join(projectDir, "electron-builder.json");
  if (fs.existsSync(configPath)) return readJson(configPath);
  const pkg = readJson(path.join(projectDir, "package.json"));
  if (pkg.build) return { ...pkg.build };
  throw new Error("No electron-builder.json or package.json#build config found.");
}

async function download(url, dest) {
  await new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          download(new URL(res.headers.location, url).href, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} -> ${res.statusCode}`));
          res.resume();
          return;
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(resolve));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

async function fetchText(url) {
  const tmp = path.join(os.tmpdir(), `zenbu-fetch-${crypto.randomUUID()}`);
  await download(url, tmp);
  try {
    return await fsp.readFile(tmp, "utf8");
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function verifySha256(filePath, expected) {
  const actual = await sha256(filePath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`sha256 mismatch for ${path.basename(filePath)}: expected ${expected}, got ${actual}`);
  }
}

async function verifyIntegrity(filePath, integrity) {
  const [algo, b64] = integrity.split("-", 2);
  if (algo !== "sha512" || !b64) throw new Error(`unsupported integrity ${integrity}`);
  const hash = crypto.createHash("sha512");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const actual = hash.digest("base64");
  if (actual !== b64) throw new Error(`integrity mismatch for ${path.basename(filePath)}`);
}

function parseShasumsFile(contents, target) {
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [hash, name] = trimmed.split(/\s+/, 2);
    if (name === target || name === `./${target}` || name === `*${target}`) return hash;
  }
  return null;
}

async function spawnAsync(cmd, args, cwd, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function extractArchive(archivePath, dest) {
  await fsp.mkdir(dest, { recursive: true });
  await spawnAsync("tar", ["-xf", archivePath, "-C", dest], projectDir);
}

async function findFile(dir, fileName) {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(full, fileName);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return full;
    }
  }
  return null;
}

async function fetchRegistryDist(pkg, version) {
  const text = await fetchText(`https://registry.npmjs.org/${pkg}/${version}`);
  const meta = JSON.parse(text);
  if (!meta.dist?.tarball) throw new Error(`registry response for ${pkg}@${version} has no dist.tarball`);
  return meta.dist;
}

async function ensureNpmRegistryPackageCached(pkg, version, cacheRoot) {
  const dir = path.join(cacheRoot, `${pkg}-${version}`);
  const ready = path.join(dir, ".ready");
  const pkgRoot = path.join(dir, "package");
  if (fs.existsSync(ready) && fs.existsSync(pkgRoot)) return pkgRoot;

  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  const dist = await fetchRegistryDist(pkg, version);
  const tarball = path.join(dir, "tarball.tgz");
  console.log(`  -> downloading ${pkg}@${version}`);
  await download(dist.tarball, tarball);
  if (dist.integrity) await verifyIntegrity(tarball, dist.integrity);
  await spawnAsync("tar", ["-xzf", tarball, "-C", dir], projectDir);
  await fsp.rm(tarball, { force: true });
  if (!fs.existsSync(pkgRoot)) throw new Error(`extracted ${pkg}@${version} but package/ is missing`);
  await fsp.writeFile(ready, "");
  return pkgRoot;
}

async function ensureBunCached(cacheRoot) {
  const dir = path.join(cacheRoot, `bun-${BUN_VERSION}-${BUN_TARGET}`);
  const cached = path.join(dir, "bun.exe");
  if (fs.existsSync(cached)) return cached;

  await fsp.mkdir(dir, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "zenbu-bun-win-"));
  try {
    const asset = `bun-${BUN_TARGET}.zip`;
    const releaseTag = `bun-v${BUN_VERSION}`;
    const zipPath = path.join(tmp, asset);
    const url = `https://github.com/oven-sh/bun/releases/download/${releaseTag}/${asset}`;
    console.log(`  -> downloading Bun ${BUN_VERSION} (${BUN_TARGET})`);
    await download(url, zipPath);
    const sumsUrl = `https://github.com/oven-sh/bun/releases/download/${releaseTag}/SHASUMS256.txt`;
    const expected = parseShasumsFile(await fetchText(sumsUrl), asset);
    if (!expected) throw new Error(`Could not locate sha256 for ${asset}`);
    await verifySha256(zipPath, expected);
    await extractArchive(zipPath, tmp);
    const extracted = await findFile(tmp, "bun.exe");
    if (!extracted) throw new Error(`Could not find bun.exe in ${asset}`);
    await fsp.copyFile(extracted, cached);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
  return cached;
}

async function ensureNodeCached(cacheRoot) {
  const dir = path.join(cacheRoot, `node-${NODE_VERSION}-${NODE_TARGET}`);
  const cached = path.join(dir, "node.exe");
  if (fs.existsSync(cached)) return cached;

  await fsp.mkdir(dir, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "zenbu-node-win-"));
  try {
    const asset = `node-v${NODE_VERSION}-${NODE_TARGET}.zip`;
    const zipPath = path.join(tmp, asset);
    const baseUrl = `https://nodejs.org/dist/v${NODE_VERSION}`;
    console.log(`  -> downloading Node.js ${NODE_VERSION} (${NODE_TARGET})`);
    await download(`${baseUrl}/${asset}`, zipPath);
    const expected = parseShasumsFile(await fetchText(`${baseUrl}/SHASUMS256.txt`), asset);
    if (!expected) throw new Error(`Could not locate sha256 for ${asset}`);
    await verifySha256(zipPath, expected);
    await extractArchive(zipPath, tmp);
    const extracted = await findFile(tmp, "node.exe");
    if (!extracted) throw new Error(`Could not find node.exe in ${asset}`);
    await fsp.copyFile(extracted, cached);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
  return cached;
}

async function copyDir(src, dest) {
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else if (entry.isSymbolicLink()) await fsp.symlink(await fsp.readlink(from), to);
    else await fsp.copyFile(from, to);
  }
}

async function provisionWindowsToolchain(stagingDir, packageManager) {
  await fsp.mkdir(stagingDir, { recursive: true });
  const cacheRoot = path.join(os.homedir(), ".zenbu", "cache", "toolchain");
  const bun = await ensureBunCached(cacheRoot);
  const node = await ensureNodeCached(cacheRoot);
  await fsp.copyFile(bun, path.join(stagingDir, "bun.exe"));
  await fsp.copyFile(node, path.join(stagingDir, "node.exe"));

  switch (packageManager.type) {
    case "pnpm":
      await copyDir(
        await ensureNpmRegistryPackageCached("pnpm", packageManager.version, cacheRoot),
        path.join(stagingDir, "pnpm"),
      );
      break;
    default:
      throw new Error(`build:windows currently supports packageManager.type=pnpm, got ${packageManager.type}`);
  }
}

function patchRuntimeToolLookup(contents) {
  const from =
    'function bundledToolPath(name, resourcesPath) {\n\tconst candidates = [path.join(resourcesPath, "toolchain", "bin", name), path.join(resourcesPath, "toolchain", name)];\n\tfor (const candidate of candidates) if (existsSync(candidate)) return candidate;\n\treturn null;\n}';
  const to =
    'function bundledToolPath(name, resourcesPath) {\n\tconst names = process.platform === "win32" ? [`${name}.exe`, name] : [name];\n\tconst candidates = names.flatMap((candidateName) => [path.join(resourcesPath, "toolchain", "bin", candidateName), path.join(resourcesPath, "toolchain", candidateName)]);\n\tfor (const candidate of candidates) if (existsSync(candidate)) return candidate;\n\treturn null;\n}';
  if (!contents.includes(to)) {
    if (!contents.includes(from)) throw new Error("Could not patch launcher bundledToolPath lookup.");
    contents = contents.replace(from, to);
  }
  return patchWindowsFileUrlHandoff(
    patchInstallEnvUserConfig(patchJsPackageManagerRuntime(contents)),
  );
}

function patchWindowsFileUrlHandoff(contents) {
  const importFrom = 'import path from "node:path";\n';
  const importTo = 'import path from "node:path";\nimport { pathToFileURL } from "node:url";\n';
  if (!contents.includes(importTo)) {
    if (!contents.includes(importFrom)) throw new Error("Could not patch launcher pathToFileURL import.");
    contents = contents.replace(importFrom, importTo);
  }

  const handoffFrom = "\tawait import(entry);";
  const handoffTo = "\tawait import(pathToFileURL(entry).href);";
  if (!contents.includes(handoffTo)) {
    if (!contents.includes(handoffFrom)) throw new Error("Could not patch launcher Windows file URL handoff.");
    contents = contents.replace(handoffFrom, handoffTo);
  }

  const loadFrom = "\tview.webContents.loadFile(htmlPath).catch((err) => {";
  const loadTo =
    '\tconst installingHtml = fs.readFileSync(htmlPath, "utf8");\n\tconst installingHtmlUrl = `data:text/html;charset=utf-8,${encodeURIComponent(installingHtml)}`;\n\tview.webContents.loadURL(installingHtmlUrl, { baseURLForDataURL: pathToFileURL(RESOURCES_PATH + path.sep).href }).catch((err) => {';
  if (!contents.includes(loadTo)) {
    if (!contents.includes(loadFrom)) throw new Error("Could not patch launcher installing HTML file URL load.");
    contents = contents.replace(loadFrom, loadTo);
  }
  return contents;
}

function patchInstallEnvUserConfig(contents) {
  const from =
    'const PATH = segments.filter((s) => s && !seen.has(s) && seen.add(s)).join(sep);\n\treturn {\n\t\t...process.env,\n\t\tPATH,';
  const to =
    'const PATH = segments.filter((s) => s && !seen.has(s) && seen.add(s)).join(sep);\n\tconst isolatedNpmUserConfig = process.platform === "win32" ? path.join(appsDir, ".zenbu", ".npmrc") : null;\n\treturn {\n\t\t...process.env,\n\t\tPATH,\n\t\t...(isolatedNpmUserConfig ? {\n\t\t\tnpm_config_userconfig: isolatedNpmUserConfig,\n\t\t\tNPM_CONFIG_USERCONFIG: isolatedNpmUserConfig\n\t\t} : {}),';
  if (contents.includes(to)) return contents;
  if (!contents.includes(from)) throw new Error("Could not patch launcher install npm userconfig.");
  return contents.replace(from, to);
}

function patchJsPackageManagerRuntime(contents) {
  const replacements = [
    {
      from:
        'const bun = bundledToolPath("bun", resourcesPath);\n\t\t\tif (!bun) throw new Error(`bundled bun not found in ${resourcesPath}/toolchain (required to host the pnpm.cjs entry)`);\n\t\t\tawait spawnInstall({\n\t\t\t\tbin: bun,',
      to:
        'const jsRuntime = bundledToolPath("node", resourcesPath) ?? bundledToolPath("bun", resourcesPath);\n\t\t\tif (!jsRuntime) throw new Error(`bundled node/bun not found in ${resourcesPath}/toolchain (required to host the pnpm.cjs entry)`);\n\t\t\tawait spawnInstall({\n\t\t\t\tbin: jsRuntime,',
    },
    {
      from:
        'const bun = bundledToolPath("bun", resourcesPath);\n\t\t\tif (!bun) throw new Error(`bundled bun not found in ${resourcesPath}/toolchain (required to host the npm-cli.js entry)`);\n\t\t\tawait spawnInstall({\n\t\t\t\tbin: bun,',
      to:
        'const jsRuntime = bundledToolPath("node", resourcesPath) ?? bundledToolPath("bun", resourcesPath);\n\t\t\tif (!jsRuntime) throw new Error(`bundled node/bun not found in ${resourcesPath}/toolchain (required to host the npm-cli.js entry)`);\n\t\t\tawait spawnInstall({\n\t\t\t\tbin: jsRuntime,',
    },
    {
      from:
        'const bun = bundledToolPath("bun", resourcesPath);\n\t\t\tif (!bun) throw new Error(`bundled bun not found in ${resourcesPath}/toolchain (required to host the yarn.js entry)`);\n\t\t\tif (isYarnBerry(pm.version)) await spawnInstall({\n\t\t\t\tbin: bun,',
      to:
        'const jsRuntime = bundledToolPath("node", resourcesPath) ?? bundledToolPath("bun", resourcesPath);\n\t\t\tif (!jsRuntime) throw new Error(`bundled node/bun not found in ${resourcesPath}/toolchain (required to host the yarn.js entry)`);\n\t\t\tif (isYarnBerry(pm.version)) await spawnInstall({\n\t\t\t\tbin: jsRuntime,',
    },
    {
      from: '\t\t\t\t\tbin: bun,',
      to: '\t\t\t\t\tbin: jsRuntime,',
    },
  ];
  for (const { from, to } of replacements) {
    if (contents.includes(to)) continue;
    if (!contents.includes(from)) throw new Error("Could not patch launcher JS package-manager runtime.");
    contents = contents.replace(from, to);
  }
  return contents;
}

async function copyPatchedLauncher(dest) {
  const src = resolveCoreDistFile("launcher.mjs");
  const patched = patchRuntimeToolLookup(await fsp.readFile(src, "utf8"));
  await fsp.writeFile(dest, patched);
}

async function copyFile(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

async function stageHtmlArtifacts(args) {
  let installing = false;
  let updating = false;
  let icon = false;
  if (args.installingSrc) {
    await copyFile(args.installingSrc, args.installingHtmlOut);
    installing = true;
  }
  if (args.updatingSrc) {
    await copyFile(args.updatingSrc, args.updatingHtmlOut);
    updating = true;
  }
  if (installing || updating) {
    await copyFile(resolveCoreDistFile("installing-preload.cjs"), args.installingPreloadOut);
    const iconSrc = path.join(args.entrypointDir, "icon.png");
    if (fs.existsSync(iconSrc)) {
      await copyFile(iconSrc, args.iconOut);
      icon = true;
    }
  }
  return { installing, updating, icon };
}

function mergeElectronBuilderConfig(userConfig, overlay) {
  const merged = { ...userConfig };
  merged.directories = {
    ...(userConfig.directories ?? {}),
    app: overlay.appDir,
    output: overlay.output,
  };
  merged.files = overlay.bundleFiles;
  merged.extraResources = [
    ...(Array.isArray(userConfig.extraResources) ? userConfig.extraResources : []),
    ...overlay.extraResources,
  ];
  if (userConfig.npmRebuild !== false) merged.npmRebuild = false;
  if (userConfig.asar === undefined) merged.asar = false;
  return merged;
}

async function loadZenbuConfig() {
  const loadConfigPath = resolveCoreDistGlob("load-config-", ".mjs");
  const mod = await import(pathToFileURL(loadConfigPath).href);
  const loadConfig = mod.loadConfig ?? mod.n;
  if (typeof loadConfig !== "function") {
    throw new Error(`Cannot find loadConfig export in ${loadConfigPath}`);
  }
  return loadConfig(projectDir, { skipLocalManifests: true });
}

async function main() {
  const passthrough = process.argv.slice(2);
  const { resolved } = await loadZenbuConfig();
  const buildConfig = resolved.build;
  const mirrorTarget = buildConfig.mirror?.target;
  if (!mirrorTarget) throw new Error("zenbu.config.ts build.mirror.target is required.");

  const pkg = readJson(path.join(projectDir, "package.json"));
  const appName = pkg.name ?? path.basename(projectDir);
  const appVersion = String(pkg.version ?? "").trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(appVersion)) {
    throw new Error(`package.json version must be semver-like, got ${pkg.version}`);
  }

  const bundleDir = await fsp.mkdtemp(path.join(os.tmpdir(), `zenbu-electron-${appName}-win-`));
  const toolchainDir = path.join(bundleDir, "toolchain");
  const launcherOut = path.join(bundleDir, "launcher.mjs");
  const bundlePkgOut = path.join(bundleDir, "package.json");
  const appConfigOut = path.join(bundleDir, "app-config.json");
  const hostJsonOut = path.join(bundleDir, "host.json");
  const mergedConfigPath = path.join(bundleDir, "electron-builder.merged.json");
  const installingHtmlOut = path.join(bundleDir, "installing.html");
  const updatingHtmlOut = path.join(bundleDir, "updating.html");
  const installingPreloadOut = path.join(bundleDir, "installing-preload.cjs");
  const iconOut = path.join(bundleDir, "icon.png");
  const pmLabel = `${buildConfig.packageManager.type}@${buildConfig.packageManager.version}`;
  const sourceSha = currentSourceSha(projectDir);

  console.log("\n  zen build:windows");
  console.log(`    name:    ${appName}`);
  console.log(`    version: ${appVersion}`);
  console.log(`    source:  ${sourceSha === "uncommitted" ? sourceSha : sourceSha.slice(0, 7)}`);
  console.log(`    mirror:  ${mirrorTarget} (${buildConfig.mirror?.branch ?? "main"})`);
  console.log(`    pm:      ${pmLabel}`);
  console.log(`    bundle:  ${bundleDir}`);

  console.log("  -> staging patched launcher.mjs");
  await copyPatchedLauncher(launcherOut);

  const staged =
    resolved.installingPath || resolved.updatingPath
      ? await stageHtmlArtifacts({
          entrypointDir: resolved.uiEntrypointPath,
          installingSrc: resolved.installingPath ?? null,
          updatingSrc: resolved.updatingPath ?? null,
          installingHtmlOut,
          updatingHtmlOut,
          installingPreloadOut,
          iconOut,
        })
      : { installing: false, updating: false, icon: false };

  console.log("  -> provisioning Windows bundled toolchain");
  await provisionWindowsToolchain(toolchainDir, buildConfig.packageManager);

  console.log("  -> writing bundle metadata");
  await fsp.writeFile(
    bundlePkgOut,
    JSON.stringify(
      {
        name: appName,
        version: appVersion,
        main: "launcher.mjs",
        type: "module",
        repository: { type: "git", url: expandMirrorUrl(mirrorTarget) },
      },
      null,
      2,
    ) + "\n",
  );
  await fsp.writeFile(
    appConfigOut,
    JSON.stringify(
      {
        name: appName,
        mirrorUrl: expandMirrorUrl(mirrorTarget),
        branch: buildConfig.mirror?.branch ?? "main",
        version: appVersion,
        packageManager: buildConfig.packageManager,
        ...(staged.installing
          ? { installingHtml: "installing.html", installingPreload: "installing-preload.cjs" }
          : {}),
      },
      null,
      2,
    ) + "\n",
  );
  await fsp.writeFile(hostJsonOut, JSON.stringify({ version: appVersion }, null, 2) + "\n");

  const userConfig = findElectronBuilderConfig();
  const userOutput = userConfig.directories?.output ?? "dist";
  const resolvedOutput = path.isAbsolute(userOutput) ? userOutput : path.resolve(projectDir, userOutput);
  const extraResources = [{ from: toolchainDir, to: "toolchain" }];
  if (staged.installing) extraResources.push({ from: installingHtmlOut, to: "installing.html" });
  if (staged.updating) extraResources.push({ from: updatingHtmlOut, to: "updating.html" });
  if (staged.installing || staged.updating) {
    extraResources.push({ from: installingPreloadOut, to: "installing-preload.cjs" });
  }
  if (staged.icon) extraResources.push({ from: iconOut, to: "icon.png" });

  const merged = mergeElectronBuilderConfig(userConfig, {
    appDir: bundleDir,
    output: resolvedOutput,
    bundleFiles: ["package.json", "app-config.json", "host.json", "launcher.mjs", "!node_modules"],
    extraResources,
  });
  await fsp.writeFile(mergedConfigPath, JSON.stringify(merged, null, 2) + "\n");

  console.log("  -> invoking electron-builder");
  const electronBuilder = resolveElectronBuilder();
  const cliArgs = ["--config", mergedConfigPath, "--win", "--x64", ...passthrough];
  const env = { ...process.env };
  if (electronBuilder.endsWith(".js")) {
    await spawnAsync(process.execPath, [electronBuilder, ...cliArgs], projectDir, env);
  } else {
    await spawnAsync(electronBuilder, cliArgs, projectDir, env);
  }
  console.log(`\n  Built ${appName} ${appVersion} at ${path.relative(projectDir, resolvedOutput) || resolvedOutput}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

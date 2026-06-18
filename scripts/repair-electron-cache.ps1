[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$AppDataPath = "",
  [switch]$CloseRunningZenbu
)

$ErrorActionPreference = "Stop"

if (-not $AppDataPath) {
  if (-not $env:APPDATA) {
    throw "APPDATA is not set. Pass -AppDataPath explicitly."
  }
  $AppDataPath = Join-Path $env:APPDATA "zenbu"
}

if ($CloseRunningZenbu) {
  Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -eq "zenbu" -or $_.MainWindowTitle -eq "Error" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
}

if (-not (Test-Path -LiteralPath $AppDataPath)) {
  Write-Host "Zenbu app data directory does not exist: $AppDataPath"
  return
}

$resolvedAppDataPath = (Resolve-Path -LiteralPath $AppDataPath).Path
$cacheDirectoryNames = @(
  "Cache",
  "Code Cache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUCache",
  "GrShaderCache",
  "ShaderCache"
)

$removed = 0
foreach ($name in $cacheDirectoryNames) {
  $target = Join-Path $resolvedAppDataPath $name
  if (-not (Test-Path -LiteralPath $target)) { continue }
  $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
  if (-not $resolvedTarget.StartsWith($resolvedAppDataPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside Zenbu app data: $resolvedTarget"
  }
  if ($PSCmdlet.ShouldProcess($resolvedTarget, "Remove disposable Chromium cache directory")) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
    $removed += 1
  }
}

Write-Host "Removed $removed disposable Chromium cache director$(if ($removed -eq 1) { 'y' } else { 'ies' }) from $resolvedAppDataPath"
Write-Host "Preserved Local Storage, IndexedDB, Session Storage, cookies, and Zenbu DB data."

[CmdletBinding()]
param(
  [switch]$Restart,
  [string]$ProjectPath = "",
  [int]$CdpPort = 9222,
  [switch]$EnableHmr,
  [switch]$TracePluginImports,
  [switch]$NoBootTrace,
  [int]$AutoQuitAfterIdleMs = -1
)

$ErrorActionPreference = "Stop"

function Remove-ProcessEnvironmentFlag {
  param([string]$Name)

  if (Test-Path "Env:$Name") {
    Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
  }
}

function ConvertTo-WindowsCommandLineArgument {
  param([string]$Value)

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  $backslash = [char]92
  $doubleQuote = [char]34
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append($doubleQuote)
  $backslashes = 0

  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq $backslash) {
      $backslashes += 1
      continue
    }

    if ($character -eq $doubleQuote) {
      [void]$builder.Append('\' * (($backslashes * 2) + 1))
      [void]$builder.Append($doubleQuote)
      $backslashes = 0
      continue
    }

    if ($backslashes -gt 0) {
      [void]$builder.Append('\' * $backslashes)
      $backslashes = 0
    }

    [void]$builder.Append($character)
  }

  if ($backslashes -gt 0) {
    [void]$builder.Append('\' * ($backslashes * 2))
  }

  [void]$builder.Append($doubleQuote)
  return $builder.ToString()
}

function Get-ZenbuElectronProcessIds {
  param([string]$ResolvedProjectPath)

  $items = Get-CimInstance Win32_Process -Filter "name = 'electron.exe'" -ErrorAction SilentlyContinue
  foreach ($item in $items) {
    $commandLine = if ($item.CommandLine) { $item.CommandLine } else { "" }
    $executablePath = if ($item.ExecutablePath) { $item.ExecutablePath } else { "" }
    $matchesProject =
      $commandLine.IndexOf($ResolvedProjectPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $executablePath.StartsWith($ResolvedProjectPath, [System.StringComparison]::OrdinalIgnoreCase)

    if ($matchesProject) { [int]$item.ProcessId }
  }

  Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -eq "zenbu" -or $_.MainWindowTitle -eq "Error" } |
    ForEach-Object { [int]$_.Id }
}

function Stop-ZenbuProjectProcesses {
  param([string]$ResolvedProjectPath)

  $deadline = (Get-Date).AddSeconds(8)
  do {
    $ids = @(Get-ZenbuElectronProcessIds -ResolvedProjectPath $ResolvedProjectPath | Select-Object -Unique)
    if ($ids.Count -eq 0) { return }
    foreach ($id in $ids) {
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
}

$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ProjectPath) {
  $ProjectPath = Join-Path $scriptRoot ".."
}

$resolvedProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$logDir = Join-Path $resolvedProjectPath ".zenbu\logs\debug"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if ($Restart) {
  Stop-ZenbuProjectProcesses -ResolvedProjectPath $resolvedProjectPath
  Start-Sleep -Milliseconds 500
}

Remove-ProcessEnvironmentFlag "ELECTRON_RUN_AS_NODE"
Remove-ProcessEnvironmentFlag "NODE_OPTIONS"
Remove-ProcessEnvironmentFlag "ZENBU_AUTO_QUIT_AFTER_IDLE_MS"
Remove-ProcessEnvironmentFlag "ZENBU_SKIP_CACHE_REPAIR"

$env:ELECTRON_ENABLE_LOGGING = "1"
$env:ZENBU_CDP_PORT = [string]$CdpPort
if ($NoBootTrace) {
  Remove-ProcessEnvironmentFlag "ZENBU_BOOT_TRACE"
} else {
  $env:ZENBU_BOOT_TRACE = "1"
}
if ($EnableHmr) {
  Remove-ProcessEnvironmentFlag "ZENBU_DISABLE_DYNOHOT"
} else {
  $env:ZENBU_DISABLE_DYNOHOT = "1"
}
if ($TracePluginImports) {
  $env:ZENBU_TRACE_PLUGIN_IMPORTS = "1"
} else {
  Remove-ProcessEnvironmentFlag "ZENBU_TRACE_PLUGIN_IMPORTS"
}
if ($AutoQuitAfterIdleMs -ge 0) {
  $env:ZENBU_AUTO_QUIT_AFTER_IDLE_MS = [string]$AutoQuitAfterIdleMs
}

$electronPath = & node -e "process.stdout.write(require('electron'))"
if (-not $electronPath) {
  throw "Unable to resolve Electron. Run npm install first."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutPath = Join-Path $logDir "zenbu-debug-$stamp.stdout.log"
$stderrPath = Join-Path $logDir "zenbu-debug-$stamp.stderr.log"
Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

$argumentList = @(
  (ConvertTo-WindowsCommandLineArgument $resolvedProjectPath),
  (ConvertTo-WindowsCommandLineArgument "--project=$resolvedProjectPath"),
  (ConvertTo-WindowsCommandLineArgument "--remote-debugging-port=$CdpPort")
) -join " "

$process = Start-Process `
  -FilePath $electronPath `
  -ArgumentList $argumentList `
  -WorkingDirectory $resolvedProjectPath `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

[pscustomobject]@{
  pid = $process.Id
  projectPath = $resolvedProjectPath
  cdpPort = $CdpPort
  stdout = $stdoutPath
  stderr = $stderrPath
  bootTrace = -not $NoBootTrace
  hmrEnabled = [bool]$EnableHmr
  tracePluginImports = [bool]$TracePluginImports
} | ConvertTo-Json -Compress

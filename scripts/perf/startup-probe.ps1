[CmdletBinding()]
param(
  [ValidateRange(1, 20)]
  [int]$Runs = 3,
  [int]$TimeoutSec = 90,
  [int]$AutoQuitAfterIdleMs = 2500,
  [string]$ProjectPath = "",
  [switch]$EnableHmr,
  [switch]$TracePluginImports
)

$ErrorActionPreference = "Stop"

function Get-Median {
  param([int[]]$Values)

  if (-not $Values -or $Values.Count -eq 0) { return $null }
  $sorted = @($Values | Sort-Object)
  $middle = [int][Math]::Floor($sorted.Count / 2)
  if ($sorted.Count % 2 -eq 1) { return $sorted[$middle] }
  return [int][Math]::Round(($sorted[$middle - 1] + $sorted[$middle]) / 2)
}

function Read-TaskResult {
  param($Task)
  return $Task.GetAwaiter().GetResult()
}

function ConvertTo-ProcessArgument {
  param([string]$Value)

  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '\\', '\\' -replace '"', '\"') + '"'
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
  $ProjectPath = Join-Path $scriptRoot "..\.."
}

$resolvedProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$logDir = Join-Path $resolvedProjectPath ".zenbu\logs\perf"
$traceDir = Join-Path $resolvedProjectPath "traces\boot"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$electronPath = & node -e "process.stdout.write(require('electron'))"
if (-not $electronPath) {
  throw "Unable to resolve Electron. Run npm install first."
}

$knownErrorPatterns = @(
  "EPIPE",
  "Invalid cache",
  "watchman",
  "ExperimentalWarning: stripTypeScriptTypes",
  "DbLockedError",
  "Unable to move the cache",
  "Unable to create cache",
  "Gpu Cache Creation failed"
)

$results = [System.Collections.Generic.List[object]]::new()

for ($i = 1; $i -le $Runs; $i++) {
  Stop-ZenbuProjectProcesses -ResolvedProjectPath $resolvedProjectPath

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $runName = "startup-probe-$stamp-run$i"
  $logPath = Join-Path $logDir "$runName.log"
  $tracePath = Join-Path $logDir "$runName.boot.json"
  $latestTrace = Join-Path $traceDir "latest.json"

  Remove-Item -LiteralPath $latestTrace -Force -ErrorAction SilentlyContinue

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $electronPath
  $psi.WorkingDirectory = $resolvedProjectPath
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $processArgs = @()
  $processArgs += ConvertTo-ProcessArgument $resolvedProjectPath
  $processArgs += ConvertTo-ProcessArgument "--project=$resolvedProjectPath"
  $psi.Arguments = $processArgs -join " "

  [void]$psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE")
  [void]$psi.EnvironmentVariables.Remove("NODE_OPTIONS")
  $psi.EnvironmentVariables["ZENBU_BOOT_TRACE"] = "1"
  $psi.EnvironmentVariables["ZENBU_AUTO_QUIT_AFTER_IDLE_MS"] = [string]$AutoQuitAfterIdleMs
  $psi.EnvironmentVariables["ELECTRON_ENABLE_LOGGING"] = "1"
  if (-not $EnableHmr) { $psi.EnvironmentVariables["ZENBU_DISABLE_DYNOHOT"] = "1" }
  if ($TracePluginImports) { $psi.EnvironmentVariables["ZENBU_TRACE_PLUGIN_IMPORTS"] = "1" }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi
  $timedOut = $false

  Write-Host "[$i/$Runs] launching Zenbu startup probe..."
  [void]$process.Start()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()

  if (-not $process.WaitForExit($TimeoutSec * 1000)) {
    $timedOut = $true
    try {
      $process.Kill($true)
    } catch {
      try { $process.Kill() } catch {}
    }
    $process.WaitForExit()
  }

  $stdout = Read-TaskResult $stdoutTask
  $stderr = Read-TaskResult $stderrTask
  $content = $stdout
  if ($stderr.Trim().Length -gt 0) {
    $content = "$content`n--- STDERR ---`n$stderr"
  }
  [System.IO.File]::WriteAllText(
    $logPath,
    $content,
    [System.Text.UTF8Encoding]::new($false)
  )

  if (Test-Path -LiteralPath $latestTrace) {
    Copy-Item -LiteralPath $latestTrace -Destination $tracePath -Force
  }

  $marks = @{}
  foreach ($match in [regex]::Matches($content, '^\[zenbu\]\s+(?<name>.+?)\s+\(\+(?<ms>\d+)ms\)', [System.Text.RegularExpressions.RegexOptions]::Multiline)) {
    $marks[$match.Groups["name"].Value] = [int]$match.Groups["ms"].Value
  }

  $knownErrors = @()
  foreach ($pattern in $knownErrorPatterns) {
    if ($content -match [regex]::Escape($pattern)) {
      $knownErrors += $pattern
    }
  }

  $result = [pscustomobject]@{
    Run = $i
    ExitCode = $process.ExitCode
    TimedOut = $timedOut
    ReadyMs = $marks["ready"]
    PluginsEvaluatedMs = $marks["plugins evaluated"]
    RuntimeLog = $logPath
    BootTrace = if (Test-Path -LiteralPath $tracePath) { $tracePath } else { $null }
    KnownErrors = $knownErrors
  }
  $results.Add($result)

  Stop-ZenbuProjectProcesses -ResolvedProjectPath $resolvedProjectPath
  Start-Sleep -Milliseconds 500
}

$readyValues = @($results | Where-Object { $_.ReadyMs -ne $null } | ForEach-Object { [int]$_.ReadyMs })
$pluginValues = @($results | Where-Object { $_.PluginsEvaluatedMs -ne $null } | ForEach-Object { [int]$_.PluginsEvaluatedMs })

Write-Host ""
Write-Host "Zenbu startup probe summary"
$results |
  Select-Object Run, ExitCode, TimedOut, ReadyMs, PluginsEvaluatedMs, RuntimeLog, BootTrace, @{Name="KnownErrors"; Expression={ $_.KnownErrors -join "," }} |
  Format-Table -AutoSize

Write-Host "ready median ms: $(Get-Median $readyValues)"
Write-Host "plugins evaluated median ms: $(Get-Median $pluginValues)"

$failed = @($results | Where-Object {
  $_.TimedOut -or
  $_.ExitCode -ne 0 -or
  $_.ReadyMs -eq $null -or
  $_.KnownErrors.Count -gt 0
})

if ($failed.Count -gt 0) {
  throw "Zenbu startup probe failed for $($failed.Count) run(s). See $logDir."
}

Write-Host "Zenbu startup probe passed. Logs: $logDir"

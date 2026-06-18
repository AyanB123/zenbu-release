[CmdletBinding()]
param(
  [ValidateSet("serve", "serve-http", "validate")]
  [string]$Mode = "serve",
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $scriptRoot "..\..")).Path
$configPath = Join-Path $repoRoot "mcp\zenbu-debug.mcpify.json"

$env:PYTHONIOENCODING = "utf-8"

$args = @("-m", "mcpify")
switch ($Mode) {
  "serve" {
    $args += @("serve", $configPath)
  }
  "serve-http" {
    $args += @("serve", $configPath, "--mode", "streamable-http", "--port", [string]$Port)
  }
  "validate" {
    $args += @("validate", $configPath, "--verbose")
  }
}

& python @args
exit $LASTEXITCODE

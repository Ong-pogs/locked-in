[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Live,
  [switch]$FullBackend,
  [switch]$RequireRust,
  [switch]$SkipRust,
  [string]$BackendEnv,
  [string]$FrontendEnv
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WebRoot = Join-Path $RepoRoot 'web-app'
$BackendRoot = Join-Path $RepoRoot 'backend'
$MainnetConfigPath = Join-Path (Join-Path $RepoRoot 'config') 'mainnet-production.json'
$NpmCommand = if ([System.Environment]::OSVersion.Platform -eq 'Win32NT') { 'npm.cmd' } else { 'npm' }
$SkippedChecks = [System.Collections.Generic.List[string]]::new()

if ($RequireRust -and $SkipRust) {
  throw 'Choose either -RequireRust or -SkipRust, not both.'
}

if (-not (Test-Path -LiteralPath $MainnetConfigPath -PathType Leaf)) {
  throw "Mainnet production config not found: $MainnetConfigPath"
}
$MainnetConfig = Get-Content -LiteralPath $MainnetConfigPath -Raw | ConvertFrom-Json

function Invoke-NativeStep {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Host "`n==> $Name" -ForegroundColor Cyan
  Push-Location $Directory
  try {
    & $Command
    if ($LASTEXITCODE -ne 0) {
      throw "$Name failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Set-TemporaryEnvironment {
  param([hashtable]$Values)

  $previous = @{}
  foreach ($name in $Values.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $Values[$name], 'Process')
  }
  return $previous
}

function Restore-Environment {
  param([hashtable]$Previous)

  foreach ($name in $Previous.Keys) {
    [Environment]::SetEnvironmentVariable($name, $Previous[$name], 'Process')
  }
}

Write-Host 'Locked In launch gate (no fund-moving operations)' -ForegroundColor Green
Write-Host "Repository: $RepoRoot"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required.'
}
if (-not (Get-Command $NpmCommand -ErrorAction SilentlyContinue)) {
  throw 'npm is required.'
}

if ($Install) {
  Invoke-NativeStep 'Install web dependencies from lockfile' $WebRoot { & $NpmCommand ci --no-audit }
  Invoke-NativeStep 'Install backend dependencies from lockfile' $BackendRoot { & $NpmCommand ci --no-audit }
}

Invoke-NativeStep 'Web lint' $WebRoot { & $NpmCommand run lint }
Invoke-NativeStep 'Web typecheck' $WebRoot { & $NpmCommand run typecheck }
Invoke-NativeStep 'Web unit tests' $WebRoot { & $NpmCommand test }

$buildEnvironment = @{
  'NEXT_PUBLIC_API_URL' = $MainnetConfig.apiOrigin
  'NEXT_PUBLIC_DUNGEON_URL' = $MainnetConfig.dungeonOrigin
  'NEXT_PUBLIC_PRIVY_APP_ID' = $MainnetConfig.privyAppId
  'NEXT_PUBLIC_SOLANA_CLUSTER' = $MainnetConfig.solana.cluster
  # These public endpoints make the build deterministic without storing the
  # browser-restricted provider URL used by Vercel in tracked files.
  'NEXT_PUBLIC_SOLANA_RPC_URL' = $MainnetConfig.solana.buildRpcUrl
  'NEXT_PUBLIC_SOLANA_WS_URL' = $MainnetConfig.solana.buildWsUrl
  'NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID' = $MainnetConfig.programs.legacyVault
  'NEXT_PUBLIC_VAULT_V2_PROGRAM_ID' = $MainnetConfig.programs.vaultV2
  'NEXT_PUBLIC_LOCK_VAULT_USDC_MINT' = $MainnetConfig.solana.usdcMint
  'NEXT_PUBLIC_KAMINO_SCOPE_PRICES' = $MainnetConfig.solana.kaminoScopePrices
  'NEXT_PUBLIC_SITE_URL' = $MainnetConfig.webOrigin
}
$previousEnvironment = Set-TemporaryEnvironment $buildEnvironment
try {
  Invoke-NativeStep 'Mainnet-configured production build (non-secret RPC)' $WebRoot { & $NpmCommand run build }
} finally {
  Restore-Environment $previousEnvironment
}

Invoke-NativeStep 'Backend syntax check' $BackendRoot { & $NpmCommand run check }
if ($FullBackend) {
  Write-Host 'Full backend tests expect the configured Postgres test service.' -ForegroundColor Yellow
  Invoke-NativeStep 'Backend unit tests (including migration tests)' $BackendRoot { & $NpmCommand run test:unit }
} else {
  Invoke-NativeStep 'Backend portable unit tests' $BackendRoot { & $NpmCommand run test:unit:portable }
  Write-Host 'SKIP Postgres migration tests (use -FullBackend or rely on CI).' -ForegroundColor Yellow
  $SkippedChecks.Add('Postgres migration tests')
}

$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if ($SkipRust) {
  Write-Host 'SKIP Rust workspace tests (-SkipRust; CI remains authoritative).' -ForegroundColor Yellow
  $SkippedChecks.Add('Rust workspace tests')
} elseif ($cargo) {
  Invoke-NativeStep 'Rust workspace tests' $RepoRoot { cargo test --workspace }
} elseif ($RequireRust) {
  throw 'Rust/cargo is required by -RequireRust but is not installed.'
} else {
  Write-Host 'SKIP Rust workspace tests (cargo not installed; CI remains authoritative).' -ForegroundColor Yellow
  $SkippedChecks.Add('Rust workspace tests')
}

$hasBackendEnv = -not [string]::IsNullOrWhiteSpace($BackendEnv)
$hasFrontendEnv = -not [string]::IsNullOrWhiteSpace($FrontendEnv)
if ($hasBackendEnv -xor $hasFrontendEnv) {
  throw 'Pass both -BackendEnv and -FrontendEnv, or neither.'
}
if ($hasBackendEnv -and $hasFrontendEnv) {
  $resolvedBackendEnv = (Resolve-Path -LiteralPath $BackendEnv).Path
  $resolvedFrontendEnv = (Resolve-Path -LiteralPath $FrontendEnv).Path
  Invoke-NativeStep 'Read-only mainnet environment/on-chain preflight' $RepoRoot {
    node backend/scripts/mainnet-preflight-check.mjs `
      --backend-env $resolvedBackendEnv `
      --frontend-env $resolvedFrontendEnv
  }
} else {
  Write-Host 'SKIP filled-env/database/on-chain preflight (no explicit env files supplied).' -ForegroundColor Yellow
  $SkippedChecks.Add('filled-env/database/on-chain preflight')
}

if ($Live) {
  Invoke-NativeStep 'Read-only deployed mainnet canary' $RepoRoot {
    node scripts/live-mainnet-canary.mjs
  }
} else {
  Write-Host 'SKIP deployed mainnet canary (add -Live).' -ForegroundColor Yellow
  $SkippedChecks.Add('deployed mainnet canary')
}

if ($SkippedChecks.Count -gt 0) {
  Write-Host "`nLocal launch gate passed with $($SkippedChecks.Count) explicit skip(s): $($SkippedChecks -join '; ')." -ForegroundColor Green
} else {
  Write-Host "`nComplete launch gate passed." -ForegroundColor Green
}

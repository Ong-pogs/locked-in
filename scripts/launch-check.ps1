[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Live,
  [switch]$FullBackend,
  [switch]$RequireRust,
  [string]$BackendEnv,
  [string]$FrontendEnv
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WebRoot = Join-Path $RepoRoot 'web-app'
$BackendRoot = Join-Path $RepoRoot 'backend'

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
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd is required.'
}

if ($Install) {
  Invoke-NativeStep 'Install web dependencies from lockfile' $WebRoot { npm.cmd ci --no-audit }
  Invoke-NativeStep 'Install backend dependencies from lockfile' $BackendRoot { npm.cmd ci --no-audit }
}

Invoke-NativeStep 'Web lint' $WebRoot { npm.cmd run lint }
Invoke-NativeStep 'Web typecheck' $WebRoot { npm.cmd run typecheck }
Invoke-NativeStep 'Web unit tests' $WebRoot { npm.cmd test }

$buildEnvironment = @{
  'NEXT_PUBLIC_API_URL' = 'https://locked-in-backend-oetf.onrender.com'
  'NEXT_PUBLIC_DUNGEON_URL' = 'https://dungeon-vert.vercel.app'
  'NEXT_PUBLIC_PRIVY_APP_ID' = 'cmncshird026v0cl5n6yqq8z0'
  'NEXT_PUBLIC_SOLANA_CLUSTER' = 'mainnet-beta'
  'NEXT_PUBLIC_SOLANA_RPC_URL' = 'https://api.mainnet-beta.solana.com'
  'NEXT_PUBLIC_SOLANA_WS_URL' = 'wss://api.mainnet-beta.solana.com'
  'NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID' = '3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav'
  'NEXT_PUBLIC_VAULT_V2_PROGRAM_ID' = 'FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6'
  'NEXT_PUBLIC_LOCK_VAULT_USDC_MINT' = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
}
$previousEnvironment = Set-TemporaryEnvironment $buildEnvironment
try {
  Invoke-NativeStep 'Mainnet production build' $WebRoot { npm.cmd run build }
} finally {
  Restore-Environment $previousEnvironment
}

Invoke-NativeStep 'Backend syntax check' $BackendRoot { npm.cmd run check }
if ($FullBackend) {
  Write-Host 'Full backend tests expect the configured Postgres test service.' -ForegroundColor Yellow
  Invoke-NativeStep 'Backend unit tests (including migration tests)' $BackendRoot { npm.cmd run test:unit }
} else {
  Invoke-NativeStep 'Backend portable unit tests' $BackendRoot { npm.cmd run test:unit:portable }
  Write-Host 'SKIP Postgres migration tests (use -FullBackend or rely on CI).' -ForegroundColor Yellow
}

$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if ($cargo) {
  Invoke-NativeStep 'Rust workspace tests' $RepoRoot { cargo test --workspace }
} elseif ($RequireRust) {
  throw 'Rust/cargo is required by -RequireRust but is not installed.'
} else {
  Write-Host 'SKIP Rust workspace tests (cargo not installed; CI remains authoritative).' -ForegroundColor Yellow
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
}

if ($Live) {
  Invoke-NativeStep 'Read-only deployed mainnet canary' $RepoRoot {
    node scripts/live-mainnet-canary.mjs
  }
}

Write-Host "`nLaunch gate passed." -ForegroundColor Green

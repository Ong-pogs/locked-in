import { config as loadEnv } from 'dotenv';

loadEnv();

// In production we fail fast when a required env var is missing, even if a
// dev fallback is supplied — otherwise the server boots with hardcoded dev
// secrets like 'dev-only-please-change' and tokens become forgeable. In dev
// (NODE_ENV !== 'production') we keep the fallback so `npm run dev` works
// without a full .env.
function required(name, fallback = '') {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Missing required environment variable in production: ${name}`,
    );
  }
  if (!fallback) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return fallback;
}

function optionalInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function optionalBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function csvList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

// Browser Origin headers never include a trailing slash — strip them
// so a misconfigured env var like "https://example.com/" still matches.
function sanitizeOrigins(origins) {
  return origins.map((o) => o.replace(/\/+$/, ''));
}

// Yield-strategy profiles. Pick one via YIELD_STRATEGY_PROFILE env var; the
// rest of the YIELD_* env vars become overrides. Three modes:
//
//  - fixed_apy_dev          → devnet default. Mock 8% APY, no on-chain reads.
//  - kamino_surfpool        → local demo. Real Kamino program + main market,
//                             read through a locally-running Surfpool mainnet
//                             fork at 127.0.0.1:8899. See
//                             backend/scripts/README-SURFPOOL.md for setup.
//                             Surfpool is a dev-only RPC; this profile is NOT
//                             safe for production deploys.
//  - kamino_usdc_mainnet    → real mainnet, real funds. Production path once
//                             the lock vault holds real SOL/USDC.
//
// Production at lockedin.ong runs fixed_apy_dev by default because Render
// can't reach localhost (Surfpool) and we don't want to spend real mainnet
// SOL/USDC on devnet test traffic. To demo real Kamino numbers, run the
// stack locally with YIELD_STRATEGY_PROFILE=kamino_surfpool.
function resolveYieldStrategyProfile(profile) {
  switch ((profile ?? '').trim()) {
    case 'fixed_apy_dev':
      return {
        enabled: true,
        kind: 'fixed_apy_v1',
        fixedApyBps: 800,
        harvestIntervalSeconds: 3600,
        kaminoRpcUrl: 'https://api.mainnet-beta.solana.com',
        kaminoMarketAddress: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
        kaminoReserveSymbol: 'USDC',
      };
    case 'kamino_surfpool':
      return {
        enabled: true,
        kind: 'kamino_klend_reserve_v1',
        fixedApyBps: 800,
        harvestIntervalSeconds: 7 * 24 * 60 * 60,
        kaminoRpcUrl: 'http://127.0.0.1:8899',
        kaminoMarketAddress: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
        kaminoReserveSymbol: 'USDC',
      };
    case 'kamino_usdc_mainnet':
      return {
        enabled: true,
        kind: 'kamino_klend_reserve_v1',
        fixedApyBps: 800,
        // Weekly cadence keeps small devnet locks above integer rounding noise.
        harvestIntervalSeconds: 7 * 24 * 60 * 60,
        kaminoRpcUrl: 'https://api.mainnet-beta.solana.com',
        kaminoMarketAddress: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
        kaminoReserveSymbol: 'USDC',
      };
    default:
      return null;
  }
}

const defaultCorsOrigins = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];

const configuredCorsOrigins = csvList(
  process.env.CORS_ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGIN ?? '',
);
const yieldStrategyProfile = process.env.YIELD_STRATEGY_PROFILE ?? '';
const yieldStrategyProfileDefaults = resolveYieldStrategyProfile(yieldStrategyProfile);
const isYieldProfileActive = Boolean(yieldStrategyProfileDefaults);

export const appConfig = {
  port: optionalInt('PORT', 3001),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  logPretty: optionalBool('LOG_PRETTY', process.env.NODE_ENV !== 'production'),
  logSingleLine: optionalBool('LOG_SINGLE_LINE', true),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: required('JWT_SECRET', 'dev-only-please-change'),
  jwtIssuer: process.env.JWT_ISSUER ?? 'lockedin-api',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'lockedin-mobile',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? '30d',
  schedulerSecret: required('SCHEDULER_SECRET', 'dev-only-scheduler-secret'),
  missExtensionDays: optionalInt('MISS_EXTENSION_DAYS', 7),
  lockVaultRelayEnabled: optionalBool('LOCK_VAULT_RELAY_ENABLED', false),
  lockVaultRelayIntervalMs: optionalInt('LOCK_VAULT_RELAY_INTERVAL_MS', 15_000),
  lockVaultRelayBatchSize: optionalInt('LOCK_VAULT_RELAY_BATCH_SIZE', 5),
  redemptionVaultAutofundEnabled: optionalBool(
    'REDEMPTION_VAULT_AUTOFUND_ENABLED',
    false,
  ),
  redemptionVaultAutofundIntervalMs: optionalInt(
    'REDEMPTION_VAULT_AUTOFUND_INTERVAL_MS',
    30_000,
  ),
  redemptionVaultMinimumBalanceUi:
    process.env.REDEMPTION_VAULT_MINIMUM_BALANCE_UI ?? '1',
  redemptionVaultTargetBalanceUi:
    process.env.REDEMPTION_VAULT_TARGET_BALANCE_UI ?? '5',
  leaderboardSnapshotEnabled: optionalBool('LEADERBOARD_SNAPSHOT_ENABLED', false),
  leaderboardSnapshotIntervalMs: optionalInt('LEADERBOARD_SNAPSHOT_INTERVAL_MS', 60_000),
  leaderboardSnapshotPageSize: optionalInt('LEADERBOARD_SNAPSHOT_PAGE_SIZE', 25),
  unlockIndexerEnabled: optionalBool('UNLOCK_INDEXER_ENABLED', false),
  unlockIndexerIntervalMs: optionalInt('UNLOCK_INDEXER_INTERVAL_MS', 15_000),
  unlockIndexerScanLimit: optionalInt('UNLOCK_INDEXER_SCAN_LIMIT', 25),
  runtimeSchedulerEnabled: optionalBool('RUNTIME_SCHEDULER_ENABLED', false),
  runtimeSchedulerIntervalMs: optionalInt('RUNTIME_SCHEDULER_INTERVAL_MS', 15_000),
  runtimeSchedulerBatchSize: optionalInt('RUNTIME_SCHEDULER_BATCH_SIZE', 5),
  answerValidatorHybridEnabled: optionalBool('ANSWER_VALIDATOR_HYBRID_ENABLED', false),
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiResponsesBaseUrl: process.env.OPENAI_RESPONSES_BASE_URL ?? 'https://api.openai.com/v1',
  openaiValidatorModel: process.env.OPENAI_VALIDATOR_MODEL ?? 'gpt-4o-mini',
  openaiValidatorTimeoutMs: optionalInt('OPENAI_VALIDATOR_TIMEOUT_MS', 4000),
  yieldStrategyProfile: yieldStrategyProfile || null,
  yieldStrategyEnabled: isYieldProfileActive
    ? yieldStrategyProfileDefaults.enabled
    : optionalBool('YIELD_STRATEGY_ENABLED', false),
  yieldStrategyKind: isYieldProfileActive
    ? yieldStrategyProfileDefaults.kind
    : process.env.YIELD_STRATEGY_KIND ?? 'fixed_apy_v1',
  yieldFixedApyBps: isYieldProfileActive
    ? yieldStrategyProfileDefaults.fixedApyBps
    : optionalInt('YIELD_FIXED_APY_BPS', 800),
  yieldHarvestIntervalSeconds: isYieldProfileActive
    ? yieldStrategyProfileDefaults.harvestIntervalSeconds
    : optionalInt('YIELD_HARVEST_INTERVAL_SECONDS', 86_400),
  yieldKaminoRpcUrl: isYieldProfileActive
    ? yieldStrategyProfileDefaults.kaminoRpcUrl
    : process.env.YIELD_KAMINO_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
  yieldKaminoMarketAddress: isYieldProfileActive
    ? yieldStrategyProfileDefaults.kaminoMarketAddress
    : process.env.YIELD_KAMINO_MARKET_ADDRESS ?? '',
  yieldKaminoReserveSymbol: isYieldProfileActive
    ? yieldStrategyProfileDefaults.kaminoReserveSymbol
    : process.env.YIELD_KAMINO_RESERVE_SYMBOL ?? 'USDC',
  yieldKaminoRecentSlotDurationMs: optionalInt(
    'YIELD_KAMINO_RECENT_SLOT_DURATION_MS',
    30_000,
  ),
  yieldStrategyApyCacheMs: optionalInt('YIELD_STRATEGY_APY_CACHE_MS', 60_000),
  solanaRpcUrl:
    process.env.SOLANA_RPC_URL ??
    process.env.EXPO_PUBLIC_SOLANA_RPC_URL ??
    'https://api.devnet.solana.com',
  lockVaultProgramId:
    process.env.LOCK_VAULT_PROGRAM_ID ??
    process.env.EXPO_PUBLIC_LOCK_VAULT_PROGRAM_ID ??
    '',
  yieldSplitterProgramId:
    process.env.YIELD_SPLITTER_PROGRAM_ID ??
    process.env.EXPO_PUBLIC_YIELD_SPLITTER_PROGRAM_ID ??
    '',
  communityPotProgramId:
    process.env.COMMUNITY_POT_PROGRAM_ID ??
    process.env.EXPO_PUBLIC_COMMUNITY_POT_PROGRAM_ID ??
    '',
  lockVaultUsdcMint:
    process.env.LOCK_VAULT_USDC_MINT ??
    process.env.EXPO_PUBLIC_LOCK_VAULT_USDC_MINT ??
    '',
  lockVaultSkrMint:
    process.env.LOCK_VAULT_SKR_MINT ??
    process.env.EXPO_PUBLIC_LOCK_VAULT_SKR_MINT ??
    '',
  lockVaultWorkerPrivateKey:
    process.env.LOCK_VAULT_WORKER_PRIVATE_KEY ??
    process.env.DEPLOYER_PRIVATE_KEY ??
    '',
  yieldSplitterWorkerPrivateKey:
    process.env.YIELD_SPLITTER_WORKER_PRIVATE_KEY ??
    process.env.LOCK_VAULT_WORKER_PRIVATE_KEY ??
    process.env.DEPLOYER_PRIVATE_KEY ??
    '',
  communityPotWorkerPrivateKey:
    process.env.COMMUNITY_POT_WORKER_PRIVATE_KEY ??
    process.env.LOCK_VAULT_WORKER_PRIVATE_KEY ??
    process.env.DEPLOYER_PRIVATE_KEY ??
    '',
  faucetEnabled: optionalBool('FAUCET_ENABLED', false),
  faucetSolLamports: optionalInt('FAUCET_SOL_LAMPORTS', 100_000_000),
  faucetUsdcAmountUi: process.env.FAUCET_USDC_AMOUNT_UI ?? '10',
  faucetRound: optionalInt('FAUCET_ROUND', 1),
  corsAllowedOrigins: sanitizeOrigins(
    configuredCorsOrigins.length > 0 ? configuredCorsOrigins : defaultCorsOrigins,
  ),
};

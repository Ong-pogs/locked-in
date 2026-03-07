import { config as loadEnv } from 'dotenv';

loadEnv();

function required(name, fallback = '') {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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
    case 'kamino_usdc_mainnet':
      return {
        enabled: true,
        kind: 'kamino_klend_reserve_v1',
        fixedApyBps: 800,
        harvestIntervalSeconds: 3600,
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
  corsAllowedOrigins:
    configuredCorsOrigins.length > 0 ? configuredCorsOrigins : defaultCorsOrigins,
};

// Boot guards (spec §4.2): refuse to boot into a footgun configuration.
//
// Pure functions over an appConfig-shaped object — no imports from config.mjs
// (config.mjs calls assertBootGuards at load time, so this module must stay
// dependency-free to avoid a cycle) and no process.env reads, so the guard
// logic is unit-testable in isolation.
//
// CLUSTER is detected from the *intent* of the RPC URL, not a live
// getGenesisHash call: boot must be able to fail closed even when the RPC is
// unreachable, and a guard that silently passes because the network was down
// is worse than none. Anything we cannot classify is treated as strictly as
// mainnet.

export const MIN_SECRET_BYTES = 32;

// Yield setups that must never sit behind a mainnet vault_v2: the fixed-APY
// mock, and the profiles documented in config.mjs as dev/demo-only.
const DEV_YIELD_PROFILES = new Set(['fixed_apy_dev', 'kamino_surfpool', 'kamino_devnet_demo']);
const REAL_YIELD_KIND = 'kamino_klend_reserve_v1';
// The only yield profile that implies a real-money mainnet deployment.
const REAL_YIELD_PROFILE = 'kamino_usdc_mainnet';
// Canonical mainnet USDC mint (Circle).
const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Classify the RPC URL: 'devnet' | 'mainnet' | 'local' | 'unknown'.
 * 'local' is checked first so a localhost mainnet-fork (Surfpool) is never
 * mistaken for the real mainnet; 'unknown' is treated like mainnet by every
 * guard (fail closed).
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

export function detectCluster(rpcUrl) {
  const url = (rpcUrl ?? '').toLowerCase();
  if (!url) return 'unknown';
  // Exact-hostname match for local so `notlocalhost.example.com` can't spoof
  // its way past the strict guards.
  try {
    if (LOCAL_HOSTS.has(new URL(url).hostname)) return 'local';
  } catch {
    // unparseable URL — fall through to the strict buckets below
  }
  // mainnet before devnet: a URL naming both is ambiguous and gets the
  // stricter classification.
  if (url.includes('mainnet')) return 'mainnet';
  if (url.includes('devnet')) return 'devnet';
  return 'unknown';
}

/**
 * Collect every violated guard as a human-readable string. Returns [] when
 * the config is safe to boot.
 *
 *  (a) On any non-local cluster, the forgeable auth secrets (JWT, scheduler)
 *      must be at least 32 bytes. Devnet is NOT exempt (lapse-sweep ruling
 *      R21): the long-lived internet-facing devnet deployment now exposes
 *      scheduler-keyed endpoints that move voucher-relevant state.
 *  (b) A vault_v2 program on mainnet must not run with a mock/dev yield
 *      adapter — real principal would sit in Kamino while the backend
 *      fabricates APY.
 *  (c) A configured vault_v2 program without a worker/ops signing key cannot
 *      issue vouchers or crank force-returns — refuse rather than degrade.
 */
export function collectBootGuardViolations(config) {
  const violations = [];
  const cluster = detectCluster(config.solanaRpcUrl);

  // (a) secret length floor everywhere except local development.
  if (cluster !== 'local') {
    for (const [name, value] of [
      ['JWT_SECRET', config.jwtSecret],
      ['SCHEDULER_SECRET', config.schedulerSecret],
    ]) {
      const bytes = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
      if (bytes < MIN_SECRET_BYTES) {
        violations.push(
          `${name} is ${bytes} bytes; the '${cluster}' cluster requires at least ` +
            `${MIN_SECRET_BYTES} bytes. Set a real ${name}.`,
        );
      }
    }
  }

  // "mainnet or stricter": anything we cannot positively classify as devnet
  // or local is treated as mainnet (the module's stated contract). A real
  // mainnet reached via a branded RPC — Triton *.rpcpool.com, Helius, a custom
  // domain, a self-hosted validator — classifies as 'unknown', and the money
  // guards below MUST still fire for it (audit H: fail-closed).
  const mainnetOrStricter = cluster !== 'devnet' && cluster !== 'local';

  // (b) mainnet vault_v2 must not pair with a mock/devnet yield adapter —
  // nor with NO adapter: with yield vars simply absent, /v1/yield/current-apy
  // serves the simulated fixed rate labeled as mainnet (audit S3).
  if (mainnetOrStricter && config.vaultV2ProgramId && !config.yieldStrategyEnabled) {
    violations.push(
      `VAULT_V2_PROGRAM_ID is configured on mainnet but the yield strategy is ` +
        `disabled/unset — the APY endpoint would serve the simulated fixed rate. ` +
        `Set YIELD_STRATEGY_ENABLED=true with YIELD_STRATEGY_PROFILE=kamino_usdc_mainnet.`,
    );
  }
  if (mainnetOrStricter && config.vaultV2ProgramId && config.yieldStrategyEnabled) {
    const kind = config.yieldStrategyKind ?? '';
    const profile = config.yieldStrategyProfile ?? '';
    if (kind !== REAL_YIELD_KIND) {
      violations.push(
        `VAULT_V2_PROGRAM_ID is configured on mainnet but the yield strategy ` +
          `'${kind}' is a mock adapter. Switch to the real Kamino adapter ` +
          `(YIELD_STRATEGY_PROFILE=kamino_usdc_mainnet) or unset the v2 program.`,
      );
    } else if (DEV_YIELD_PROFILES.has(profile)) {
      violations.push(
        `VAULT_V2_PROGRAM_ID is configured on mainnet but YIELD_STRATEGY_PROFILE=` +
          `'${profile}' is a dev/demo profile. Use kamino_usdc_mainnet.`,
      );
    }
  }

  // (c) a v2 program without a signing key can neither voucher nor crank.
  if (config.vaultV2ProgramId && !config.lockVaultWorkerPrivateKey) {
    violations.push(
      `VAULT_V2_PROGRAM_ID is set but LOCK_VAULT_WORKER_PRIVATE_KEY is missing. ` +
        `The backend cannot sign vouchers or sponsor cranks without it.`,
    );
  }

  // (d) the program upgrade authority (DEPLOYER_PRIVATE_KEY) must NEVER live on
  // an internet-facing mainnet fund-signing host — a breach would let an
  // attacker replace the program AND drain the treasury in one step (audit H2).
  if (mainnetOrStricter && config.deployerKeyPresent) {
    violations.push(
      `DEPLOYER_PRIVATE_KEY is set on a mainnet host. The upgrade authority must ` +
        `never sit on the backend — deploy from a separate machine and set only ` +
        `LOCK_VAULT_WORKER_PRIVATE_KEY / COMMUNITY_POT_WORKER_PRIVATE_KEY here.`,
    );
  }

  // (e) the real-Kamino profile behind a devnet-classified RPC almost always
  // means SOLANA_RPC_URL was left unset (the devnet default) — which would turn
  // OFF every mainnet money guard. Fail closed (audit M13).
  // Fires only on a POSITIVELY dev/local RPC — the "SOLANA_RPC_URL left at the
  // devnet default" footgun. An 'unknown' cluster (branded mainnet RPC) is NOT
  // flagged here, else a legit Triton/Helius mainnet with the real profile
  // would be blocked from booting; guards (b)/(d)/(f) already cover it.
  if (
    (config.yieldStrategyProfile ?? '') === REAL_YIELD_PROFILE &&
    (cluster === 'devnet' || cluster === 'local')
  ) {
    violations.push(
      `YIELD_STRATEGY_PROFILE=kamino_usdc_mainnet but the RPC classifies as ` +
        `'${cluster}'. Set SOLANA_RPC_URL to a real mainnet RPC — the devnet ` +
        `default disables every mainnet guard.`,
    );
  }

  // (f) on mainnet the vault must be bound to the canonical USDC mint — an
  // env carried over from devnet would lock users into a worthless mint
  // (audit L11).
  if (mainnetOrStricter && config.lockVaultUsdcMint && config.lockVaultUsdcMint !== MAINNET_USDC_MINT) {
    violations.push(
      `LOCK_VAULT_USDC_MINT is '${config.lockVaultUsdcMint}' on mainnet; expected ` +
        `the canonical USDC mint ${MAINNET_USDC_MINT}.`,
    );
  }

  return violations;
}

/** Throw a single error listing every violation; no-op on a clean config. */
export function assertBootGuards(config) {
  const violations = collectBootGuardViolations(config);
  if (violations.length > 0) {
    throw new Error(
      `Refusing to boot — ${violations.length} boot guard violation(s):\n` +
        violations.map((v) => `  - ${v}`).join('\n'),
    );
  }
}

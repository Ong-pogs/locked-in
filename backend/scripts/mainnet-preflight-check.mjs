#!/usr/bin/env node
// Mainnet pre-flight: verify every env var and on-chain account line up BEFORE
// the first real deposit. READ-ONLY — no writes, no mutations, safe to run any
// number of times. Exit 0 only if there are zero FAILs.
//
// Usage (point it at the env you are about to launch with):
//   node scripts/mainnet-preflight-check.mjs \
//     --backend-env  scripts/deploy/env.mainnet.backend.filled \
//     --frontend-env scripts/deploy/env.mainnet.frontend.filled \
//     [--squads <vault-pubkey>]     # asserts program upgrade authority == this
//
//   # or run against the current process env / a devnet .env to self-test:
//   node --env-file=.env scripts/mainnet-preflight-check.mjs
//
// It mirrors the backend boot guards (backend/src/lib/bootGuards.mjs) so a
// misconfig surfaces HERE, not after users have money in flight. On a
// non-mainnet cluster the mainnet-only assertions (canonical USDC, klend, hot
// key) report as SKIP, so a devnet run validates the machinery without
// false-failing.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58x from 'bs58';
const bs58 = bs58x.decode ? bs58x : bs58x.default;

const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const MAINNET_PROGRAM = 'FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6';
const CONFIG_SEED = Buffer.from('vault-v2b');
const POT_SEED = Buffer.from('pot-protocol');
const BPF_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

// ── arg + env parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
function loadEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}
const backendEnvPath = flag('--backend-env');
const frontendEnvPath = flag('--frontend-env');
const squads = flag('--squads');
const be = backendEnvPath ? loadEnvFile(backendEnvPath) : process.env;
const fe = frontendEnvPath ? loadEnvFile(frontendEnvPath) : process.env;

// ── check harness ────────────────────────────────────────────────────────
const results = [];
const add = (status, name, detail) => results.push({ status, name, detail });
const PASS = (n, d = '') => add('PASS', n, d);
const FAIL = (n, d = '') => add('FAIL', n, d);
const WARN = (n, d = '') => add('WARN', n, d);
const SKIP = (n, d = '') => add('SKIP', n, d);

function pubkeyOfSecret(bs58secret) {
  const s = bs58.decode(bs58secret.trim());
  if (s.length !== 64) throw new Error(`secret key must be 64 bytes, got ${s.length}`);
  return new PublicKey(s.slice(32)).toBase58();
}
const isBase58Pubkey = (v) => {
  try { new PublicKey(v); return true; } catch { return false; }
};

// ── cluster classification (mirrors bootGuards.detectCluster: fail-closed) ──
const rpc = be.SOLANA_RPC_URL ?? '';
const cluster = (() => {
  const u = rpc.toLowerCase();
  if (u.includes('devnet')) return 'devnet';
  if (u.includes('testnet')) return 'testnet';
  if (u.includes('localhost') || u.includes('127.0.0.1')) return 'local';
  return 'mainnet'; // unknown → treated as strictly as mainnet
})();
const isMainnet = cluster !== 'devnet' && cluster !== 'local' && cluster !== 'testnet';

async function main() {
  console.log(`\n=== Locked In — mainnet pre-flight ===`);
  console.log(`backend env : ${backendEnvPath ?? '(process env)'}`);
  console.log(`frontend env: ${frontendEnvPath ?? '(process env)'}`);
  console.log(`RPC         : ${rpc || '(unset)'}`);
  console.log(`cluster     : ${cluster}${isMainnet ? '' : ' — mainnet-only checks will SKIP'}\n`);

  // 1. Required backend env present + well-formed.
  const requiredBackend = [
    'SOLANA_RPC_URL', 'VAULT_V2_PROGRAM_ID', 'COMMUNITY_POT_PROGRAM_ID', 'LOCK_VAULT_USDC_MINT',
    'LOCK_VAULT_WORKER_PRIVATE_KEY', 'COMMUNITY_POT_WORKER_PRIVATE_KEY', 'JWT_SECRET',
    'SCHEDULER_SECRET', 'DATABASE_URL', 'YIELD_STRATEGY_PROFILE',
  ];
  for (const k of requiredBackend) {
    be[k] ? PASS(`env ${k} present`) : FAIL(`env ${k} MISSING`);
  }
  for (const k of ['JWT_SECRET', 'SCHEDULER_SECRET']) {
    if (be[k] && Buffer.byteLength(be[k]) < 32) FAIL(`${k} < 32 bytes`, `len ${Buffer.byteLength(be[k])}`);
    else if (be[k]) PASS(`${k} length ok`);
    if (be[k] && /dev-only|changeme|placeholder|test/i.test(be[k])) FAIL(`${k} looks like a placeholder`);
  }

  // 2. Boot-guard mirror (a–f).
  if (isMainnet && be.DEPLOYER_PRIVATE_KEY) FAIL('guard(d): DEPLOYER_PRIVATE_KEY set on a mainnet host', 'the upgrade key must never sit on the backend');
  else SKIP('guard(d): deployer key off backend', isMainnet ? 'not set ✓' : 'devnet');
  if (isMainnet && be.LOCK_VAULT_USDC_MINT && be.LOCK_VAULT_USDC_MINT !== MAINNET_USDC)
    FAIL('guard(f): USDC mint not canonical', `${be.LOCK_VAULT_USDC_MINT} != ${MAINNET_USDC}`);
  else if (isMainnet) PASS('guard(f): canonical USDC mint');
  else SKIP('guard(f): canonical USDC', 'devnet mint expected');
  const profile = be.YIELD_STRATEGY_PROFILE ?? '';
  if (isMainnet && be.VAULT_V2_PROGRAM_ID) {
    if (be.YIELD_STRATEGY_ENABLED !== 'true') FAIL('guard(b): YIELD_STRATEGY_ENABLED must be true on mainnet');
    else if (profile !== 'kamino_usdc_mainnet') FAIL('guard(b): yield profile not kamino_usdc_mainnet', `got '${profile}'`);
    else PASS('guard(b): real Kamino yield profile enabled');
  } else SKIP('guard(b): mainnet yield profile', 'devnet');
  if (isMainnet && be.DEV_TOOLS_ENABLED === 'true') FAIL('DEV_TOOLS_ENABLED is true on mainnet', 'the dev force-complete endpoint would be open');
  else PASS('DEV_TOOLS_ENABLED not set on mainnet', be.DEV_TOOLS_ENABLED ?? 'unset');

  // 3. Derive ops pubkeys; the voucher trap.
  let opsVoucherPubkey = null, potRelayPubkey = null;
  try { opsVoucherPubkey = pubkeyOfSecret(be.LOCK_VAULT_WORKER_PRIVATE_KEY); PASS('LOCK_VAULT_WORKER_PRIVATE_KEY decodes', opsVoucherPubkey); }
  catch (e) { FAIL('LOCK_VAULT_WORKER_PRIVATE_KEY invalid', e.message); }
  try { potRelayPubkey = pubkeyOfSecret(be.COMMUNITY_POT_WORKER_PRIVATE_KEY); PASS('COMMUNITY_POT_WORKER_PRIVATE_KEY decodes', potRelayPubkey); }
  catch (e) { FAIL('COMMUNITY_POT_WORKER_PRIVATE_KEY invalid', e.message); }

  // 4. Program id sanity.
  if (isMainnet && be.VAULT_V2_PROGRAM_ID && be.VAULT_V2_PROGRAM_ID !== MAINNET_PROGRAM)
    WARN('VAULT_V2_PROGRAM_ID != expected mainnet id', `${be.VAULT_V2_PROGRAM_ID} vs ${MAINNET_PROGRAM}`);
  if (be.VAULT_V2_PROGRAM_ID && be.COMMUNITY_POT_PROGRAM_ID && be.VAULT_V2_PROGRAM_ID !== be.COMMUNITY_POT_PROGRAM_ID)
    FAIL('merged program: VAULT_V2 != COMMUNITY_POT program id', 'they must be the same merged program');
  else if (be.VAULT_V2_PROGRAM_ID) PASS('vault + pot share one program id');

  // 5. On-chain reads.
  if (!rpc || !be.VAULT_V2_PROGRAM_ID || !isBase58Pubkey(be.VAULT_V2_PROGRAM_ID)) {
    FAIL('on-chain checks skipped', 'RPC or program id missing/invalid');
  } else {
    const conn = new Connection(rpc, 'confirmed');
    const programId = new PublicKey(be.VAULT_V2_PROGRAM_ID);

    // 5a. Program deployed + executable + upgrade authority.
    const progInfo = await conn.getAccountInfo(programId).catch(() => null);
    if (!progInfo) FAIL('program account not found on-chain', programId.toBase58());
    else if (!progInfo.executable) FAIL('program account not executable');
    else {
      PASS('program deployed + executable');
      const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER);
      const pd = await conn.getAccountInfo(programData).catch(() => null);
      if (pd) {
        // ProgramData: [4 tag][8 slot][1 option][32 auth?]
        const hasAuth = pd.data[12] === 1;
        const upgradeAuth = hasAuth ? new PublicKey(pd.data.subarray(13, 45)).toBase58() : null;
        if (!upgradeAuth) WARN('program is immutable (no upgrade authority)');
        else if (squads && upgradeAuth === squads) PASS('upgrade authority == Squads', upgradeAuth);
        else if (squads) FAIL('upgrade authority != Squads', `${upgradeAuth} vs ${squads}`);
        else if (isMainnet && (upgradeAuth === opsVoucherPubkey || upgradeAuth === potRelayPubkey))
          FAIL('upgrade authority is a HOT ops key', upgradeAuth);
        else WARN('upgrade authority (pass --squads to assert)', upgradeAuth);
      }
    }

    // 5b. VaultV2Config PDA.
    const [cfgPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
    const cfg = await conn.getAccountInfo(cfgPda).catch(() => null);
    if (!cfg) FAIL('VaultV2Config PDA not initialized', cfgPda.toBase58());
    else {
      const d = cfg.data; const pk = (o) => new PublicKey(d.subarray(o, o + 32)).toBase58();
      const authority = pk(8), usdcMint = pk(40), kaminoProgram = pk(72), kaminoReserve = pk(104), potVault = pk(264), feeVault = pk(296);
      const min = Number(d.readBigUInt64LE(328)) / 1e6, max = Number(d.readBigUInt64LE(336)) / 1e6, cap = Number(d.readBigUInt64LE(344)) / 1e6;
      const paused = d[362] === 1;
      PASS('VaultV2Config initialized', cfgPda.toBase58());
      // THE voucher trap: config.authority must equal the backend voucher key.
      if (opsVoucherPubkey && authority === opsVoucherPubkey) PASS('config.authority == LOCK_VAULT_WORKER_PRIVATE_KEY', 'vouchers will verify ✓');
      else if (opsVoucherPubkey) FAIL('config.authority != voucher key — EVERY voucher is unclaimable', `on-chain ${authority} vs ops ${opsVoucherPubkey}`);
      if (be.LOCK_VAULT_USDC_MINT && usdcMint === be.LOCK_VAULT_USDC_MINT) PASS('config.usdcMint == env mint');
      else FAIL('config.usdcMint != env LOCK_VAULT_USDC_MINT', `${usdcMint} vs ${be.LOCK_VAULT_USDC_MINT}`);
      if (isMainnet && kaminoProgram === KLEND) PASS('config.kaminoProgram == real klend');
      else if (isMainnet) FAIL('config.kaminoProgram != klend on mainnet', kaminoProgram);
      else SKIP('config.kaminoProgram (klend)', `devnet mock ${kaminoProgram.slice(0, 8)}…`);
      if (paused) WARN('vault is PAUSED — deposits will be refused', 'unpause before launch (claims still work)');
      else PASS('vault not paused');
      if (feeVault === cfgPda.toBase58() || feeVault === potVault) FAIL('fee_vault collides with config/pot vault', feeVault);
      else PASS('fee_vault distinct');
      // caps sanity for the capped beta
      if (min > 0 && max >= min && cap >= max) PASS('caps sane', `min $${min} max $${max} cap $${cap}`);
      else WARN('caps look off', `min $${min} max $${max} cap $${cap}`);
      // pot vault must be the pot PDA's USDC ATA
      const [potPda] = PublicKey.findProgramAddressSync([POT_SEED], programId);
      const expectedPotVault = getAssociatedTokenAddressSync(new PublicKey(usdcMint), potPda, true).toBase58();
      if (potVault === expectedPotVault) PASS('config.potVault == ATA(usdc, pot PDA)');
      else WARN('config.potVault != derived pot ATA', `${potVault} vs ${expectedPotVault}`);

      // 5c. PotConfig PDA + authority.
      const pot = await conn.getAccountInfo(potPda).catch(() => null);
      if (!pot) FAIL('PotConfig PDA not initialized', potPda.toBase58());
      else {
        const potAuth = new PublicKey(pot.data.subarray(8, 40)).toBase58();
        const potMint = new PublicKey(pot.data.subarray(40, 72)).toBase58();
        PASS('PotConfig initialized', potPda.toBase58());
        if (potRelayPubkey && potAuth === potRelayPubkey) PASS('PotConfig.authority == COMMUNITY_POT_WORKER_PRIVATE_KEY', 'pot cron will run ✓');
        else if (potRelayPubkey) FAIL('PotConfig.authority != pot relay key — pot cron preflight will refuse', `${potAuth} vs ${potRelayPubkey}`);
        if (potMint === usdcMint) PASS('PotConfig.stable_mint == vault USDC mint');
        else FAIL('PotConfig.stable_mint != vault mint', `${potMint} vs ${usdcMint}`);
      }

      // 5d. Kamino reserve reachable (mainnet).
      if (isMainnet && be.YIELD_KAMINO_RESERVE_ADDRESS) {
        if (be.YIELD_KAMINO_RESERVE_ADDRESS !== kaminoReserve)
          WARN('YIELD_KAMINO_RESERVE_ADDRESS != config.kaminoReserve', `${be.YIELD_KAMINO_RESERVE_ADDRESS} vs ${kaminoReserve}`);
        const res = await conn.getAccountInfo(new PublicKey(kaminoReserve)).catch(() => null);
        res ? PASS('Kamino reserve account exists', kaminoReserve) : FAIL('Kamino reserve not found', kaminoReserve);
      } else SKIP('Kamino reserve reachable', 'devnet / not set');
    }
  }

  // 6. Frontend/backend cross-consistency.
  if (fe.NEXT_PUBLIC_VAULT_V2_PROGRAM_ID && be.VAULT_V2_PROGRAM_ID) {
    fe.NEXT_PUBLIC_VAULT_V2_PROGRAM_ID === be.VAULT_V2_PROGRAM_ID
      ? PASS('frontend program id == backend')
      : FAIL('NEXT_PUBLIC_VAULT_V2_PROGRAM_ID != backend', `${fe.NEXT_PUBLIC_VAULT_V2_PROGRAM_ID} vs ${be.VAULT_V2_PROGRAM_ID}`);
  }
  if (fe.NEXT_PUBLIC_LOCK_VAULT_USDC_MINT && be.LOCK_VAULT_USDC_MINT) {
    fe.NEXT_PUBLIC_LOCK_VAULT_USDC_MINT === be.LOCK_VAULT_USDC_MINT
      ? PASS('frontend USDC mint == backend')
      : FAIL('NEXT_PUBLIC mint != backend mint');
  }
  if (isMainnet) {
    fe.NEXT_PUBLIC_SOLANA_CLUSTER === 'mainnet-beta' ? PASS('frontend cluster = mainnet-beta') : FAIL('NEXT_PUBLIC_SOLANA_CLUSTER != mainnet-beta', fe.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'unset');
    (fe.NEXT_PUBLIC_SOLANA_WS_URL && !fe.NEXT_PUBLIC_SOLANA_WS_URL.includes('devnet')) ? PASS('frontend WS url set + not devnet') : FAIL('NEXT_PUBLIC_SOLANA_WS_URL missing or still devnet');
    fe.NEXT_PUBLIC_E2E_TX_STUB ? FAIL('NEXT_PUBLIC_E2E_TX_STUB is set — e2e stub in a prod build') : PASS('E2E tx stub absent');
  }

  // 7. DB reachable + migrations applied + cutover reminder.
  if (be.DATABASE_URL) {
    try {
      const pg = (await import('pg')).default;
      const c = new pg.Client({ connectionString: be.DATABASE_URL });
      await c.connect();
      const m = await c.query('select count(*)::int as n, max(filename) as last from lesson.schema_migrations');
      PASS('DB reachable', `${m.rows[0].n} migrations, latest ${m.rows[0].last}`);
      // devnet-residue heuristic: any completion freeze predating the cutover
      const stale = await c.query("select count(*)::int as n from lesson.user_course_runtime_state where course_completed_at is not null");
      if (isMainnet && stale.rows[0].n > 0)
        WARN('runtime rows with course_completed_at present', `${stale.rows[0].n} — run mainnet-cutover-reset.mjs before first deposit if these are devnet residue`);
      else PASS('no obvious devnet completion residue', `${stale.rows[0].n} frozen rows`);
      await c.end();
    } catch (e) { FAIL('DB check failed', e.message); }
  }

  // ── report ───────────────────────────────────────────────────────────────
  const order = { FAIL: 0, WARN: 1, PASS: 2, SKIP: 3 };
  results.sort((a, b) => order[a.status] - order[b.status]);
  const mark = { PASS: '✓', WARN: '!', FAIL: '✗', SKIP: '·' };
  console.log('─'.repeat(72));
  for (const r of results) console.log(`  ${mark[r.status]} ${r.status.padEnd(4)} ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  console.log('─'.repeat(72));
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`  ${n('FAIL')} FAIL · ${n('WARN')} WARN · ${n('PASS')} PASS · ${n('SKIP')} SKIP\n`);
  if (n('FAIL') > 0) { console.log('NOT READY — resolve every FAIL before the first real deposit.\n'); process.exit(1); }
  if (n('WARN') > 0) { console.log('Review WARNs, then go.\n'); process.exit(0); }
  console.log('All checks passed.\n'); process.exit(0);
}
main().catch((e) => { console.error('\npreflight crashed:', e.message); process.exit(2); });

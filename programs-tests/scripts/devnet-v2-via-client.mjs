// Proves the BROWSER code path on-chain: the exact tx builders the web-app
// ships (web-app/services/solana/vaultV2.ts) are bundled from source, fed the
// on-chain VaultV2Config, and driven through open_lock -> deposit -> claim on
// real devnet, with the completion voucher signed by the backend's real
// claimVoucher lib. If this passes, browser bytes == devnet-proven bytes.
//
// Usage: node programs-tests/scripts/devnet-v2-via-client.mjs
// Env (all optional):
//   DEVNET_RPC_URL             RPC endpoint       (default https://api.devnet.solana.com)
//   COURSE_ID                  course id string   (default client-path-proof-1)
//   DEVNET_AUTHORITY_KEYPAIR   JSON array secret key for the vault authority
//                              (default: read ~/.config/solana/id.json)
//   DEVNET_USER_KEYPAIR        JSON array secret key for the funded user wallet
//                              (default: read <repo>/.e2e/devnet-e2e.json)
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const webAppDir = path.join(repoRoot, 'web-app');

const RPC = process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const COURSE_ID = process.env.COURSE_ID || 'client-path-proof-1';
const DEPOSIT_ATOMIC = 2_000_000n; // 2 USDC
const VOUCHER_EXPIRY = 1_893_456_000; // 2030-01-01

// The module under test reads these at import time — set BEFORE importing.
process.env.NEXT_PUBLIC_VAULT_V2_PROGRAM_ID = PROGRAM_ID;
process.env.NEXT_PUBLIC_LOCK_VAULT_USDC_MINT = USDC_MINT;
process.env.NEXT_PUBLIC_SOLANA_RPC_URL = RPC;

// Use the web-app's OWN dependency copies so the bundle and this driver share
// classes; backend lib resolves its own deps (tweetnacl, bs58) from backend/.
const requireWebApp = createRequire(path.join(webAppDir, 'package.json'));
const requireBackend = createRequire(path.join(repoRoot, 'backend', 'package.json'));
const { Connection, Keypair } = requireWebApp('@solana/web3.js');
const { getAccount, getAssociatedTokenAddressSync } = requireWebApp('@solana/spl-token');
const bs58 = (() => { const b = requireBackend('bs58'); return b.decode ? b : b.default; })();
const esbuild = requireWebApp('esbuild');
const { issueVoucher } = await import(
  pathToFileURL(path.join(repoRoot, 'backend', 'src', 'lib', 'claimVoucher.mjs')).href
);

const loadKeypair = (envVar, fallbackPath) => {
  const raw = process.env[envVar] || readFileSync(fallbackPath, 'utf8');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
};
const authority = loadKeypair(
  'DEVNET_AUTHORITY_KEYPAIR',
  path.join(homedir(), '.config', 'solana', 'id.json'),
);
const user = loadKeypair('DEVNET_USER_KEYPAIR', path.join(repoRoot, '.e2e', 'devnet-e2e.json'));

// Bundle the REAL client module from source (esbuild inlines ./connection,
// leaves node_modules external, keeps process.env.* as runtime reads). The
// bundle lands inside web-app/ so its externals resolve to web-app deps.
const entry = path.join(webAppDir, 'services', 'solana', 'vaultV2.ts');
const bundlePath = path.join(webAppDir, 'services', 'solana', '.devnet-v2-client.bundle.mjs');
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: bundlePath,
  logLevel: 'silent',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Refresh blockhash, sign with the user wallet, send raw, confirm. Retries devnet flakes. */
async function signAndSend(conn, tx, signer, label) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = signer.publicKey;
      tx.sign(signer); // resets + re-signs
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      console.log(`${label}: ${sig}`);
      return sig;
    } catch (e) {
      lastErr = e;
      const logs = (await e.getLogs?.(conn).catch(() => null)) ?? e.logs;
      if (logs?.length) {
        // A real program error — retrying won't change the outcome. Surface logs.
        console.error(`${label} FAILED on-chain:`);
        for (const l of logs) console.error('  ' + l);
        throw e;
      }
      console.warn(`${label} attempt ${attempt} failed (${e.message}); retrying...`);
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

try {
  const conn = new Connection(RPC, 'confirmed');
  const v2 = await import(pathToFileURL(bundlePath).href);
  const owner = user.publicKey.toBase58();

  console.log('program  :', PROGRAM_ID);
  console.log('user     :', owner);
  console.log('course   :', COURSE_ID);

  // 1. Config straight from chain via the client reader.
  const config = await v2.readVaultV2Config();
  console.log('config   :', config.configAddress.toBase58(), config.paused ? '(PAUSED)' : '');
  if (config.authority.toBase58() !== authority.publicKey.toBase58()) {
    throw new Error(`vault authority ${config.authority.toBase58()} != local signer ${authority.publicKey.toBase58()}`);
  }

  const lockPda = await v2.deriveLockPda(owner, COURSE_ID);
  console.log('lock PDA :', lockPda.toBase58());
  const userUsdcAta = getAssociatedTokenAddressSync(config.usdcMint, user.publicKey);
  const usdcOf = async () => Number((await getAccount(conn, userUsdcAta)).amount);

  // 2. open_lock_v2 via the client builder (skip if the lock exists).
  let snapshot = await v2.readLockV2(owner, COURSE_ID);
  if (snapshot?.status === v2.LOCK_STATUS_CLOSED) {
    throw new Error(`lock for course '${COURSE_ID}' is CLOSED — rerun with a fresh COURSE_ID`);
  }
  if (!snapshot) {
    const openTx = await v2.buildOpenLockTransaction(owner, COURSE_ID, config);
    await signAndSend(conn, openTx, user, 'open_lock_v2 (client builder)');
  } else {
    console.log('lock exists (status', snapshot.status + ') — skipping open');
  }

  // 3. lock_funds_v2 via the client builder (skip if already ACTIVE).
  snapshot = await v2.readLockV2(owner, COURSE_ID);
  const beforeDeposit = await usdcOf();
  let depositSig = null;
  if (snapshot.status !== v2.LOCK_STATUS_ACTIVE) {
    const depositTx = await v2.buildDepositTransaction(owner, COURSE_ID, DEPOSIT_ATOMIC, config);
    depositSig = await signAndSend(conn, depositTx, user, 'lock_funds_v2 (client builder)');
  } else {
    console.log('lock already ACTIVE — skipping deposit');
  }
  snapshot = await v2.readLockV2(owner, COURSE_ID);
  console.log('lock after deposit:', JSON.stringify(snapshot));
  const afterDeposit = await usdcOf();

  // 4. Completion voucher signed by the REAL backend lib (bps 10000).
  const courseIdHash = await v2.hashCourseId(COURSE_ID);
  const voucher = issueVoucher({
    programId: PROGRAM_ID,
    authoritySecretKey: bs58.encode(authority.secretKey),
    owner,
    courseIdHash,
    lapseCount: 0, // -> bps 10000
    expiry: VOUCHER_EXPIRY,
  });
  console.log('voucher  : bps', voucher.bps, '| lock', voucher.lock);

  // 5. claim_v2 via the client builder (voucher precompile + claim).
  const claimTx = await v2.buildClaimTransaction(owner, COURSE_ID, voucher, config);
  const claimSig = await signAndSend(conn, claimTx, user, 'claim_v2 (client builder)');

  const afterClaim = await usdcOf();
  snapshot = await v2.readLockV2(owner, COURSE_ID);
  console.log('\nuser USDC:', beforeDeposit / 1e6, '->', afterDeposit / 1e6, '->', afterClaim / 1e6);
  console.log('lock after claim:', JSON.stringify(snapshot));
  if (snapshot && snapshot.status !== v2.LOCK_STATUS_CLOSED) {
    throw new Error('lock did not close after claim');
  }
  const returned = afterClaim - afterDeposit;
  console.log('returned on claim:', returned / 1e6, 'USDC (principal 2 + yield share)');
  // The mock reserve floors twice (shares = floor(amount/rate), redeem =
  // floor(shares*rate)), so a fast round trip can come back up to 2 atomic
  // units short of principal; settle() then pays min(redeemed, principal).
  // Anything below that tolerance is a real loss of funds.
  if (returned < Number(DEPOSIT_ATOMIC) - 2) {
    throw new Error(`claim returned ${returned} < principal ${DEPOSIT_ATOMIC} beyond rounding`);
  }
  console.log('\nCLIENT CODE PATH PROVEN ON DEVNET');
  console.log('deposit sig:', depositSig ?? '(skipped — pre-existing ACTIVE lock)');
  console.log('claim sig  :', claimSig);
} finally {
  try { unlinkSync(bundlePath); } catch { /* already gone */ }
}

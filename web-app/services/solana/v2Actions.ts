import { Buffer } from 'buffer';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey, type Transaction } from '@solana/web3.js';
import { connection } from './connection';
import {
  buildClaimTransaction,
  buildDepositTransaction,
  buildOpenLockTransaction,
  deriveLockPda,
  getUsdcMint,
  readLockV2,
  readVaultV2Config,
  LOCK_STATUS_ACTIVE,
} from './vaultV2';
import type { CompletionVoucher } from './vaultV2';

// The single build+sign+send+confirm seam for v2 money actions. Pages pass the
// Privy signer in (hooks stay in components); e2e swaps the whole execution
// via a localhost-gated stub so the real success UI renders without a wallet.

export type V2ActionPhase =
  | 'building'
  | 'awaiting-signature'
  | 'sending'
  | 'confirming'
  | 'success'
  | 'error';

export interface V2Signer {
  signTransaction: (args: {
    transaction: Uint8Array;
    wallet: unknown;
  }) => Promise<{ signedTransaction: Uint8Array }>;
  wallet: unknown;
}

export interface V2ActionResult {
  signature: string;
  receivedUi: string | null; // USDC ATA delta (claim); null when unreadable
  lockAddress?: string; // set by deposits
  alreadyLocked?: boolean; // deposit found the lock already ACTIVE (no-op)
}

interface TxStub {
  execute: (kind: 'claim' | 'deposit', meta: Record<string, unknown>) => Promise<V2ActionResult>;
}

// e2e stub: active ONLY when the build opted in AND we're on localhost AND the
// test installed window.__lockedInTxStub. Prod builds never set the env flag.
function getTxStub(): TxStub | null {
  if (process.env.NEXT_PUBLIC_E2E_TX_STUB !== '1') return null;
  if (typeof window === 'undefined') return null;
  const { hostname } = window.location;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') return null;
  const stub = (window as unknown as { __lockedInTxStub?: TxStub }).__lockedInTxStub;
  return stub ?? null;
}

// Confirm via HTTP polling (no WebSockets — e2e mocks HTTP only, and the WS
// confirm path hangs for 30-60s against unreachable endpoints).
async function confirmByPolling(signature: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Transaction confirmation timed out.');
}

// Balance reads use the env mint while the tx builders use the on-chain
// config.usdcMint; a stale env after a cluster migration would silently read
// the wrong ATA. Assert they agree before moving money (audit L5).
function assertConfigMintMatchesEnv(config: { usdcMint: PublicKey }): void {
  if (!config.usdcMint.equals(getUsdcMint())) {
    throw new Error(
      'Configuration error: the vault USDC mint does not match NEXT_PUBLIC_LOCK_VAULT_USDC_MINT.',
    );
  }
}

async function readUsdcBalance(owner: string): Promise<bigint | null> {
  try {
    const ata = getAssociatedTokenAddressSync(getUsdcMint(), new PublicKey(owner));
    const { value } = await connection.getTokenAccountBalance(ata);
    return BigInt(value.amount);
  } catch {
    return null;
  }
}

function formatAtomicUi(atomic: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = atomic / base;
  const frac = atomic % base;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

async function signSendConfirm(
  transaction: Transaction,
  owner: string,
  signer: V2Signer,
  onPhase: (phase: V2ActionPhase) => void,
): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = new PublicKey(owner);

  onPhase('awaiting-signature');
  const txBytes = transaction.serialize({ requireAllSignatures: false });
  const { signedTransaction } = await signer.signTransaction({
    transaction: txBytes,
    wallet: signer.wallet,
  });

  onPhase('sending');
  const signature = await connection.sendRawTransaction(Buffer.from(signedTransaction), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  onPhase('confirming');
  await confirmByPolling(signature);
  return signature;
}

/**
 * Claim: redeem the lock via the backend voucher. Returns the tx signature and
 * the exact USDC received (ATA delta), for the success breakdown.
 */
export async function executeClaim(
  owner: string,
  courseId: string,
  voucher: CompletionVoucher,
  signer: V2Signer,
  onPhase: (phase: V2ActionPhase) => void = () => {},
): Promise<V2ActionResult> {
  const stub = getTxStub();
  if (stub) {
    onPhase('building');
    onPhase('awaiting-signature');
    onPhase('confirming');
    const result = await stub.execute('claim', { courseId, voucher });
    onPhase('success');
    return result;
  }

  onPhase('building');
  const config = await readVaultV2Config();
  assertConfigMintMatchesEnv(config);
  // NOTE: claims are intentionally NOT gated on config.paused — a paused vault
  // must still let users redeem (set_config_v2 never pauses claim_v2).
  const before = await readUsdcBalance(owner);
  const tx = await buildClaimTransaction(owner, courseId, voucher, config);

  const signature = await signSendConfirm(tx, owner, signer, onPhase);

  const after = await readUsdcBalance(owner);
  const receivedUi =
    before != null && after != null && after > before ? formatAtomicUi(after - before) : null;
  onPhase('success');
  return { signature, receivedUi };
}

/**
 * Deposit: open the lock (if absent) then CPI-deposit. Two transactions by
 * on-chain design (BPF stack limit); both run inside this one call.
 */
export async function executeDeposit(
  owner: string,
  courseId: string,
  amountUi: string,
  signer: V2Signer,
  onPhase: (phase: V2ActionPhase) => void = () => {},
): Promise<V2ActionResult> {
  const stub = getTxStub();
  if (stub) {
    onPhase('building');
    onPhase('awaiting-signature');
    onPhase('confirming');
    const result = await stub.execute('deposit', { courseId, amountUi });
    onPhase('success');
    return result;
  }

  onPhase('building');
  const config = await readVaultV2Config();
  assertConfigMintMatchesEnv(config);
  // Fail before prompting a signature if the vault is paused (audit L7) — the
  // on-chain deposit would revert anyway and surface as a false "tx failed".
  if (config.paused) {
    throw new Error('Deposits are temporarily paused. Please try again later.');
  }
  const [whole = '0', frac = ''] = amountUi.trim().split('.');
  if (frac.length > 6) throw new Error('Amount supports at most 6 decimal places');
  const atomic = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0') || '0');

  // Branch on lock STATUS, not mere existence. An already-ACTIVE lock means the
  // funds are locked — re-sending lock_funds_v2 would just fail on-chain and
  // surface a false "transaction failed", so treat it as already done.
  const lock = await readLockV2(owner, courseId);
  const lockPda = await deriveLockPda(owner, courseId);
  if (lock?.status === LOCK_STATUS_ACTIVE) {
    onPhase('success');
    return { signature: '', receivedUi: null, lockAddress: lockPda.toBase58(), alreadyLocked: true };
  }

  // 1. open_lock_v2 — skip when the lock account already exists (PENDING).
  if (!lock) {
    const openTx = await buildOpenLockTransaction(owner, courseId, config);
    await signSendConfirm(openTx, owner, signer, onPhase);
  }

  // 2. lock_funds_v2 — the CPI deposit.
  onPhase('building');
  const depositTx = await buildDepositTransaction(owner, courseId, atomic, config);
  const signature = await signSendConfirm(depositTx, owner, signer, onPhase);

  onPhase('success');
  return { signature, receivedUi: null, lockAddress: lockPda.toBase58() };
}

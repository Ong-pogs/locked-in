import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import {
  VOUCHER_DOMAIN, VALID_YIELD_BPS, yieldBpsForLapses, deriveLockPda,
  buildVoucherMessage, issueVoucher,
} from '../../../src/lib/claimVoucher.mjs';

const PROGRAM = 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN';
const LOCK = '8S5ja1JUwVDzUvfiwYbcoaxN6HxKx3FwKJZkMUmtrQZT';

describe('yieldBpsForLapses (one-mercy)', () => {
  it('maps lapse count to the exact settle.rs tiers', () => {
    expect(yieldBpsForLapses(0)).toBe(10_000);
    expect(yieldBpsForLapses(1)).toBe(5_000);
    expect(yieldBpsForLapses(2)).toBe(0);
    expect(yieldBpsForLapses(9)).toBe(0);
    expect(yieldBpsForLapses(undefined)).toBe(10_000);
  });
  it('only ever returns a VALID_YIELD_BPS value', () => {
    for (let n = 0; n < 5; n += 1) expect(VALID_YIELD_BPS).toContain(yieldBpsForLapses(n));
  });
});

describe('buildVoucherMessage layout (must match voucher.rs::build_message)', () => {
  it('is exactly 91 bytes with the right field offsets', () => {
    const msg = buildVoucherMessage(PROGRAM, LOCK, 5_000, 1_800_000_000);
    expect(msg.length).toBe(91);
    // domain 0..17
    expect(msg.subarray(0, 17).toString('utf8')).toBe(VOUCHER_DOMAIN);
    // program_id 17..49
    expect(msg.subarray(17, 49).equals(new PublicKey(PROGRAM).toBuffer())).toBe(true);
    // lock 49..81
    expect(msg.subarray(49, 81).equals(new PublicKey(LOCK).toBuffer())).toBe(true);
    // bps 81..83 (u16 LE)
    expect(msg.readUInt16LE(81)).toBe(5_000);
    // expiry 83..91 (i64 LE)
    expect(msg.readBigInt64LE(83)).toBe(1_800_000_000n);
  });

  it('changes for every bound field', () => {
    const base = buildVoucherMessage(PROGRAM, LOCK, 10_000, 1).toString('hex');
    expect(buildVoucherMessage(PROGRAM, LOCK, 5_000, 1).toString('hex')).not.toBe(base);
    expect(buildVoucherMessage(PROGRAM, LOCK, 10_000, 2).toString('hex')).not.toBe(base);
  });

  it('rejects a bps outside the allowed set', () => {
    expect(() => buildVoucherMessage(PROGRAM, LOCK, 7_000, 1)).toThrow();
  });
});

describe('deriveLockPda', () => {
  it('is deterministic and rejects a wrong-length hash', () => {
    const owner = new PublicKey('9wtYy32vK3hxQeFpWLGXYGRZevEXYQQKYGA3vW2nWLxw');
    const hash = new Uint8Array(32).fill(7);
    const a = deriveLockPda(PROGRAM, owner, hash);
    const b = deriveLockPda(PROGRAM, owner, hash);
    expect(a.toBase58()).toBe(b.toBase58());
    expect(() => deriveLockPda(PROGRAM, owner, new Uint8Array(31))).toThrow();
  });
});

describe('issueVoucher', () => {
  it('produces a signature that verifies against the derived authority pubkey', () => {
    const kp = nacl.sign.keyPair();
    const secretB58 = bs58.encode(kp.secretKey);
    const courseHash = new Uint8Array(32).fill(3);

    const v = issueVoucher({
      programId: PROGRAM, authoritySecretKey: secretB58,
      owner: '9wtYy32vK3hxQeFpWLGXYGRZevEXYQQKYGA3vW2nWLxw',
      courseIdHash: courseHash, lapseCount: 1, expiry: 1_900_000_000,
    });

    expect(v.bps).toBe(5_000);
    expect(v.authorityPubkey).toBe(new PublicKey(kp.publicKey).toBase58());

    const message = Buffer.from(v.message, 'base64');
    const signature = Buffer.from(v.signature, 'base64');
    // The exact check the Ed25519 precompile performs on-chain.
    expect(nacl.sign.detached.verify(message, signature, kp.publicKey)).toBe(true);
    // A tampered bps must break verification.
    const tampered = Buffer.from(message);
    tampered.writeUInt16LE(0, 81);
    expect(nacl.sign.detached.verify(tampered, signature, kp.publicKey)).toBe(false);
  });
});

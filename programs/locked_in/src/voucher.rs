//! Completion vouchers — Ed25519 signatures verified via the precompile.
//!
//! `claim` needs proof that the backend judged a course complete, and at what
//! yield tier, without an on-chain attestation instruction: an attestation
//! queue that stalls would let `force_return` sweep a finished user's yield to
//! the pot, and a paused program could block attestation and strand them.
//!
//! The backend signs `build_message(..)` with the vault's ops key. The client
//! puts an Ed25519 precompile instruction carrying (pubkey, message, signature)
//! in the same transaction as `claim`, and `claim` reads it back out of the
//! instructions sysvar.
//!
//! The voucher is user-favorable by construction: it can only ever let an owner
//! take yield they already earned. It never moves principal, and refusing to
//! issue one merely delays the owner to `force_return`, where principal returns
//! in full.
//!
//! Forgery surface, in the order it is checked below:
//!   * a non-precompile instruction masquerading as one,
//!   * `*_instruction_index != u16::MAX`, which makes the precompile read its
//!     public key or message out of a DIFFERENT instruction that the attacker
//!     controls while this program reads the bytes it expects,
//!   * offsets that run past the end of the instruction data,
//!   * a valid signature by the wrong key, over the wrong lock, or expired.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};

/// The Ed25519 signature-verification precompile.
pub const ED25519_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!("Ed25519SigVerify111111111111111111111111111");

/// Domain separator: a signature over one of our messages can never be replayed
/// as a signature over some other protocol's payload, and vice versa.
pub const VOUCHER_DOMAIN: &[u8] = b"lockedin:claim:v1";

/// The only tiers a voucher may authorize: no lapse, one lapse, two-or-more.
pub const VALID_YIELD_BPS: [u16; 3] = [10_000, 5_000, 0];

/// Mirrors `solana_sdk::ed25519_instruction`. The offsets header is 7 x u16
/// starting at byte 2, after `num_signatures: u8` and one padding byte.
const SIGNATURE_OFFSETS_START: usize = 2;
const SIGNATURE_OFFSETS_SERIALIZED_SIZE: usize = 14;
const PUBKEY_SERIALIZED_SIZE: usize = 32;

pub fn build_message(program_id: &Pubkey, lock: &Pubkey, user_yield_bps: u16, expiry: i64) -> Vec<u8> {
    let mut message = Vec::with_capacity(VOUCHER_DOMAIN.len() + 32 + 32 + 2 + 8);
    message.extend_from_slice(VOUCHER_DOMAIN);
    message.extend_from_slice(program_id.as_ref());
    message.extend_from_slice(lock.as_ref());
    message.extend_from_slice(&user_yield_bps.to_le_bytes());
    message.extend_from_slice(&expiry.to_le_bytes());
    message
}

fn read_u16(data: &[u8], offset: usize) -> Option<u16> {
    let bytes = data.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([bytes[0], bytes[1]]))
}

/// Does this Ed25519 precompile instruction carry a single, self-contained
/// signature by `expected_signer` over exactly `expected_message`?
///
/// Returns `false` (never errors) for anything malformed, so a decoy precompile
/// instruction placed before the real one merely fails to match and the scan
/// continues, rather than aborting the whole claim.
fn precompile_matches(data: &[u8], expected_signer: &Pubkey, expected_message: &[u8]) -> bool {
    if data.len() < SIGNATURE_OFFSETS_START + SIGNATURE_OFFSETS_SERIALIZED_SIZE {
        return false;
    }
    // Exactly one signature, plus the padding byte the precompile writes.
    if data[0] != 1 || data[1] != 0 {
        return false;
    }

    let field = |i: usize| read_u16(data, SIGNATURE_OFFSETS_START + i);
    let (Some(sig_ix), Some(pk_off), Some(pk_ix), Some(msg_off), Some(msg_size), Some(msg_ix)) =
        (field(2), field(4), field(6), field(8), field(10), field(12))
    else {
        return false;
    };

    // Every field must live inside THIS instruction. A non-MAX index would make
    // the precompile verify bytes from a DIFFERENT instruction the attacker
    // controls, while we inspect the bytes we expect.
    if sig_ix != u16::MAX || pk_ix != u16::MAX || msg_ix != u16::MAX {
        return false;
    }

    let pk_off = pk_off as usize;
    let msg_off = msg_off as usize;
    let msg_size = msg_size as usize;

    let Some(signer_bytes) = data.get(pk_off..pk_off + PUBKEY_SERIALIZED_SIZE) else {
        return false;
    };
    if signer_bytes != expected_signer.as_ref() {
        return false;
    }

    if msg_size != expected_message.len() {
        return false;
    }
    match data.get(msg_off..msg_off + msg_size) {
        Some(signed) => signed == expected_message,
        None => false,
    }
}

/// Verify the transaction carries an Ed25519 precompile instruction (anywhere
/// before `claim`) that signs exactly
/// `build_message(program_id, lock, user_yield_bps, expiry)` under
/// `expected_signer`.
///
/// The precompile's absolute index is NOT fixed and must never be hardcoded:
/// callers prepend a compute-budget instruction and `refresh_reserve` before
/// `claim`. We scan every instruction ahead of the current one. Scanning is safe
/// because the message is bound to program+lock+bps+expiry and the signer must
/// equal the vault authority, so a decoy precompile cannot help an attacker —
/// it simply fails to match and the scan continues.
pub fn verify_voucher(
    instructions_sysvar: &AccountInfo,
    expected_signer: &Pubkey,
    program_id: &Pubkey,
    lock: &Pubkey,
    user_yield_bps: u16,
    expiry: i64,
    now: i64,
) -> Result<()> {
    require!(
        VALID_YIELD_BPS.contains(&user_yield_bps),
        VoucherError::InvalidYieldBps
    );
    require!(now <= expiry, VoucherError::VoucherExpired);

    let expected_message = build_message(program_id, lock, user_yield_bps, expiry);
    let current_index = load_current_index_checked(instructions_sysvar)?;

    let mut saw_ed25519 = false;
    for index in 0..current_index {
        let ix = load_instruction_at_checked(index as usize, instructions_sysvar)?;
        if ix.program_id != ED25519_PROGRAM_ID {
            continue;
        }
        saw_ed25519 = true;
        if precompile_matches(&ix.data, expected_signer, &expected_message) {
            return Ok(());
        }
    }

    // Distinguish "no voucher at all" from "a voucher that did not authorize
    // this claim" so the client can tell a missing precompile from a stale one.
    if saw_ed25519 {
        Err(VoucherError::VoucherWrongMessage.into())
    } else {
        Err(VoucherError::VoucherNotEd25519.into())
    }
}

#[error_code]
pub enum VoucherError {
    #[msg("Voucher authorizes a yield tier that does not exist.")]
    InvalidYieldBps,
    #[msg("Voucher has expired.")]
    VoucherExpired,
    #[msg("No ed25519 precompile instruction accompanies this claim.")]
    VoucherNotEd25519,
    #[msg("No voucher authorizes this lock, program, tier, and expiry.")]
    VoucherWrongMessage,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_is_domain_separated_and_fully_bound() {
        let program_id = Pubkey::new_unique();
        let lock = Pubkey::new_unique();
        let message = build_message(&program_id, &lock, 5_000, 1_800_000_000);

        assert_eq!(message.len(), 17 + 32 + 32 + 2 + 8);
        assert!(message.starts_with(VOUCHER_DOMAIN));
        assert_eq!(&message[17..49], program_id.as_ref());
        assert_eq!(&message[49..81], lock.as_ref());
        assert_eq!(&message[81..83], &5_000u16.to_le_bytes());
        assert_eq!(&message[83..91], &1_800_000_000i64.to_le_bytes());
    }

    #[test]
    fn message_differs_across_every_bound_field() {
        let program_id = Pubkey::new_unique();
        let other_program = Pubkey::new_unique();
        let lock = Pubkey::new_unique();
        let other_lock = Pubkey::new_unique();

        let base = build_message(&program_id, &lock, 10_000, 1);
        assert_ne!(base, build_message(&other_program, &lock, 10_000, 1));
        assert_ne!(base, build_message(&program_id, &other_lock, 10_000, 1));
        assert_ne!(base, build_message(&program_id, &lock, 5_000, 1));
        assert_ne!(base, build_message(&program_id, &lock, 10_000, 2));
    }

    // Pins the layout against solana_sdk::ed25519_instruction, which places the
    // offsets header at byte 2 and serializes it as 7 little-endian u16s.
    #[test]
    fn offsets_header_layout_matches_the_precompile() {
        assert_eq!(SIGNATURE_OFFSETS_START, 2);
        assert_eq!(SIGNATURE_OFFSETS_SERIALIZED_SIZE, 14);

        let mut data = vec![1u8, 0];
        for field in [64u16, u16::MAX, 16, u16::MAX, 112, 91, u16::MAX] {
            data.extend_from_slice(&field.to_le_bytes());
        }

        assert_eq!(read_u16(&data, SIGNATURE_OFFSETS_START).unwrap(), 64);
        assert_eq!(read_u16(&data, SIGNATURE_OFFSETS_START + 2).unwrap(), u16::MAX);
        assert_eq!(read_u16(&data, SIGNATURE_OFFSETS_START + 4).unwrap(), 16);
        assert_eq!(read_u16(&data, SIGNATURE_OFFSETS_START + 6).unwrap(), u16::MAX);
        assert_eq!(read_u16(&data, SIGNATURE_OFFSETS_START + 8).unwrap(), 112);
        assert_eq!(read_u16(&data, SIGNATURE_OFFSETS_START + 10).unwrap(), 91);
        assert_eq!(read_u16(&data, SIGNATURE_OFFSETS_START + 12).unwrap(), u16::MAX);
    }

    #[test]
    fn read_u16_returns_none_past_the_end() {
        let data = vec![1u8, 0, 5];
        assert!(read_u16(&data, 2).is_none());
    }

    // Builds an ed25519 precompile instruction data blob exactly as
    // solana_sdk::ed25519_instruction::new_ed25519_instruction lays it out.
    fn build_precompile_data(signer: &Pubkey, message: &[u8]) -> Vec<u8> {
        const OFFSETS: usize = 14;
        let mut data = vec![1u8, 0]; // num_signatures, padding
        let pk_off = SIGNATURE_OFFSETS_START + OFFSETS; // 16
        let sig_off = pk_off + PUBKEY_SERIALIZED_SIZE; // 48
        let msg_off = sig_off + 64; // 112
        for f in [
            sig_off as u16,
            u16::MAX,
            pk_off as u16,
            u16::MAX,
            msg_off as u16,
            message.len() as u16,
            u16::MAX,
        ] {
            data.extend_from_slice(&f.to_le_bytes());
        }
        data.extend_from_slice(signer.as_ref()); // public key
        data.extend_from_slice(&[0u8; 64]); // signature (bytes irrelevant to us)
        data.extend_from_slice(message);
        data
    }

    #[test]
    fn precompile_matches_a_well_formed_voucher() {
        let program = Pubkey::new_unique();
        let lock = Pubkey::new_unique();
        let signer = Pubkey::new_unique();
        let msg = build_message(&program, &lock, 5_000, 1_800_000_000);
        let data = build_precompile_data(&signer, &msg);
        assert!(precompile_matches(&data, &signer, &msg));
    }

    #[test]
    fn precompile_rejects_wrong_signer_and_wrong_message() {
        let program = Pubkey::new_unique();
        let lock = Pubkey::new_unique();
        let signer = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let msg = build_message(&program, &lock, 5_000, 1_800_000_000);
        let data = build_precompile_data(&signer, &msg);

        assert!(!precompile_matches(&data, &other, &msg), "wrong signer");
        let other_msg = build_message(&program, &lock, 0, 1_800_000_000);
        assert!(!precompile_matches(&data, &signer, &other_msg), "wrong tier");
    }

    #[test]
    fn precompile_rejects_indirect_data_forgery() {
        let program = Pubkey::new_unique();
        let lock = Pubkey::new_unique();
        let signer = Pubkey::new_unique();
        let msg = build_message(&program, &lock, 10_000, 1_800_000_000);
        let mut data = build_precompile_data(&signer, &msg);
        // Point the message at another instruction (index 0 instead of u16::MAX):
        // the precompile would verify someone else's bytes.
        data[SIGNATURE_OFFSETS_START + 12] = 0;
        data[SIGNATURE_OFFSETS_START + 13] = 0;
        assert!(!precompile_matches(&data, &signer, &msg));
    }

    #[test]
    fn precompile_rejects_multi_signature_and_truncation() {
        let signer = Pubkey::new_unique();
        let msg = build_message(&Pubkey::new_unique(), &Pubkey::new_unique(), 0, 1);
        let mut data = build_precompile_data(&signer, &msg);
        let good = data.clone();
        data[0] = 2; // claims two signatures
        assert!(!precompile_matches(&data, &signer, &msg));
        assert!(!precompile_matches(&good[..10], &signer, &msg)); // truncated header
    }

    #[test]
    fn only_the_three_real_tiers_are_valid() {
        assert!(VALID_YIELD_BPS.contains(&10_000));
        assert!(VALID_YIELD_BPS.contains(&5_000));
        assert!(VALID_YIELD_BPS.contains(&0));
        assert!(!VALID_YIELD_BPS.contains(&7_000));
        assert!(!VALID_YIELD_BPS.contains(&9_999));
    }
}

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

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = data
        .get(offset..offset + 2)
        .ok_or(VoucherError::VoucherBadOffsets)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

/// Verify that the transaction carries a precompile instruction signing exactly
/// `build_message(program_id, lock, user_yield_bps, expiry)` under `expected_signer`.
///
/// `instructions_sysvar` must be the instructions sysvar account. The precompile
/// instruction must immediately precede the currently-executing instruction —
/// callers prepend `refresh_reserve` and a compute-budget instruction, so its
/// absolute index is not fixed and must never be hardcoded.
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

    let current_index = load_current_index_checked(instructions_sysvar)?;
    let voucher_index = current_index
        .checked_sub(1)
        .ok_or(VoucherError::VoucherNotEd25519)?;
    let ix = load_instruction_at_checked(voucher_index as usize, instructions_sysvar)?;

    require_keys_eq!(ix.program_id, ED25519_PROGRAM_ID, VoucherError::VoucherNotEd25519);

    let data = ix.data.as_slice();
    require!(
        data.len() >= SIGNATURE_OFFSETS_START + SIGNATURE_OFFSETS_SERIALIZED_SIZE,
        VoucherError::VoucherBadHeader
    );
    // Exactly one signature, and the padding byte the precompile writes.
    require!(data[0] == 1 && data[1] == 0, VoucherError::VoucherBadHeader);

    let signature_instruction_index = read_u16(data, SIGNATURE_OFFSETS_START + 2)?;
    let public_key_offset = read_u16(data, SIGNATURE_OFFSETS_START + 4)? as usize;
    let public_key_instruction_index = read_u16(data, SIGNATURE_OFFSETS_START + 6)?;
    let message_data_offset = read_u16(data, SIGNATURE_OFFSETS_START + 8)? as usize;
    let message_data_size = read_u16(data, SIGNATURE_OFFSETS_START + 10)? as usize;
    let message_instruction_index = read_u16(data, SIGNATURE_OFFSETS_START + 12)?;

    // Every field must live inside THIS instruction. Otherwise the precompile
    // verifies bytes we never inspect, and we inspect bytes it never verified.
    require!(
        signature_instruction_index == u16::MAX
            && public_key_instruction_index == u16::MAX
            && message_instruction_index == u16::MAX,
        VoucherError::VoucherIndirectData
    );

    let signer_bytes = data
        .get(public_key_offset..public_key_offset + PUBKEY_SERIALIZED_SIZE)
        .ok_or(VoucherError::VoucherBadOffsets)?;
    require!(
        signer_bytes == expected_signer.as_ref(),
        VoucherError::VoucherWrongSigner
    );

    let expected_message = build_message(program_id, lock, user_yield_bps, expiry);
    require!(
        message_data_size == expected_message.len(),
        VoucherError::VoucherWrongMessage
    );
    let signed_message = data
        .get(message_data_offset..message_data_offset + message_data_size)
        .ok_or(VoucherError::VoucherBadOffsets)?;
    require!(
        signed_message == expected_message.as_slice(),
        VoucherError::VoucherWrongMessage
    );

    Ok(())
}

#[error_code]
pub enum VoucherError {
    #[msg("Voucher authorizes a yield tier that does not exist.")]
    InvalidYieldBps,
    #[msg("Voucher has expired.")]
    VoucherExpired,
    #[msg("The instruction preceding claim is not the ed25519 precompile.")]
    VoucherNotEd25519,
    #[msg("Ed25519 instruction header is malformed or signs more than one message.")]
    VoucherBadHeader,
    #[msg("Ed25519 instruction sources its data from another instruction.")]
    VoucherIndirectData,
    #[msg("Ed25519 instruction offsets fall outside its data.")]
    VoucherBadOffsets,
    #[msg("Voucher was signed by the wrong key.")]
    VoucherWrongSigner,
    #[msg("Voucher does not authorize this lock, program, tier, or expiry.")]
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
    fn read_u16_refuses_to_run_past_the_end() {
        let data = vec![1u8, 0, 5];
        assert!(read_u16(&data, 2).is_err());
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

//! Settlement arithmetic — how a redeemed position splits into owner / pot / fee.
//!
//! This is the module the first audit broke (CRIT-1). The invariant that keeps
//! a lock un-brickable lives in the CALLER, not here: the caller must redeem the
//! LIVE collateral-ATA balance and pass the FULL post-redeem liquidity balance
//! as `redeemed`, then pay out exactly `to_owner + to_pot + fee` so both token
//! accounts reach zero before `close_account`. This function guarantees that sum
//! equals `redeemed` for every input, so a token donation is split like yield
//! and can never strand a lock.
//!
//! Yield floor: if Kamino returns less than principal (socialized loss), the
//! owner absorbs the shortfall and the pot is never asked to fund a loss.

use anchor_lang::prelude::*;

/// Basis-point denominator.
pub const BPS_DENOMINATOR: u64 = 10_000;

/// A voucher / force_return may only ever authorize one of these tiers.
pub const VALID_YIELD_BPS: [u16; 3] = [10_000, 5_000, 0];

/// Hard ceiling on the platform fee, enforced at config time. 0 in beta.
pub const MAX_PLATFORM_FEE_BPS: u16 = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SettleAmounts {
    pub to_owner: u64,
    pub to_pot: u64,
    pub fee: u64,
}

/// Split `redeemed` given the lock's `principal`, the voucher's `user_yield_bps`,
/// and the configured `platform_fee_bps`.
///
/// * `gross_yield = redeemed - principal` (0 when the position lost value)
/// * `fee = gross_yield * fee_bps / 10_000` (from yield only, never principal)
/// * `user_yield = (gross_yield - fee) * user_yield_bps / 10_000`
/// * `to_owner = min(redeemed, principal) + user_yield`
/// * `to_pot = gross_yield - fee - user_yield` (subtractive: rounding dust to pot)
///
/// Guarantees `to_owner + to_pot + fee == redeemed` for all inputs.
pub fn settle(redeemed: u64, principal: u64, user_yield_bps: u16, fee_bps: u16) -> Result<SettleAmounts> {
    require!(
        VALID_YIELD_BPS.contains(&user_yield_bps),
        SettleError::InvalidYieldBps
    );
    require!(fee_bps <= MAX_PLATFORM_FEE_BPS, SettleError::FeeAboveHardMax);

    // Socialized loss: return everything to the owner, pot funds no loss.
    if redeemed <= principal {
        return Ok(SettleAmounts { to_owner: redeemed, to_pot: 0, fee: 0 });
    }

    let gross_yield = redeemed - principal; // safe: redeemed > principal here

    let fee = mul_div_floor(gross_yield, fee_bps as u64, BPS_DENOMINATOR)?;
    let yield_after_fee = gross_yield
        .checked_sub(fee)
        .ok_or(SettleError::NumericalOverflow)?;
    let user_yield = mul_div_floor(yield_after_fee, user_yield_bps as u64, BPS_DENOMINATOR)?;

    let to_owner = principal
        .checked_add(user_yield)
        .ok_or(SettleError::NumericalOverflow)?;
    let to_pot = gross_yield
        .checked_sub(fee)
        .and_then(|v| v.checked_sub(user_yield))
        .ok_or(SettleError::NumericalOverflow)?;

    Ok(SettleAmounts { to_owner, to_pot, fee })
}

fn mul_div_floor(value: u64, numerator: u64, denominator: u64) -> Result<u64> {
    let product = (value as u128)
        .checked_mul(numerator as u128)
        .ok_or(SettleError::NumericalOverflow)?;
    Ok((product / denominator as u128) as u64)
}

#[error_code]
pub enum SettleError {
    #[msg("A checked arithmetic operation overflowed.")]
    NumericalOverflow,
    #[msg("Yield tier must be one of the allowed values.")]
    InvalidYieldBps,
    #[msg("Platform fee exceeds the hard maximum.")]
    FeeAboveHardMax,
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: u64 = 50_000_000; // $50 principal

    fn s(redeemed: u64, bps: u16, fee: u16) -> SettleAmounts {
        settle(redeemed, P, bps, fee).unwrap()
    }

    #[test]
    fn conserves_value_for_every_tier_and_fee() {
        for redeemed in [P, P + 1, P + 1_200_000, P + 999, 60_000_000, P.saturating_sub(1_000_000)] {
            for bps in VALID_YIELD_BPS {
                for fee in [0u16, 500, 1000, 2000] {
                    let a = settle(redeemed, P, bps, fee).unwrap();
                    assert_eq!(
                        a.to_owner + a.to_pot + a.fee,
                        redeemed,
                        "redeemed={redeemed} bps={bps} fee={fee}"
                    );
                }
            }
        }
    }

    #[test]
    fn no_lapse_keeps_all_yield() {
        let a = s(51_200_000, 10_000, 0);
        assert_eq!(a, SettleAmounts { to_owner: 51_200_000, to_pot: 0, fee: 0 });
    }

    #[test]
    fn one_mercy_halves_yield_to_pot() {
        let a = s(51_200_000, 5_000, 0);
        assert_eq!(a, SettleAmounts { to_owner: 50_600_000, to_pot: 600_000, fee: 0 });
    }

    #[test]
    fn two_lapses_forfeit_all_yield() {
        let a = s(51_200_000, 0, 0);
        assert_eq!(a, SettleAmounts { to_owner: P, to_pot: 1_200_000, fee: 0 });
    }

    #[test]
    fn negative_yield_passes_through_to_owner() {
        let a = s(49_000_000, 10_000, 500);
        assert_eq!(a, SettleAmounts { to_owner: 49_000_000, to_pot: 0, fee: 0 });
    }

    #[test]
    fn exactly_principal_is_a_no_yield_noop() {
        let a = s(P, 10_000, 1000);
        assert_eq!(a, SettleAmounts { to_owner: P, to_pot: 0, fee: 0 });
    }

    #[test]
    fn fee_only_ever_touches_yield() {
        let a = s(51_000_000, 10_000, 1_000); // 10% fee on $1.00 yield
        assert_eq!(a.fee, 100_000);
        assert_eq!(a.to_owner, 50_900_000);
        assert_eq!(a.to_pot, 0);
    }

    #[test]
    fn donation_is_split_never_stranded() {
        // Attacker donates $10 into the liquidity ATA before claim.
        // Whatever the tier, the donation flows through the split and the sum
        // still equals `redeemed`, so both ATAs reach zero and close succeeds.
        let a = s(60_000_000, 0, 0);
        assert_eq!(a.to_owner, P);
        assert_eq!(a.to_pot, 10_000_000);
        assert_eq!(a.to_owner + a.to_pot + a.fee, 60_000_000);
    }

    #[test]
    fn rounding_dust_falls_to_the_pot_not_the_owner() {
        // $0.00003 of yield at a 50% tier: 30 * 0.5 = 15 exact, but pick an odd
        // number to force a floor. 3 base units at 5000 bps -> user 1, pot 2.
        let a = settle(P + 3, P, 5_000, 0).unwrap();
        assert_eq!(a.to_owner, P + 1);
        assert_eq!(a.to_pot, 2);
        assert_eq!(a.fee, 0);
    }

    #[test]
    fn rejects_invalid_tier() {
        assert!(settle(51_000_000, P, 7_000, 0).is_err());
        assert!(settle(51_000_000, P, 9_999, 0).is_err());
    }

    #[test]
    fn rejects_fee_above_hard_max() {
        assert!(settle(51_000_000, P, 10_000, 2_001).is_err());
    }

    #[test]
    fn survives_extreme_values() {
        let a = settle(u64::MAX, 1, 10_000, 2_000).unwrap();
        assert_eq!(a.to_owner + a.to_pot + a.fee, u64::MAX);
    }
}

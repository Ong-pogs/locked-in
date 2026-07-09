//! Deposit caps, the live TVL counter, and the absolute exit deadline.
//!
//! These are the on-chain guardrails for the unaudited beta. The caps bound the
//! blast radius; the TVL counter must stay equal to the sum of active-lock
//! principals (spec invariant 3); the deadline is anchored to `lock_start_ts`
//! and NO instruction may push it, so `force_return` is always eventually
//! available and a hostile authority can never trap principal (spec invariant 1).
//!
//! Pure logic, unit-tested in isolation. Task 1 wires these onto `VaultConfig`
//! and `LockAccount`; the CPI-bearing handlers come later. Kept additive so the
//! existing v1 custody tests keep passing until the full v2 swap lands.

use anchor_lang::prelude::*;

/// 180 days from `lock_start_ts`. After this, anyone may `force_return` an
/// unclaimed lock. Not "90 days of inactivity" — see the design note in the
/// spec: an activity-relative clock needs an authority-signed heartbeat, and a
/// hostile authority could bump it forever. A fixed deadline is the price of an
/// exit guarantee that holds even against a malicious backend.
pub const FORCE_RETURN_AFTER_SECS: i64 = 15_552_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caps {
    pub min_principal: u64,
    pub max_principal_per_lock: u64,
    pub global_tvl_cap: u64,
}

impl Caps {
    /// Beta defaults: $10 min, $50 max/lock, $1,000 global (6-decimal USDC).
    pub const BETA: Caps = Caps {
        min_principal: 10_000_000,
        max_principal_per_lock: 50_000_000,
        global_tvl_cap: 1_000_000_000,
    };

    /// Validate the cap set itself (used at init and on `set_config`).
    pub fn validate(&self) -> Result<()> {
        require!(self.min_principal > 0, CapError::InvalidCaps);
        require!(
            self.min_principal <= self.max_principal_per_lock,
            CapError::InvalidCaps
        );
        require!(
            self.max_principal_per_lock <= self.global_tvl_cap,
            CapError::InvalidCaps
        );
        Ok(())
    }

    /// Can a new lock of `amount` be opened at the current `tvl`?
    pub fn assert_lock_allowed(&self, amount: u64, tvl: u64, paused: bool) -> Result<()> {
        require!(!paused, CapError::VaultPaused);
        require!(amount >= self.min_principal, CapError::BelowMinPrincipal);
        require!(amount <= self.max_principal_per_lock, CapError::AboveMaxPrincipal);
        let projected = tvl.checked_add(amount).ok_or(CapError::NumericalOverflow)?;
        require!(projected <= self.global_tvl_cap, CapError::GlobalTvlCapExceeded);
        Ok(())
    }
}

/// `tvl + amount`, guarded. Call on every lock.
pub fn tvl_add(tvl: u64, amount: u64) -> Result<u64> {
    tvl.checked_add(amount).ok_or(CapError::NumericalOverflow.into())
}

/// `tvl - amount`, guarded. Call on every settlement (claim / force_return).
pub fn tvl_sub(tvl: u64, amount: u64) -> Result<u64> {
    tvl.checked_sub(amount).ok_or(CapError::TvlUnderflow.into())
}

/// Is a lock force-returnable at `now`? Active locks only, past the deadline.
pub fn force_returnable(lock_start_ts: i64, is_active: bool, now: i64) -> Result<()> {
    require!(is_active, CapError::LockNotActive);
    let deadline = lock_start_ts
        .checked_add(FORCE_RETURN_AFTER_SECS)
        .ok_or(CapError::NumericalOverflow)?;
    require!(now >= deadline, CapError::NotForceReturnable);
    Ok(())
}

#[error_code]
pub enum CapError {
    #[msg("A checked arithmetic operation overflowed.")]
    NumericalOverflow,
    #[msg("TVL counter underflowed — accounting is inconsistent.")]
    TvlUnderflow,
    #[msg("Cap configuration is invalid (min <= max <= global, min > 0).")]
    InvalidCaps,
    #[msg("Deposits are paused.")]
    VaultPaused,
    #[msg("Deposit is below the minimum principal.")]
    BelowMinPrincipal,
    #[msg("Deposit exceeds the maximum principal per lock.")]
    AboveMaxPrincipal,
    #[msg("Deposit would exceed the global TVL cap.")]
    GlobalTvlCapExceeded,
    #[msg("Lock is not active.")]
    LockNotActive,
    #[msg("Lock is not yet eligible for force return.")]
    NotForceReturnable,
}

#[cfg(test)]
mod tests {
    use super::*;

    const C: Caps = Caps::BETA;

    #[test]
    fn beta_caps_validate() {
        assert!(C.validate().is_ok());
    }

    #[test]
    fn rejects_inverted_or_zero_caps() {
        assert!(Caps { min_principal: 0, ..C }.validate().is_err());
        assert!(Caps { min_principal: 60_000_000, ..C }.validate().is_err()); // min > max
        assert!(Caps { max_principal_per_lock: 2_000_000_000, ..C }.validate().is_err()); // max > global
    }

    #[test]
    fn enforces_min_max_and_global() {
        assert!(C.assert_lock_allowed(10_000_000, 0, false).is_ok());
        assert!(C.assert_lock_allowed(9_999_999, 0, false).is_err()); // below min
        assert!(C.assert_lock_allowed(50_000_001, 0, false).is_err()); // above max
        assert!(C.assert_lock_allowed(50_000_000, 950_000_000, false).is_ok()); // fits
        assert!(C.assert_lock_allowed(50_000_001, 950_000_000, false).is_err()); // above max
        assert!(C.assert_lock_allowed(50_000_000, 960_000_000, false).is_err()); // over global
    }

    #[test]
    fn pause_blocks_new_locks() {
        assert!(C.assert_lock_allowed(10_000_000, 0, true).is_err());
    }

    #[test]
    fn tvl_round_trips_and_conserves() {
        let t0 = 990_000_000;
        let t1 = tvl_add(t0, 10_000_000).unwrap();
        assert_eq!(t1, 1_000_000_000);
        let t2 = tvl_sub(t1, 10_000_000).unwrap();
        assert_eq!(t2, t0);
    }

    #[test]
    fn tvl_sub_underflow_is_an_error_not_a_wrap() {
        assert!(tvl_sub(5, 10).is_err());
    }

    #[test]
    fn force_return_is_gated_by_an_absolute_deadline() {
        let start = 1_000_000;
        let deadline = start + FORCE_RETURN_AFTER_SECS;
        assert!(force_returnable(start, true, deadline - 1).is_err());
        assert!(force_returnable(start, true, deadline).is_ok());
        assert!(force_returnable(start, true, deadline + 1_000_000).is_ok());
    }

    #[test]
    fn closed_locks_are_never_force_returnable() {
        let start = 1_000_000;
        assert!(force_returnable(start, false, i64::MAX).is_err());
    }

    #[test]
    fn deadline_is_exactly_180_days() {
        assert_eq!(FORCE_RETURN_AFTER_SECS, 180 * 86_400);
    }
}

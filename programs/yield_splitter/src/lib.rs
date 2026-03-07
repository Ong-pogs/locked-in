#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("8bevd3T3LWoUh2Z9348UKwFFN1p5MdbRbAe2zniCrnVv");

const FULL_REDIRECT_BPS: u16 = 10_000;
const OUTCOME_ZERO_GROSS: u8 = 0;
const OUTCOME_BREWER_INACTIVE: u8 = 1;
const OUTCOME_SPLIT_APPLIED: u8 = 2;
const OUTCOME_FULL_REDIRECT: u8 = 3;

#[program]
pub mod yield_splitter {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        stable_mint: Pubkey,
        lock_vault_program: Pubkey,
        community_pot_program: Pubkey,
        platform_fee_bps: u16,
    ) -> Result<()> {
        validate_platform_fee_bps(platform_fee_bps)?;

        let protocol = &mut ctx.accounts.protocol_config;
        protocol.authority = ctx.accounts.authority.key();
        protocol.stable_mint = stable_mint;
        protocol.lock_vault_program = lock_vault_program;
        protocol.community_pot_program = community_pot_program;
        protocol.platform_fee_bps = platform_fee_bps;
        protocol.bump = ctx.bumps.protocol_config;
        Ok(())
    }

    pub fn harvest_and_split(
        ctx: Context<HarvestAndSplit>,
        receipt_key: [u8; 32],
        gross_yield_amount: u64,
        redirect_bps: u16,
        brewer_active: bool,
        skr_tier: u8,
        processed_at_ts: i64,
    ) -> Result<()> {
        require!(processed_at_ts >= 0, YieldSplitterError::InvalidTimestamp);

        let receipt = &mut ctx.accounts.receipt;
        if receipt.is_initialized() {
            return Ok(());
        }

        let split = calculate_harvest_split(
            gross_yield_amount,
            ctx.accounts.protocol_config.platform_fee_bps,
            redirect_bps,
            brewer_active,
            skr_tier,
        )?;

        receipt.record(
            ctx.accounts.lock_account.key(),
            receipt_key,
            gross_yield_amount,
            split.platform_fee_amount,
            split.redirected_amount,
            split.user_share_amount,
            split.ichor_awarded,
            redirect_bps,
            ctx.accounts.protocol_config.platform_fee_bps,
            brewer_active,
            split.applied,
            split.outcome,
            processed_at_ts,
            skr_tier,
            ctx.bumps.receipt,
        );

        emit!(HarvestSplitRecorded {
            lock_account: ctx.accounts.lock_account.key(),
            receipt_key,
            gross_yield_amount,
            platform_fee_amount: split.platform_fee_amount,
            redirected_amount: split.redirected_amount,
            user_share_amount: split.user_share_amount,
            ichor_awarded: split.ichor_awarded,
            redirect_bps,
            brewer_active,
            skr_tier,
            outcome: split.outcome,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [ProtocolConfig::SEED],
        bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(receipt_key: [u8; 32])]
pub struct HarvestAndSplit<'info> {
    #[account(
        seeds = [ProtocolConfig::SEED],
        bump = protocol_config.bump,
        has_one = authority @ YieldSplitterError::UnauthorizedWorker,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: the first milestone only binds this lock pubkey into the receipt PDA.
    pub lock_account: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + HarvestReceipt::INIT_SPACE,
        seeds = [HarvestReceipt::SEED, lock_account.key().as_ref(), receipt_key.as_ref()],
        bump,
    )]
    pub receipt: Account<'info, HarvestReceipt>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub stable_mint: Pubkey,
    pub lock_vault_program: Pubkey,
    pub community_pot_program: Pubkey,
    pub platform_fee_bps: u16,
    pub bump: u8,
}

impl ProtocolConfig {
    pub const SEED: &'static [u8] = b"protocol";
}

#[account]
#[derive(Default, InitSpace)]
pub struct HarvestReceipt {
    pub lock_account: Pubkey,
    pub receipt_key: [u8; 32],
    pub gross_yield_amount: u64,
    pub platform_fee_amount: u64,
    pub redirected_amount: u64,
    pub user_share_amount: u64,
    pub ichor_awarded: u64,
    pub redirect_bps: u16,
    pub platform_fee_bps: u16,
    pub brewer_active: bool,
    pub applied: bool,
    pub outcome: u8,
    pub processed_at_ts: i64,
    pub skr_tier: u8,
    pub bump: u8,
}

impl HarvestReceipt {
    pub const SEED: &'static [u8] = b"receipt";

    fn is_initialized(&self) -> bool {
        self.lock_account != Pubkey::default()
    }

    #[allow(clippy::too_many_arguments)]
    fn record(
        &mut self,
        lock_account: Pubkey,
        receipt_key: [u8; 32],
        gross_yield_amount: u64,
        platform_fee_amount: u64,
        redirected_amount: u64,
        user_share_amount: u64,
        ichor_awarded: u64,
        redirect_bps: u16,
        platform_fee_bps: u16,
        brewer_active: bool,
        applied: bool,
        outcome: u8,
        processed_at_ts: i64,
        skr_tier: u8,
        bump: u8,
    ) {
        self.lock_account = lock_account;
        self.receipt_key = receipt_key;
        self.gross_yield_amount = gross_yield_amount;
        self.platform_fee_amount = platform_fee_amount;
        self.redirected_amount = redirected_amount;
        self.user_share_amount = user_share_amount;
        self.ichor_awarded = ichor_awarded;
        self.redirect_bps = redirect_bps;
        self.platform_fee_bps = platform_fee_bps;
        self.brewer_active = brewer_active;
        self.applied = applied;
        self.outcome = outcome;
        self.processed_at_ts = processed_at_ts;
        self.skr_tier = skr_tier;
        self.bump = bump;
    }
}

#[event]
pub struct HarvestSplitRecorded {
    pub lock_account: Pubkey,
    pub receipt_key: [u8; 32],
    pub gross_yield_amount: u64,
    pub platform_fee_amount: u64,
    pub redirected_amount: u64,
    pub user_share_amount: u64,
    pub ichor_awarded: u64,
    pub redirect_bps: u16,
    pub brewer_active: bool,
    pub skr_tier: u8,
    pub outcome: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct HarvestSplit {
    platform_fee_amount: u64,
    redirected_amount: u64,
    user_share_amount: u64,
    ichor_awarded: u64,
    applied: bool,
    outcome: u8,
}

fn validate_platform_fee_bps(platform_fee_bps: u16) -> Result<()> {
    require!(
        platform_fee_bps <= FULL_REDIRECT_BPS,
        YieldSplitterError::InvalidPlatformFeeBps
    );
    Ok(())
}

fn validate_redirect_bps(platform_fee_bps: u16, redirect_bps: u16) -> Result<()> {
    require!(
        redirect_bps <= FULL_REDIRECT_BPS,
        YieldSplitterError::InvalidRedirectBps
    );
    if redirect_bps < FULL_REDIRECT_BPS {
        require!(
            u32::from(platform_fee_bps) + u32::from(redirect_bps) <= u32::from(FULL_REDIRECT_BPS),
            YieldSplitterError::InvalidCombinedBps
        );
    }
    Ok(())
}

fn percentage_of_amount(amount: u64, bps: u16) -> Result<u64> {
    let numerator = u128::from(amount)
        .checked_mul(u128::from(bps))
        .ok_or(YieldSplitterError::NumericalOverflow)?;
    let result = numerator / u128::from(FULL_REDIRECT_BPS);
    u64::try_from(result).map_err(|_| error!(YieldSplitterError::NumericalOverflow))
}

fn skr_multiplier_bps(skr_tier: u8) -> u16 {
    match skr_tier {
        0 => FULL_REDIRECT_BPS,
        1 => 10_200,
        2 => 10_500,
        _ => 11_000,
    }
}

fn apply_skr_multiplier(base_amount: u64, skr_tier: u8) -> Result<u64> {
    percentage_of_amount(base_amount, skr_multiplier_bps(skr_tier))
}

fn calculate_harvest_split(
    gross_yield_amount: u64,
    platform_fee_bps: u16,
    redirect_bps: u16,
    brewer_active: bool,
    skr_tier: u8,
) -> Result<HarvestSplit> {
    validate_platform_fee_bps(platform_fee_bps)?;
    validate_redirect_bps(platform_fee_bps, redirect_bps)?;

    if gross_yield_amount == 0 {
        return Ok(HarvestSplit {
            platform_fee_amount: 0,
            redirected_amount: 0,
            user_share_amount: 0,
            ichor_awarded: 0,
            applied: false,
            outcome: OUTCOME_ZERO_GROSS,
        });
    }

    if redirect_bps >= FULL_REDIRECT_BPS {
        return Ok(HarvestSplit {
            platform_fee_amount: 0,
            redirected_amount: gross_yield_amount,
            user_share_amount: 0,
            ichor_awarded: 0,
            applied: false,
            outcome: OUTCOME_FULL_REDIRECT,
        });
    }

    let platform_fee_amount = percentage_of_amount(gross_yield_amount, platform_fee_bps)?;
    let redirected_amount = percentage_of_amount(gross_yield_amount, redirect_bps)?;
    let user_share_amount = gross_yield_amount
        .checked_sub(platform_fee_amount)
        .and_then(|value| value.checked_sub(redirected_amount))
        .ok_or(YieldSplitterError::NumericalOverflow)?;

    if !brewer_active || user_share_amount == 0 {
        return Ok(HarvestSplit {
            platform_fee_amount,
            redirected_amount,
            user_share_amount,
            ichor_awarded: 0,
            applied: false,
            outcome: OUTCOME_BREWER_INACTIVE,
        });
    }

    let ichor_awarded = apply_skr_multiplier(user_share_amount, skr_tier)?;
    Ok(HarvestSplit {
        platform_fee_amount,
        redirected_amount,
        user_share_amount,
        ichor_awarded,
        applied: true,
        outcome: OUTCOME_SPLIT_APPLIED,
    })
}

#[error_code]
pub enum YieldSplitterError {
    #[msg("Only the configured worker authority may record yield splits.")]
    UnauthorizedWorker,
    #[msg("Platform fee bps must stay within 0..10000.")]
    InvalidPlatformFeeBps,
    #[msg("Redirect bps must stay within 0..10000.")]
    InvalidRedirectBps,
    #[msg("Platform fee plus redirect bps exceeded 100%.")]
    InvalidCombinedBps,
    #[msg("Processed timestamps must be non-negative.")]
    InvalidTimestamp,
    #[msg("A checked arithmetic operation overflowed.")]
    NumericalOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_brewer_split_applies_fee_redirect_and_skr_boost() {
        let split = calculate_harvest_split(100_000_000, 1_000, 2_000, true, 2).unwrap();
        assert_eq!(split.platform_fee_amount, 10_000_000);
        assert_eq!(split.redirected_amount, 20_000_000);
        assert_eq!(split.user_share_amount, 70_000_000);
        assert_eq!(split.ichor_awarded, 73_500_000);
        assert!(split.applied);
        assert_eq!(split.outcome, OUTCOME_SPLIT_APPLIED);
    }

    #[test]
    fn inactive_brewer_records_split_without_ichor() {
        let split = calculate_harvest_split(100_000_000, 1_000, 2_000, false, 3).unwrap();
        assert_eq!(split.platform_fee_amount, 10_000_000);
        assert_eq!(split.redirected_amount, 20_000_000);
        assert_eq!(split.user_share_amount, 70_000_000);
        assert_eq!(split.ichor_awarded, 0);
        assert!(!split.applied);
        assert_eq!(split.outcome, OUTCOME_BREWER_INACTIVE);
    }

    #[test]
    fn full_redirect_consumes_all_yield_without_fee() {
        let split = calculate_harvest_split(100_000_000, 1_000, FULL_REDIRECT_BPS, true, 0).unwrap();
        assert_eq!(split.platform_fee_amount, 0);
        assert_eq!(split.redirected_amount, 100_000_000);
        assert_eq!(split.user_share_amount, 0);
        assert_eq!(split.ichor_awarded, 0);
        assert!(!split.applied);
        assert_eq!(split.outcome, OUTCOME_FULL_REDIRECT);
    }

    #[test]
    fn combined_bps_above_hundred_percent_is_rejected() {
        let error = calculate_harvest_split(100_000_000, 1_500, 9_500, true, 0).unwrap_err();
        assert_eq!(error, error!(YieldSplitterError::InvalidCombinedBps));
    }

    #[test]
    fn receipt_initialization_flag_is_driven_by_lock_pubkey() {
        let mut receipt = HarvestReceipt::default();
        assert!(!receipt.is_initialized());
        receipt.lock_account = Pubkey::new_unique();
        assert!(receipt.is_initialized());
    }
}

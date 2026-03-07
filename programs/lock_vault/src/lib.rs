#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};

declare_id!("41TexnrHDMV4ASJmqNNFcgQ7RBk6N193yvukfiCzKQmD");

const DAY_SECONDS: i64 = 86_400;
const MIN_FUEL_CAP: u16 = 7;
const MAX_FUEL_CAP: u16 = 14;
const DEFAULT_MAX_SAVERS: u8 = 3;
const GAUNTLET_DAYS: u8 = 7;
const MAX_LOCK_DURATION_DAYS: u16 = 90;
const ACTIVE_STATUS: u8 = 0;
const CLOSED_STATUS: u8 = 2;
const FULL_REDIRECT_BPS: u16 = 10_000;
const RECEIPT_KIND_COMPLETION: u8 = 1;
const RECEIPT_KIND_FUEL_BURN: u8 = 2;
const RECEIPT_KIND_MISS: u8 = 3;
const RECEIPT_KIND_HARVEST: u8 = 4;
const OUTCOME_NO_REWARD_UNITS: u8 = 1;
const OUTCOME_SAVER_RECOVERED: u8 = 2;
const OUTCOME_ALREADY_EARNED_TODAY: u8 = 3;
const OUTCOME_AT_FUEL_CAP: u8 = 4;
const OUTCOME_FUEL_CREDITED: u8 = 5;
const OUTCOME_GAUNTLET_LOCKED: u8 = 20;
const OUTCOME_NO_FUEL_AVAILABLE: u8 = 21;
const OUTCOME_FUEL_BURNED: u8 = 22;
const OUTCOME_SAVER_CONSUMED: u8 = 30;
const OUTCOME_FULL_CONSEQUENCE: u8 = 31;
const OUTCOME_HARVEST_SKIPPED: u8 = 40;
const OUTCOME_HARVEST_APPLIED: u8 = 41;

#[program]
pub mod lock_vault {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        fuel_cap: u16,
        max_savers: u8,
        miss_extension_days: u16,
        usdc_mint: Pubkey,
        skr_mint: Pubkey,
    ) -> Result<()> {
        validate_protocol_params(
            fuel_cap,
            max_savers,
            miss_extension_days,
            usdc_mint,
            skr_mint,
        )?;

        let protocol = &mut ctx.accounts.protocol_config;
        protocol.authority = ctx.accounts.authority.key();
        protocol.fuel_cap = fuel_cap;
        protocol.max_savers = max_savers;
        protocol.miss_extension_days = miss_extension_days;
        protocol.usdc_mint = usdc_mint;
        protocol.skr_mint = skr_mint;
        protocol.bump = ctx.bumps.protocol_config;

        Ok(())
    }

    pub fn lock_funds(
        ctx: Context<LockFunds>,
        course_id_hash: [u8; 32],
        lock_duration_days: u16,
        stable_amount: u64,
        skr_amount: u64,
    ) -> Result<()> {
        require!(stable_amount > 0, LockVaultError::InvalidPrincipalAmount);
        validate_supported_mints(
            &ctx.accounts.protocol_config,
            ctx.accounts.stable_mint.key(),
            ctx.accounts.skr_mint.key(),
        )?;
        validate_owner_token_account(
            &ctx.accounts.owner_stable_token_account,
            ctx.accounts.owner.key(),
            ctx.accounts.stable_mint.key(),
        )?;

        transfer_checked_tokens(
            &ctx.accounts.token_program,
            &ctx.accounts.owner_stable_token_account,
            &ctx.accounts.stable_vault,
            &ctx.accounts.stable_mint,
            &ctx.accounts.owner,
            stable_amount,
        )?;

        let skr_tier = if skr_amount > 0 {
            let owner_skr_token_account = ctx
                .accounts
                .owner_skr_token_account
                .as_ref()
                .ok_or_else(|| error!(LockVaultError::MissingSkrTokenAccount))?;

            validate_owner_token_account(
                owner_skr_token_account,
                ctx.accounts.owner.key(),
                ctx.accounts.skr_mint.key(),
            )?;

            transfer_checked_tokens(
                &ctx.accounts.token_program,
                owner_skr_token_account,
                &ctx.accounts.skr_vault,
                &ctx.accounts.skr_mint,
                &ctx.accounts.owner,
                skr_amount,
            )?;

            derive_skr_tier(skr_amount, ctx.accounts.skr_mint.decimals)?
        } else {
            0
        };

        let now = Clock::get()?.unix_timestamp;
        let lock_account = &mut ctx.accounts.lock_account;
        lock_account.initialize_from_funding(
            &ctx.accounts.protocol_config,
            ctx.accounts.owner.key(),
            course_id_hash,
            ctx.accounts.stable_mint.key(),
            stable_amount,
            skr_amount,
            skr_tier,
            lock_duration_days,
            now,
            ctx.bumps.lock_account,
        )?;

        emit!(LockCreated {
            lock_account: lock_account.key(),
            owner: lock_account.owner,
            course_id_hash: lock_account.course_id_hash,
            stable_mint: lock_account.stable_mint,
            principal_amount: lock_account.principal_amount,
            skr_locked_amount: lock_account.skr_locked_amount,
            skr_tier: lock_account.skr_tier,
            lock_end_ts: lock_account.lock_end_ts,
        });

        Ok(())
    }

    pub fn apply_verified_completion(
        ctx: Context<ApplyVerifiedCompletion>,
        receipt_key: [u8; 32],
        completion_day: i64,
        reward_units: u16,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let receipt = &mut ctx.accounts.receipt;
        if receipt.is_initialized() {
            return Ok(());
        }

        let effect = ctx.accounts.lock_account.apply_verified_completion(
            &ctx.accounts.protocol_config,
            completion_day,
            reward_units,
        )?;

        receipt.record(
            ctx.accounts.lock_account.key(),
            receipt_key,
            RECEIPT_KIND_COMPLETION,
            effect.applied,
            effect.outcome,
            completion_day,
            i64::from(effect.fuel_awarded),
            ctx.bumps.receipt,
            now,
        );

        if effect.fuel_awarded > 0 {
            emit!(FuelCredited {
                lock_account: ctx.accounts.lock_account.key(),
                completion_day,
                fuel_awarded: effect.fuel_awarded,
                fuel_counter: ctx.accounts.lock_account.fuel_counter,
            });
        }

        Ok(())
    }

    pub fn consume_daily_fuel(
        ctx: Context<ConsumeDailyFuel>,
        receipt_key: [u8; 32],
        burned_at_ts: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let receipt = &mut ctx.accounts.receipt;
        if receipt.is_initialized() {
            return Ok(());
        }

        let effect = ctx.accounts.lock_account.consume_daily_fuel(burned_at_ts)?;

        receipt.record(
            ctx.accounts.lock_account.key(),
            receipt_key,
            RECEIPT_KIND_FUEL_BURN,
            effect.applied,
            effect.outcome,
            burned_at_ts,
            i64::from(effect.fuel_burned),
            ctx.bumps.receipt,
            now,
        );

        if effect.fuel_burned > 0 {
            emit!(FuelBurned {
                lock_account: ctx.accounts.lock_account.key(),
                burned_at_ts,
                fuel_counter: ctx.accounts.lock_account.fuel_counter,
            });
        }

        Ok(())
    }

    pub fn consume_saver_or_apply_full_consequence(
        ctx: Context<ConsumeSaverOrApplyFullConsequence>,
        receipt_key: [u8; 32],
        miss_day: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let receipt = &mut ctx.accounts.receipt;
        if receipt.is_initialized() {
            return Ok(());
        }

        let effect = ctx
            .accounts
            .lock_account
            .consume_saver_or_apply_full_consequence(&ctx.accounts.protocol_config, miss_day)?;

        receipt.record(
            ctx.accounts.lock_account.key(),
            receipt_key,
            RECEIPT_KIND_MISS,
            effect.applied,
            effect.outcome,
            miss_day,
            effect.extension_seconds_added,
            ctx.bumps.receipt,
            now,
        );

        match effect.outcome {
            OUTCOME_SAVER_CONSUMED => emit!(SaverConsumed {
                lock_account: ctx.accounts.lock_account.key(),
                miss_day,
                savers_remaining: ctx.accounts.lock_account.savers_remaining,
                current_yield_redirect_bps: ctx.accounts.lock_account.current_yield_redirect_bps,
            }),
            OUTCOME_FULL_CONSEQUENCE => emit!(FullConsequenceApplied {
                lock_account: ctx.accounts.lock_account.key(),
                miss_day,
                extension_seconds_total: ctx.accounts.lock_account.extension_seconds_total,
                current_yield_redirect_bps: ctx.accounts.lock_account.current_yield_redirect_bps,
            }),
            _ => {}
        }

        Ok(())
    }

    pub fn unlock_funds(ctx: Context<UnlockFunds>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let authority_info = ctx.accounts.lock_account.to_account_info();
        let (owner_key, course_id_hash, bump, principal_amount, skr_locked_amount) = {
            let lock_account = &ctx.accounts.lock_account;
            lock_account.assert_unlockable(now)?;

            require!(
                ctx.accounts.stable_vault.amount == lock_account.principal_amount,
                LockVaultError::UnexpectedStableVaultBalance
            );
            require!(
                ctx.accounts.skr_vault.amount == lock_account.skr_locked_amount,
                LockVaultError::UnexpectedSkrVaultBalance
            );

            (
                lock_account.owner,
                lock_account.course_id_hash,
                lock_account.bump,
                lock_account.principal_amount,
                lock_account.skr_locked_amount,
            )
        };
        let signer_seeds: &[&[&[u8]]] = &[&[
            LockAccount::SEED,
            owner_key.as_ref(),
            course_id_hash.as_ref(),
            &[bump],
        ]];

        transfer_checked_from_lock_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.stable_vault,
            &ctx.accounts.owner_stable_token_account,
            &ctx.accounts.stable_mint,
            &authority_info,
            signer_seeds,
            principal_amount,
        )?;

        if skr_locked_amount > 0 {
            transfer_checked_from_lock_vault(
                &ctx.accounts.token_program,
                &ctx.accounts.skr_vault,
                &ctx.accounts.owner_skr_token_account,
                &ctx.accounts.skr_mint,
                &authority_info,
                signer_seeds,
                skr_locked_amount,
            )?;
        }

        close_token_account_from_lock_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.stable_vault.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            &authority_info,
            signer_seeds,
        )?;
        close_token_account_from_lock_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.skr_vault.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            &authority_info,
            signer_seeds,
        )?;

        let lock_account = &mut ctx.accounts.lock_account;
        lock_account.mark_closed();

        emit!(LockUnlocked {
            lock_account: lock_account.key(),
            owner: lock_account.owner,
            principal_amount: lock_account.principal_amount,
            skr_locked_amount: lock_account.skr_locked_amount,
            unlocked_at_ts: now,
        });

        Ok(())
    }

    pub fn redeem_ichor(ctx: Context<RedeemIchor>, ichor_amount: u64) -> Result<()> {
        validate_supported_mints(
            &ctx.accounts.protocol_config,
            ctx.accounts.stable_mint.key(),
            ctx.accounts.protocol_config.skr_mint,
        )?;
        require!(
            ctx.accounts.lock_account.stable_mint == ctx.accounts.stable_mint.key(),
            LockVaultError::InvalidTokenAccountMint
        );

        let lock_account = &mut ctx.accounts.lock_account;
        let effect = lock_account.redeem_ichor(ichor_amount, ctx.accounts.stable_mint.decimals)?;

        require!(
            ctx.accounts.redemption_vault.amount >= effect.usdc_out,
            LockVaultError::InsufficientRedemptionLiquidity
        );

        let signer_seeds: &[&[&[u8]]] =
            &[&[ProtocolConfig::SEED, &[ctx.accounts.protocol_config.bump]]];

        transfer_checked_from_lock_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.redemption_vault,
            &ctx.accounts.owner_stable_token_account,
            &ctx.accounts.stable_mint,
            &ctx.accounts.protocol_config.to_account_info(),
            signer_seeds,
            effect.usdc_out,
        )?;

        emit!(IchorRedeemed {
            lock_account: lock_account.key(),
            owner: lock_account.owner,
            ichor_amount,
            usdc_out: effect.usdc_out,
            conversion_bps: effect.conversion_bps,
        });

        Ok(())
    }

    pub fn apply_harvest_result(
        ctx: Context<ApplyHarvestResult>,
        receipt_key: [u8; 32],
        gross_yield_amount: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let receipt = &mut ctx.accounts.receipt;
        if receipt.is_initialized() {
            return Ok(());
        }

        let effect = ctx
            .accounts
            .lock_account
            .apply_harvest_result(gross_yield_amount)?;

        receipt.record(
            ctx.accounts.lock_account.key(),
            receipt_key,
            RECEIPT_KIND_HARVEST,
            effect.applied,
            effect.outcome,
            now,
            i64::try_from(effect.ichor_awarded).map_err(|_| LockVaultError::NumericalOverflow)?,
            ctx.bumps.receipt,
            now,
        );

        if effect.applied {
            emit!(HarvestApplied {
                lock_account: ctx.accounts.lock_account.key(),
                gross_yield_amount,
                platform_fee_amount: effect.platform_fee_amount,
                redirected_amount: effect.redirected_amount,
                ichor_awarded: effect.ichor_awarded,
                ichor_counter: ctx.accounts.lock_account.ichor_counter,
            });
        }

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
        bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(course_id_hash: [u8; 32], lock_duration_days: u16, stable_amount: u64, skr_amount: u64)]
pub struct LockFunds<'info> {
    #[account(
        seeds = [ProtocolConfig::SEED],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = owner,
        space = 8 + LockAccount::INIT_SPACE,
        seeds = [LockAccount::SEED, owner.key().as_ref(), course_id_hash.as_ref()],
        bump
    )]
    pub lock_account: Account<'info, LockAccount>,
    pub stable_mint: InterfaceAccount<'info, Mint>,
    pub skr_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub owner_stable_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = owner,
        associated_token::mint = stable_mint,
        associated_token::authority = lock_account,
        associated_token::token_program = token_program
    )]
    pub stable_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = owner,
        associated_token::mint = skr_mint,
        associated_token::authority = lock_account,
        associated_token::token_program = token_program
    )]
    pub skr_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    #[account(mut)]
    pub owner_skr_token_account: Option<InterfaceAccount<'info, TokenAccount>>,
}

#[derive(Accounts)]
#[instruction(receipt_key: [u8; 32], completion_day: i64, reward_units: u16)]
pub struct ApplyVerifiedCompletion<'info> {
    #[account(
        seeds = [ProtocolConfig::SEED],
        bump = protocol_config.bump,
        has_one = authority @ LockVaultError::UnauthorizedWorker
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub lock_account: Account<'info, LockAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + WorkerReceipt::INIT_SPACE,
        seeds = [WorkerReceipt::COMPLETION_SEED, lock_account.key().as_ref(), receipt_key.as_ref()],
        bump
    )]
    pub receipt: Account<'info, WorkerReceipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(receipt_key: [u8; 32], burned_at_ts: i64)]
pub struct ConsumeDailyFuel<'info> {
    #[account(
        seeds = [ProtocolConfig::SEED],
        bump = protocol_config.bump,
        has_one = authority @ LockVaultError::UnauthorizedWorker
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub lock_account: Account<'info, LockAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + WorkerReceipt::INIT_SPACE,
        seeds = [WorkerReceipt::FUEL_BURN_SEED, lock_account.key().as_ref(), receipt_key.as_ref()],
        bump
    )]
    pub receipt: Account<'info, WorkerReceipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(receipt_key: [u8; 32], miss_day: i64)]
pub struct ConsumeSaverOrApplyFullConsequence<'info> {
    #[account(
        seeds = [ProtocolConfig::SEED],
        bump = protocol_config.bump,
        has_one = authority @ LockVaultError::UnauthorizedWorker
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub lock_account: Account<'info, LockAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + WorkerReceipt::INIT_SPACE,
        seeds = [WorkerReceipt::MISS_SEED, lock_account.key().as_ref(), receipt_key.as_ref()],
        bump
    )]
    pub receipt: Account<'info, WorkerReceipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(receipt_key: [u8; 32], gross_yield_amount: u64)]
pub struct ApplyHarvestResult<'info> {
    #[account(
        seeds = [ProtocolConfig::SEED],
        bump = protocol_config.bump,
        has_one = authority @ LockVaultError::UnauthorizedWorker
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub lock_account: Account<'info, LockAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + WorkerReceipt::INIT_SPACE,
        seeds = [WorkerReceipt::HARVEST_SEED, lock_account.key().as_ref(), receipt_key.as_ref()],
        bump
    )]
    pub receipt: Account<'info, WorkerReceipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnlockFunds<'info> {
    #[account(
        mut,
        close = owner,
        has_one = owner @ LockVaultError::InvalidLockOwner
    )]
    pub lock_account: Account<'info, LockAccount>,
    pub stable_mint: InterfaceAccount<'info, Mint>,
    pub skr_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        token::mint = stable_mint,
        token::authority = lock_account,
        token::token_program = token_program
    )]
    pub stable_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = skr_mint,
        token::authority = lock_account,
        token::token_program = token_program
    )]
    pub skr_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = stable_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_stable_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = skr_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_skr_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RedeemIchor<'info> {
    #[account(
        seeds = [ProtocolConfig::SEED],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        has_one = owner @ LockVaultError::InvalidLockOwner
    )]
    pub lock_account: Account<'info, LockAccount>,
    pub stable_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        token::mint = stable_mint,
        token::authority = protocol_config,
        token::token_program = token_program
    )]
    pub redemption_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = stable_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_stable_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub fuel_cap: u16,
    pub max_savers: u8,
    pub miss_extension_days: u16,
    pub usdc_mint: Pubkey,
    pub skr_mint: Pubkey,
    pub bump: u8,
}

impl ProtocolConfig {
    pub const SEED: &'static [u8] = b"protocol";
}

#[account]
#[derive(InitSpace)]
pub struct LockAccount {
    pub owner: Pubkey,
    pub course_id_hash: [u8; 32],
    pub stable_mint: Pubkey,
    pub principal_amount: u64,
    pub lock_start_ts: i64,
    pub lock_end_ts: i64,
    pub extension_seconds_total: u64,
    pub status: u8,
    pub gauntlet_complete: bool,
    pub gauntlet_day: u8,
    pub current_streak: u16,
    pub longest_streak: u16,
    pub savers_remaining: u8,
    pub saver_recovery_mode: bool,
    pub fuel_counter: u16,
    pub fuel_cap: u16,
    pub last_fuel_credit_day: i64,
    pub last_brewer_burn_ts: i64,
    pub last_completion_day: i64,
    pub ichor_counter: u64,
    pub ichor_lifetime_total: u64,
    pub skr_locked_amount: u64,
    pub skr_tier: u8,
    pub current_yield_redirect_bps: u16,
    pub bump: u8,
}

impl LockAccount {
    pub const SEED: &'static [u8] = b"lock";

    #[allow(clippy::too_many_arguments)]
    fn initialize_from_funding(
        &mut self,
        protocol: &ProtocolConfig,
        owner: Pubkey,
        course_id_hash: [u8; 32],
        stable_mint: Pubkey,
        principal_amount: u64,
        skr_locked_amount: u64,
        skr_tier: u8,
        lock_duration_days: u16,
        now: i64,
        bump: u8,
    ) -> Result<()> {
        validate_lock_duration(lock_duration_days)?;

        let duration_seconds = i64::from(lock_duration_days)
            .checked_mul(DAY_SECONDS)
            .ok_or(LockVaultError::NumericalOverflow)?;

        self.owner = owner;
        self.course_id_hash = course_id_hash;
        self.stable_mint = stable_mint;
        self.principal_amount = principal_amount;
        self.lock_start_ts = now;
        self.lock_end_ts = now
            .checked_add(duration_seconds)
            .ok_or(LockVaultError::NumericalOverflow)?;
        self.extension_seconds_total = 0;
        self.status = ACTIVE_STATUS;
        self.gauntlet_complete = false;
        self.gauntlet_day = 1;
        self.current_streak = 0;
        self.longest_streak = 0;
        self.savers_remaining = 0;
        self.saver_recovery_mode = false;
        self.fuel_counter = 0;
        self.fuel_cap = protocol.fuel_cap;
        self.last_fuel_credit_day = -1;
        self.last_brewer_burn_ts = 0;
        self.last_completion_day = -1;
        self.ichor_counter = 0;
        self.ichor_lifetime_total = 0;
        self.skr_locked_amount = skr_locked_amount;
        self.skr_tier = skr_tier;
        self.current_yield_redirect_bps = 0;
        self.bump = bump;

        Ok(())
    }

    fn apply_verified_completion(
        &mut self,
        protocol: &ProtocolConfig,
        completion_day: i64,
        reward_units: u16,
    ) -> Result<CompletionEffect> {
        require!(completion_day >= 0, LockVaultError::InvalidDay);

        let same_day = self.last_completion_day == completion_day;

        if !same_day {
            let consecutive =
                self.last_completion_day >= 0 && completion_day - self.last_completion_day == 1;
            self.current_streak = if self.last_completion_day < 0 {
                1
            } else if consecutive {
                self.current_streak
                    .checked_add(1)
                    .ok_or(LockVaultError::NumericalOverflow)?
            } else {
                1
            };
            self.longest_streak = self.longest_streak.max(self.current_streak);
            self.last_completion_day = completion_day;

            if !self.gauntlet_complete {
                self.gauntlet_day = self.gauntlet_day.saturating_add(1).min(GAUNTLET_DAYS + 1);
                if self.gauntlet_day > GAUNTLET_DAYS {
                    self.gauntlet_complete = true;
                    self.savers_remaining = protocol.max_savers;
                    self.saver_recovery_mode = false;
                    self.current_yield_redirect_bps = 0;
                }
            }
        }

        let mut outcome = if reward_units == 0 {
            OUTCOME_NO_REWARD_UNITS
        } else {
            OUTCOME_ALREADY_EARNED_TODAY
        };

        if self.saver_recovery_mode && self.savers_remaining < protocol.max_savers {
            self.savers_remaining = self
                .savers_remaining
                .checked_add(1)
                .ok_or(LockVaultError::NumericalOverflow)?;
            self.saver_recovery_mode = self.savers_remaining < protocol.max_savers;
            self.current_yield_redirect_bps =
                saver_redirect_bps(protocol.max_savers, self.savers_remaining);
            outcome = OUTCOME_SAVER_RECOVERED;
        }

        let mut fuel_awarded = 0;
        if reward_units > 0 && !self.saver_recovery_mode {
            if self.fuel_counter >= self.fuel_cap {
                outcome = OUTCOME_AT_FUEL_CAP;
            } else if self.last_fuel_credit_day == completion_day {
                outcome = OUTCOME_ALREADY_EARNED_TODAY;
            } else {
                let next_fuel = self
                    .fuel_counter
                    .checked_add(1)
                    .ok_or(LockVaultError::NumericalOverflow)?
                    .min(self.fuel_cap);
                fuel_awarded = next_fuel.saturating_sub(self.fuel_counter);
                self.fuel_counter = next_fuel;
                self.last_fuel_credit_day = completion_day;
                outcome = OUTCOME_FUEL_CREDITED;
            }
        }

        Ok(CompletionEffect {
            applied: true,
            outcome,
            fuel_awarded,
        })
    }

    fn consume_daily_fuel(&mut self, burned_at_ts: i64) -> Result<FuelBurnEffect> {
        require!(burned_at_ts >= 0, LockVaultError::InvalidTimestamp);

        if !self.gauntlet_complete {
            return Ok(FuelBurnEffect {
                applied: false,
                outcome: OUTCOME_GAUNTLET_LOCKED,
                fuel_burned: 0,
            });
        }

        if self.fuel_counter == 0 {
            return Ok(FuelBurnEffect {
                applied: false,
                outcome: OUTCOME_NO_FUEL_AVAILABLE,
                fuel_burned: 0,
            });
        }

        self.fuel_counter = self
            .fuel_counter
            .checked_sub(1)
            .ok_or(LockVaultError::NumericalOverflow)?;
        self.last_brewer_burn_ts = burned_at_ts;

        Ok(FuelBurnEffect {
            applied: true,
            outcome: OUTCOME_FUEL_BURNED,
            fuel_burned: 1,
        })
    }

    fn consume_saver_or_apply_full_consequence(
        &mut self,
        protocol: &ProtocolConfig,
        miss_day: i64,
    ) -> Result<MissEffect> {
        require!(miss_day >= 0, LockVaultError::InvalidDay);

        if !self.gauntlet_complete {
            return Ok(MissEffect {
                applied: false,
                outcome: OUTCOME_GAUNTLET_LOCKED,
                extension_seconds_added: 0,
            });
        }

        self.current_streak = 0;
        self.saver_recovery_mode = true;

        if self.savers_remaining > 0 {
            self.savers_remaining = self
                .savers_remaining
                .checked_sub(1)
                .ok_or(LockVaultError::NumericalOverflow)?;
            self.current_yield_redirect_bps =
                saver_redirect_bps(protocol.max_savers, self.savers_remaining);

            return Ok(MissEffect {
                applied: true,
                outcome: OUTCOME_SAVER_CONSUMED,
                extension_seconds_added: 0,
            });
        }

        self.current_yield_redirect_bps = FULL_REDIRECT_BPS;

        let extension_seconds = i64::from(protocol.miss_extension_days)
            .checked_mul(DAY_SECONDS)
            .ok_or(LockVaultError::NumericalOverflow)?;
        let extension_u64 =
            u64::try_from(extension_seconds).map_err(|_| LockVaultError::NumericalOverflow)?;

        self.extension_seconds_total = self
            .extension_seconds_total
            .checked_add(extension_u64)
            .ok_or(LockVaultError::NumericalOverflow)?;
        self.lock_end_ts = self
            .lock_end_ts
            .checked_add(extension_seconds)
            .ok_or(LockVaultError::NumericalOverflow)?;

        Ok(MissEffect {
            applied: true,
            outcome: OUTCOME_FULL_CONSEQUENCE,
            extension_seconds_added: extension_seconds,
        })
    }

    fn assert_unlockable(&self, now: i64) -> Result<()> {
        require!(
            self.status != CLOSED_STATUS,
            LockVaultError::LockAlreadyClosed
        );
        require!(now >= self.lock_end_ts, LockVaultError::LockStillActive);
        Ok(())
    }

    fn mark_closed(&mut self) {
        self.status = CLOSED_STATUS;
    }

    fn redeem_ichor(&mut self, ichor_amount: u64, stable_decimals: u8) -> Result<RedeemEffect> {
        require!(
            self.status != CLOSED_STATUS,
            LockVaultError::LockAlreadyClosed
        );
        require!(self.gauntlet_complete, LockVaultError::IchorExchangeLocked);
        require!(ichor_amount > 0, LockVaultError::InvalidIchorAmount);
        require!(
            ichor_amount <= self.ichor_counter,
            LockVaultError::InsufficientIchorBalance
        );

        let conversion_bps = ichor_conversion_bps(self.ichor_lifetime_total);
        let base_units = 10u128
            .checked_pow(u32::from(stable_decimals))
            .ok_or(LockVaultError::UnsupportedMintDecimals)?;
        let usdc_out = u128::from(ichor_amount)
            .checked_mul(base_units)
            .and_then(|value| value.checked_mul(u128::from(conversion_bps)))
            .ok_or(LockVaultError::NumericalOverflow)?
            / 1_000u128
            / 10_000u128;
        let usdc_out = u64::try_from(usdc_out).map_err(|_| LockVaultError::NumericalOverflow)?;

        self.ichor_counter = self
            .ichor_counter
            .checked_sub(ichor_amount)
            .ok_or(LockVaultError::NumericalOverflow)?;

        Ok(RedeemEffect {
            usdc_out,
            conversion_bps,
        })
    }

    fn apply_harvest_result(&mut self, gross_yield_amount: u64) -> Result<HarvestEffect> {
        require!(
            self.status != CLOSED_STATUS,
            LockVaultError::LockAlreadyClosed
        );

        let brewer_active = self.gauntlet_complete && self.fuel_counter > 0;
        let split = calculate_harvest_split(
            gross_yield_amount,
            self.current_yield_redirect_bps,
            brewer_active,
            self.skr_tier,
        )?;

        if split.ichor_awarded == 0 {
            return Ok(HarvestEffect {
                applied: false,
                outcome: OUTCOME_HARVEST_SKIPPED,
                platform_fee_amount: split.platform_fee_amount,
                redirected_amount: split.redirected_amount,
                ichor_awarded: 0,
            });
        }

        self.ichor_counter = self
            .ichor_counter
            .checked_add(split.ichor_awarded)
            .ok_or(LockVaultError::NumericalOverflow)?;
        self.ichor_lifetime_total = self
            .ichor_lifetime_total
            .checked_add(split.ichor_awarded)
            .ok_or(LockVaultError::NumericalOverflow)?;

        Ok(HarvestEffect {
            applied: true,
            outcome: OUTCOME_HARVEST_APPLIED,
            platform_fee_amount: split.platform_fee_amount,
            redirected_amount: split.redirected_amount,
            ichor_awarded: split.ichor_awarded,
        })
    }
}

#[account]
#[derive(InitSpace)]
pub struct WorkerReceipt {
    pub lock_account: Pubkey,
    pub receipt_key: [u8; 32],
    pub kind: u8,
    pub applied: bool,
    pub outcome: u8,
    pub reference_value: i64,
    pub numeric_delta: i64,
    pub processed_at: i64,
    pub bump: u8,
}

impl WorkerReceipt {
    pub const COMPLETION_SEED: &'static [u8] = b"completion";
    pub const FUEL_BURN_SEED: &'static [u8] = b"fuel-burn";
    pub const MISS_SEED: &'static [u8] = b"miss";
    pub const HARVEST_SEED: &'static [u8] = b"harvest";

    fn is_initialized(&self) -> bool {
        self.lock_account != Pubkey::default()
    }

    #[allow(clippy::too_many_arguments)]
    fn record(
        &mut self,
        lock_account: Pubkey,
        receipt_key: [u8; 32],
        kind: u8,
        applied: bool,
        outcome: u8,
        reference_value: i64,
        numeric_delta: i64,
        bump: u8,
        processed_at: i64,
    ) {
        self.lock_account = lock_account;
        self.receipt_key = receipt_key;
        self.kind = kind;
        self.applied = applied;
        self.outcome = outcome;
        self.reference_value = reference_value;
        self.numeric_delta = numeric_delta;
        self.processed_at = processed_at;
        self.bump = bump;
    }
}

#[event]
pub struct LockCreated {
    pub lock_account: Pubkey,
    pub owner: Pubkey,
    pub course_id_hash: [u8; 32],
    pub stable_mint: Pubkey,
    pub principal_amount: u64,
    pub skr_locked_amount: u64,
    pub skr_tier: u8,
    pub lock_end_ts: i64,
}

#[event]
pub struct FuelCredited {
    pub lock_account: Pubkey,
    pub completion_day: i64,
    pub fuel_awarded: u16,
    pub fuel_counter: u16,
}

#[event]
pub struct FuelBurned {
    pub lock_account: Pubkey,
    pub burned_at_ts: i64,
    pub fuel_counter: u16,
}

#[event]
pub struct SaverConsumed {
    pub lock_account: Pubkey,
    pub miss_day: i64,
    pub savers_remaining: u8,
    pub current_yield_redirect_bps: u16,
}

#[event]
pub struct FullConsequenceApplied {
    pub lock_account: Pubkey,
    pub miss_day: i64,
    pub extension_seconds_total: u64,
    pub current_yield_redirect_bps: u16,
}

#[event]
pub struct LockUnlocked {
    pub lock_account: Pubkey,
    pub owner: Pubkey,
    pub principal_amount: u64,
    pub skr_locked_amount: u64,
    pub unlocked_at_ts: i64,
}

#[event]
pub struct IchorRedeemed {
    pub lock_account: Pubkey,
    pub owner: Pubkey,
    pub ichor_amount: u64,
    pub usdc_out: u64,
    pub conversion_bps: u16,
}

#[event]
pub struct HarvestApplied {
    pub lock_account: Pubkey,
    pub gross_yield_amount: u64,
    pub platform_fee_amount: u64,
    pub redirected_amount: u64,
    pub ichor_awarded: u64,
    pub ichor_counter: u64,
}

#[error_code]
pub enum LockVaultError {
    #[msg("Fuel cap must stay within the v3 protocol range.")]
    InvalidFuelCap,
    #[msg("The saver inventory must match the canonical v3 max of 3.")]
    InvalidMaxSavers,
    #[msg("Miss extension days must be greater than zero.")]
    InvalidMissExtensionDays,
    #[msg("Only the configured worker authority can call this instruction.")]
    UnauthorizedWorker,
    #[msg("Lock duration must be one of the allowed canonical values.")]
    InvalidLockDuration,
    #[msg("Day values must be non-negative epoch days.")]
    InvalidDay,
    #[msg("Timestamp values must be non-negative unix timestamps.")]
    InvalidTimestamp,
    #[msg("A checked arithmetic operation overflowed.")]
    NumericalOverflow,
    #[msg("The protocol mint configuration is invalid.")]
    InvalidMintConfig,
    #[msg("The stable deposit amount must be greater than zero.")]
    InvalidPrincipalAmount,
    #[msg("Only the configured USDC mint is supported.")]
    UnsupportedStableMint,
    #[msg("The provided SKR mint does not match protocol config.")]
    InvalidSkrMint,
    #[msg("The SKR source token account is required when locking SKR.")]
    MissingSkrTokenAccount,
    #[msg("The provided token account owner does not match the signing wallet.")]
    InvalidTokenAccountOwner,
    #[msg("The provided token account mint does not match the expected mint.")]
    InvalidTokenAccountMint,
    #[msg("Mint decimals exceeded the supported range for tier snapshotting.")]
    UnsupportedMintDecimals,
    #[msg("The provided lock owner does not match the signing wallet.")]
    InvalidLockOwner,
    #[msg("The lock is still active and cannot be unlocked yet.")]
    LockStillActive,
    #[msg("The lock has already been closed.")]
    LockAlreadyClosed,
    #[msg("The stable vault balance does not match the locked principal.")]
    UnexpectedStableVaultBalance,
    #[msg("The SKR vault balance does not match the locked snapshot amount.")]
    UnexpectedSkrVaultBalance,
    #[msg("Ichor exchange is still locked until gauntlet completion.")]
    IchorExchangeLocked,
    #[msg("Ichor amount must be greater than zero.")]
    InvalidIchorAmount,
    #[msg("Ichor balance is insufficient for this redemption.")]
    InsufficientIchorBalance,
    #[msg("Redemption vault liquidity is insufficient.")]
    InsufficientRedemptionLiquidity,
}

fn validate_protocol_params(
    fuel_cap: u16,
    max_savers: u8,
    miss_extension_days: u16,
    usdc_mint: Pubkey,
    skr_mint: Pubkey,
) -> Result<()> {
    require!(
        (MIN_FUEL_CAP..=MAX_FUEL_CAP).contains(&fuel_cap),
        LockVaultError::InvalidFuelCap
    );
    require!(
        max_savers == DEFAULT_MAX_SAVERS,
        LockVaultError::InvalidMaxSavers
    );
    require!(
        miss_extension_days > 0 && miss_extension_days <= MAX_LOCK_DURATION_DAYS,
        LockVaultError::InvalidMissExtensionDays
    );
    require!(
        usdc_mint != Pubkey::default()
            && skr_mint != Pubkey::default()
            && usdc_mint != skr_mint,
        LockVaultError::InvalidMintConfig
    );

    Ok(())
}

fn validate_lock_duration(lock_duration_days: u16) -> Result<()> {
    require!(
        matches!(lock_duration_days, 30 | 60 | 90),
        LockVaultError::InvalidLockDuration
    );

    Ok(())
}

fn validate_supported_mints(
    protocol: &ProtocolConfig,
    stable_mint: Pubkey,
    skr_mint: Pubkey,
) -> Result<()> {
    require!(stable_mint == protocol.usdc_mint, LockVaultError::UnsupportedStableMint);
    require!(
        skr_mint == protocol.skr_mint,
        LockVaultError::InvalidSkrMint
    );

    Ok(())
}

fn validate_owner_token_account(
    token_account: &InterfaceAccount<TokenAccount>,
    expected_owner: Pubkey,
    expected_mint: Pubkey,
) -> Result<()> {
    require!(
        token_account.owner == expected_owner,
        LockVaultError::InvalidTokenAccountOwner
    );
    require!(
        token_account.mint == expected_mint,
        LockVaultError::InvalidTokenAccountMint
    );

    Ok(())
}

fn transfer_checked_tokens<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let cpi_accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    let cpi_context = CpiContext::new(token_program.to_account_info(), cpi_accounts);

    token_interface::transfer_checked(cpi_context, amount, mint.decimals)
}

fn transfer_checked_from_lock_vault<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let cpi_accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.clone(),
    };
    let cpi_context =
        CpiContext::new(token_program.to_account_info(), cpi_accounts).with_signer(signer_seeds);

    token_interface::transfer_checked(cpi_context, amount, mint.decimals)
}

fn close_token_account_from_lock_vault<'info>(
    token_program: &Interface<'info, TokenInterface>,
    account: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let cpi_accounts = CloseAccount {
        account: account.clone(),
        destination: destination.clone(),
        authority: authority.clone(),
    };
    let cpi_context =
        CpiContext::new(token_program.to_account_info(), cpi_accounts).with_signer(signer_seeds);

    token_interface::close_account(cpi_context)
}

fn derive_skr_tier(amount: u64, decimals: u8) -> Result<u8> {
    let base_units = 10u128
        .checked_pow(u32::from(decimals))
        .ok_or(LockVaultError::UnsupportedMintDecimals)?;
    let amount = u128::from(amount);

    let tier_three = 10_000u128
        .checked_mul(base_units)
        .ok_or(LockVaultError::NumericalOverflow)?;
    let tier_two = 1_000u128
        .checked_mul(base_units)
        .ok_or(LockVaultError::NumericalOverflow)?;
    let tier_one = 100u128
        .checked_mul(base_units)
        .ok_or(LockVaultError::NumericalOverflow)?;

    Ok(if amount >= tier_three {
        3
    } else if amount >= tier_two {
        2
    } else if amount >= tier_one {
        1
    } else {
        0
    })
}

fn saver_redirect_bps(max_savers: u8, savers_remaining: u8) -> u16 {
    let savers_consumed = max_savers.saturating_sub(savers_remaining);
    match savers_consumed {
        0 => 0,
        1 => 1_000,
        2 | 3 => 2_000,
        _ => FULL_REDIRECT_BPS,
    }
}

fn ichor_conversion_bps(ichor_lifetime_total: u64) -> u16 {
    match ichor_lifetime_total {
        0..=9_999 => 9_000,
        10_000..=49_999 => 10_000,
        50_000..=99_999 => 11_000,
        _ => 12_500,
    }
}

fn percentage_of_amount(amount: u64, bps: u16) -> Result<u64> {
    let value = u128::from(amount)
        .checked_mul(u128::from(bps))
        .ok_or(LockVaultError::NumericalOverflow)?
        / 10_000u128;
    u64::try_from(value).map_err(|_| error!(LockVaultError::NumericalOverflow))
}

fn apply_skr_multiplier(base_amount: u64, skr_tier: u8) -> Result<u64> {
    let multiplier_bps = match skr_tier {
        0 => 10_000u16,
        1 => 10_200u16,
        2 => 10_500u16,
        _ => 11_000u16,
    };
    percentage_of_amount(base_amount, multiplier_bps)
}

fn calculate_harvest_split(
    gross_yield_amount: u64,
    redirect_bps: u16,
    brewer_active: bool,
    skr_tier: u8,
) -> Result<HarvestSplit> {
    if gross_yield_amount == 0 {
        return Ok(HarvestSplit {
            platform_fee_amount: 0,
            redirected_amount: 0,
            ichor_awarded: 0,
        });
    }

    if redirect_bps >= FULL_REDIRECT_BPS {
        return Ok(HarvestSplit {
            platform_fee_amount: 0,
            redirected_amount: gross_yield_amount,
            ichor_awarded: 0,
        });
    }

    let platform_fee_amount = percentage_of_amount(gross_yield_amount, 1_000)?;
    let redirected_amount = percentage_of_amount(gross_yield_amount, redirect_bps)?;
    let user_share_amount = gross_yield_amount
        .checked_sub(platform_fee_amount)
        .and_then(|value| value.checked_sub(redirected_amount))
        .ok_or(LockVaultError::NumericalOverflow)?;
    let ichor_awarded = if brewer_active && user_share_amount > 0 {
        apply_skr_multiplier(user_share_amount, skr_tier)?
    } else {
        0
    };

    Ok(HarvestSplit {
        platform_fee_amount,
        redirected_amount,
        ichor_awarded,
    })
}

struct CompletionEffect {
    applied: bool,
    outcome: u8,
    fuel_awarded: u16,
}

struct FuelBurnEffect {
    applied: bool,
    outcome: u8,
    fuel_burned: u16,
}

struct MissEffect {
    applied: bool,
    outcome: u8,
    extension_seconds_added: i64,
}

struct RedeemEffect {
    usdc_out: u64,
    conversion_bps: u16,
}

struct HarvestEffect {
    applied: bool,
    outcome: u8,
    platform_fee_amount: u64,
    redirected_amount: u64,
    ichor_awarded: u64,
}

struct HarvestSplit {
    platform_fee_amount: u64,
    redirected_amount: u64,
    ichor_awarded: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn protocol() -> ProtocolConfig {
        ProtocolConfig {
            authority: Pubkey::new_unique(),
            fuel_cap: 7,
            max_savers: DEFAULT_MAX_SAVERS,
            miss_extension_days: 7,
            usdc_mint: Pubkey::new_unique(),
            skr_mint: Pubkey::new_unique(),
            bump: 255,
        }
    }

    fn lock(protocol: &ProtocolConfig) -> LockAccount {
        LockAccount {
            owner: Pubkey::new_unique(),
            course_id_hash: [7; 32],
            stable_mint: protocol.usdc_mint,
            principal_amount: 0,
            lock_start_ts: 0,
            lock_end_ts: 30 * DAY_SECONDS,
            extension_seconds_total: 0,
            status: ACTIVE_STATUS,
            gauntlet_complete: false,
            gauntlet_day: 1,
            current_streak: 0,
            longest_streak: 0,
            savers_remaining: 0,
            saver_recovery_mode: false,
            fuel_counter: 0,
            fuel_cap: protocol.fuel_cap,
            last_fuel_credit_day: -1,
            last_brewer_burn_ts: 0,
            last_completion_day: -1,
            ichor_counter: 0,
            ichor_lifetime_total: 0,
            skr_locked_amount: 0,
            skr_tier: 0,
            current_yield_redirect_bps: 0,
            bump: 254,
        }
    }

    #[test]
    fn protocol_params_require_distinct_mints() {
        let mint = Pubkey::new_unique();
        assert!(validate_protocol_params(7, 3, 7, mint, mint).is_err());
    }

    #[test]
    fn skr_tier_matches_canonical_thresholds() {
        assert_eq!(derive_skr_tier(99, 0).unwrap(), 0);
        assert_eq!(derive_skr_tier(100, 0).unwrap(), 1);
        assert_eq!(derive_skr_tier(999, 0).unwrap(), 1);
        assert_eq!(derive_skr_tier(1_000, 0).unwrap(), 2);
        assert_eq!(derive_skr_tier(9_999, 0).unwrap(), 2);
        assert_eq!(derive_skr_tier(10_000, 0).unwrap(), 3);
        assert_eq!(derive_skr_tier(100_000_000, 6).unwrap(), 1);
        assert_eq!(derive_skr_tier(1_000_000_000, 6).unwrap(), 2);
        assert_eq!(derive_skr_tier(10_000_000_000, 6).unwrap(), 3);
    }

    #[test]
    fn funded_lock_snapshots_principal_and_skr_tier() {
        let protocol = protocol();
        let owner = Pubkey::new_unique();
        let mut lock = lock(&protocol);

        lock.initialize_from_funding(
            &protocol,
            owner,
            [9; 32],
            protocol.usdc_mint,
            250_000_000,
            1_500_000_000,
            2,
            60,
            1_700_000_000,
            77,
        )
        .unwrap();

        assert_eq!(lock.owner, owner);
        assert_eq!(lock.course_id_hash, [9; 32]);
        assert_eq!(lock.stable_mint, protocol.usdc_mint);
        assert_eq!(lock.principal_amount, 250_000_000);
        assert_eq!(lock.skr_locked_amount, 1_500_000_000);
        assert_eq!(lock.skr_tier, 2);
        assert_eq!(lock.lock_start_ts, 1_700_000_000);
        assert_eq!(lock.lock_end_ts, 1_700_000_000 + 60 * DAY_SECONDS);
        assert_eq!(lock.fuel_cap, protocol.fuel_cap);
    }

    #[test]
    fn verified_completion_credits_fuel_once_per_day() {
        let protocol = protocol();
        let mut lock = lock(&protocol);

        let first = lock
            .apply_verified_completion(&protocol, 20000, 100)
            .unwrap();
        assert!(first.applied);
        assert_eq!(first.fuel_awarded, 1);
        assert_eq!(lock.current_streak, 1);
        assert_eq!(lock.longest_streak, 1);
        assert_eq!(lock.gauntlet_day, 2);
        assert_eq!(lock.fuel_counter, 1);
        assert_eq!(lock.last_fuel_credit_day, 20000);

        let second = lock
            .apply_verified_completion(&protocol, 20000, 100)
            .unwrap();
        assert!(second.applied);
        assert_eq!(second.fuel_awarded, 0);
        assert_eq!(lock.current_streak, 1);
        assert_eq!(lock.fuel_counter, 1);
        assert_eq!(lock.last_fuel_credit_day, 20000);
    }

    #[test]
    fn gauntlet_unlocks_savers_after_seventh_unique_day() {
        let protocol = protocol();
        let mut lock = lock(&protocol);

        for day in 20000..=20006 {
            lock.apply_verified_completion(&protocol, day, 100).unwrap();
        }

        assert!(lock.gauntlet_complete);
        assert_eq!(lock.gauntlet_day, 8);
        assert_eq!(lock.savers_remaining, protocol.max_savers);
        assert_eq!(lock.current_streak, 7);
    }

    #[test]
    fn saver_recovery_restores_inventory_before_fuel_earning_resumes() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        lock.gauntlet_complete = true;
        lock.gauntlet_day = 8;
        lock.savers_remaining = 1;
        lock.saver_recovery_mode = true;
        lock.current_yield_redirect_bps = 2_000;

        let first = lock
            .apply_verified_completion(&protocol, 20010, 100)
            .unwrap();
        assert_eq!(first.outcome, OUTCOME_SAVER_RECOVERED);
        assert_eq!(first.fuel_awarded, 0);
        assert_eq!(lock.savers_remaining, 2);
        assert!(lock.saver_recovery_mode);
        assert_eq!(lock.current_yield_redirect_bps, 1_000);
        assert_eq!(lock.fuel_counter, 0);

        let second = lock
            .apply_verified_completion(&protocol, 20010, 100)
            .unwrap();
        assert_eq!(second.outcome, OUTCOME_FUEL_CREDITED);
        assert_eq!(second.fuel_awarded, 1);
        assert_eq!(lock.savers_remaining, 3);
        assert!(!lock.saver_recovery_mode);
        assert_eq!(lock.current_yield_redirect_bps, 0);
        assert_eq!(lock.fuel_counter, 1);
    }

    #[test]
    fn fuel_burn_is_blocked_during_gauntlet_and_then_consumes_fuel() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        lock.fuel_counter = 1;

        let blocked = lock.consume_daily_fuel(1_700_000_000).unwrap();
        assert!(!blocked.applied);
        assert_eq!(blocked.outcome, OUTCOME_GAUNTLET_LOCKED);
        assert_eq!(lock.fuel_counter, 1);

        lock.gauntlet_complete = true;
        lock.gauntlet_day = 8;

        let burned = lock.consume_daily_fuel(1_700_000_000).unwrap();
        assert!(burned.applied);
        assert_eq!(burned.outcome, OUTCOME_FUEL_BURNED);
        assert_eq!(burned.fuel_burned, 1);
        assert_eq!(lock.fuel_counter, 0);
        assert_eq!(lock.last_brewer_burn_ts, 1_700_000_000);
    }

    #[test]
    fn unlock_requires_lock_end_and_prevents_double_close() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        lock.initialize_from_funding(
            &protocol,
            Pubkey::new_unique(),
            [3; 32],
            protocol.usdc_mint,
            1_000_000,
            1_000_000_000,
            2,
            30,
            1_700_000_000,
            99,
        )
        .unwrap();

        assert!(lock.assert_unlockable(lock.lock_end_ts - 1).is_err());
        assert!(lock.assert_unlockable(lock.lock_end_ts).is_ok());

        lock.mark_closed();
        assert!(lock.assert_unlockable(lock.lock_end_ts + 1).is_err());
    }

    #[test]
    fn ichor_conversion_bps_matches_canonical_thresholds() {
        assert_eq!(ichor_conversion_bps(0), 9_000);
        assert_eq!(ichor_conversion_bps(9_999), 9_000);
        assert_eq!(ichor_conversion_bps(10_000), 10_000);
        assert_eq!(ichor_conversion_bps(49_999), 10_000);
        assert_eq!(ichor_conversion_bps(50_000), 11_000);
        assert_eq!(ichor_conversion_bps(99_999), 11_000);
        assert_eq!(ichor_conversion_bps(100_000), 12_500);
    }

    #[test]
    fn redeem_ichor_requires_gauntlet_and_debits_balance() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        lock.ichor_counter = 12_000;
        lock.ichor_lifetime_total = 50_000;

        assert!(lock.redeem_ichor(1_000, 6).is_err());

        lock.gauntlet_complete = true;
        let effect = lock.redeem_ichor(1_000, 6).unwrap();
        assert_eq!(effect.conversion_bps, 11_000);
        assert_eq!(effect.usdc_out, 1_100_000);
        assert_eq!(lock.ichor_counter, 11_000);
        assert_eq!(lock.ichor_lifetime_total, 50_000);
    }

    #[test]
    fn harvest_applies_fee_redirect_and_skr_boost_only_when_brewer_active() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        lock.gauntlet_complete = true;
        lock.gauntlet_day = 8;
        lock.fuel_counter = 1;
        lock.skr_tier = 2;
        lock.current_yield_redirect_bps = 1_000;

        let effect = lock.apply_harvest_result(100_000_000).unwrap();
        assert!(effect.applied);
        assert_eq!(effect.platform_fee_amount, 10_000_000);
        assert_eq!(effect.redirected_amount, 10_000_000);
        assert_eq!(effect.ichor_awarded, 84_000_000);
        assert_eq!(lock.ichor_counter, 84_000_000);
        assert_eq!(lock.ichor_lifetime_total, 84_000_000);

        lock.fuel_counter = 0;
        let skipped = lock.apply_harvest_result(100_000_000).unwrap();
        assert!(!skipped.applied);
        assert_eq!(skipped.outcome, OUTCOME_HARVEST_SKIPPED);
        assert_eq!(skipped.platform_fee_amount, 10_000_000);
        assert_eq!(skipped.redirected_amount, 10_000_000);
    }

    #[test]
    fn harvest_full_redirect_sends_all_yield_to_redirect_without_overflow() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        lock.gauntlet_complete = true;
        lock.gauntlet_day = 8;
        lock.fuel_counter = 1;
        lock.current_yield_redirect_bps = FULL_REDIRECT_BPS;

        let effect = lock.apply_harvest_result(100_000_000).unwrap();
        assert!(!effect.applied);
        assert_eq!(effect.outcome, OUTCOME_HARVEST_SKIPPED);
        assert_eq!(effect.platform_fee_amount, 0);
        assert_eq!(effect.redirected_amount, 100_000_000);
        assert_eq!(effect.ichor_awarded, 0);
        assert_eq!(lock.ichor_counter, 0);
        assert_eq!(lock.ichor_lifetime_total, 0);
    }

    #[test]
    fn miss_path_consumes_savers_then_applies_full_consequence() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        lock.gauntlet_complete = true;
        lock.gauntlet_day = 8;
        lock.savers_remaining = 3;
        lock.current_streak = 5;

        let first = lock
            .consume_saver_or_apply_full_consequence(&protocol, 20020)
            .unwrap();
        assert!(first.applied);
        assert_eq!(first.outcome, OUTCOME_SAVER_CONSUMED);
        assert_eq!(lock.savers_remaining, 2);
        assert_eq!(lock.current_yield_redirect_bps, 1_000);
        assert_eq!(lock.current_streak, 0);

        lock.consume_saver_or_apply_full_consequence(&protocol, 20021)
            .unwrap();
        assert_eq!(lock.savers_remaining, 1);
        assert_eq!(lock.current_yield_redirect_bps, 2_000);

        lock.consume_saver_or_apply_full_consequence(&protocol, 20022)
            .unwrap();
        assert_eq!(lock.savers_remaining, 0);
        assert_eq!(lock.current_yield_redirect_bps, 2_000);

        let before_end_ts = lock.lock_end_ts;
        let fourth = lock
            .consume_saver_or_apply_full_consequence(&protocol, 20023)
            .unwrap();
        assert!(fourth.applied);
        assert_eq!(fourth.outcome, OUTCOME_FULL_CONSEQUENCE);
        assert_eq!(fourth.extension_seconds_added, 7 * DAY_SECONDS);
        assert_eq!(lock.current_yield_redirect_bps, FULL_REDIRECT_BPS);
        assert_eq!(lock.lock_end_ts, before_end_ts + 7 * DAY_SECONDS);
        assert_eq!(lock.extension_seconds_total, 7 * DAY_SECONDS as u64);
        assert!(lock.saver_recovery_mode);
    }
}

//! Vault domain — pure custody escrow (was the `lock_vault` program).
//!
//! Logic copied VERBATIM from `programs/lock_vault/src/lib.rs`. The ONLY
//! changes are the rename pins required to coexist under one program ID:
//!   * `ProtocolConfig`        -> `VaultConfig`        (account discriminator)
//!   * `ProtocolConfig::SEED`  -> `b"vault-protocol"`  (PDA seed collision)
//!   * `InitializeProtocol`    -> `InitializeVault`
//!   * `initialize_protocol`   -> `initialize_vault`   (ix discriminator)
//! lock_funds / unlock_funds custody logic is byte-for-byte identical.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};

// ── Custody-core constants ──────────────────────────────────────────────
// Game/fuel/ichor/saver mechanics moved off-chain (v4: backend owns points).
// This program is now a pure escrow: lock principal -> wait -> return principal.
const DAY_SECONDS: i64 = 86_400;
const ACTIVE_STATUS: u8 = 0;
const CLOSED_STATUS: u8 = 2;

pub fn initialize_vault(
    ctx: Context<InitializeVault>,
    usdc_mint: Pubkey,
    skr_mint: Pubkey,
) -> Result<()> {
    validate_protocol_params(usdc_mint, skr_mint)?;

    let protocol = &mut ctx.accounts.protocol_config;
    protocol.authority = ctx.accounts.authority.key();
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
    validate_lock_duration(lock_duration_days)?;
    validate_owner_token_account(
        &ctx.accounts.owner_stable_token_account,
        ctx.accounts.owner.key(),
        ctx.accounts.stable_mint.key(),
    )?;

    // Escrow the principal (USDC) into the lock_account-owned vault ATA.
    transfer_checked_tokens(
        &ctx.accounts.token_program,
        &ctx.accounts.owner_stable_token_account,
        &ctx.accounts.stable_vault,
        &ctx.accounts.stable_mint,
        &ctx.accounts.owner,
        stable_amount,
    )?;

    // Optionally escrow SKR into the SKR vault ATA.
    if skr_amount > 0 {
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
    }

    let now = Clock::get()?.unix_timestamp;
    let lock_account = &mut ctx.accounts.lock_account;
    // lock_end_ts is written exactly ONCE here. No surviving code path mutates it.
    lock_account.initialize_from_funding(
        ctx.accounts.owner.key(),
        course_id_hash,
        ctx.accounts.stable_mint.key(),
        stable_amount,
        skr_amount,
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
        lock_end_ts: lock_account.lock_end_ts,
    });

    Ok(())
}

pub fn unlock_funds(ctx: Context<UnlockFunds>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let authority_info = ctx.accounts.lock_account.to_account_info();
    let (owner_key, course_id_hash, bump, principal_amount, skr_locked_amount) = {
        let lock_account = &ctx.accounts.lock_account;
        lock_account.assert_unlockable(now)?;

        // Assert the vault still holds the full escrowed principal.
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

    // Return the principal to the owner.
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

    // Close both vault ATAs, refunding rent to the owner.
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

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + VaultConfig::INIT_SPACE,
        seeds = [VaultConfig::SEED],
        bump
    )]
    pub protocol_config: Account<'info, VaultConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(course_id_hash: [u8; 32], lock_duration_days: u16, stable_amount: u64, skr_amount: u64)]
pub struct LockFunds<'info> {
    #[account(
        seeds = [VaultConfig::SEED],
        bump = protocol_config.bump
    )]
    pub protocol_config: Box<Account<'info, VaultConfig>>,
    #[account(
        init,
        payer = owner,
        space = 8 + LockAccount::INIT_SPACE,
        seeds = [LockAccount::SEED, owner.key().as_ref(), course_id_hash.as_ref()],
        bump
    )]
    pub lock_account: Box<Account<'info, LockAccount>>,
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub owner_stable_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = owner,
        associated_token::mint = stable_mint,
        associated_token::authority = lock_account,
        associated_token::token_program = token_program
    )]
    pub stable_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = owner,
        associated_token::mint = skr_mint,
        associated_token::authority = lock_account,
        associated_token::token_program = token_program
    )]
    pub skr_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    #[account(mut)]
    pub owner_skr_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
}

#[derive(Accounts)]
pub struct UnlockFunds<'info> {
    // Bound singleton config; supplies the canonical SKR mint (LockAccount
    // does NOT store skr_mint). First field to mirror LockFunds so the client
    // account order is predictable.
    #[account(
        seeds = [VaultConfig::SEED],
        bump = protocol_config.bump
    )]
    pub protocol_config: Box<Account<'info, VaultConfig>>,
    #[account(
        mut,
        close = owner,
        has_one = owner @ LockVaultError::InvalidLockOwner
    )]
    pub lock_account: Box<Account<'info, LockAccount>>,
    // Custody-hardening: bind the supplied stable mint to the lock's recorded
    // mint, blocking a fake-mint + fake-vault unlock that would strand the
    // real principal vault under the closed lock PDA.
    #[account(address = lock_account.stable_mint @ LockVaultError::InvalidMint)]
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,
    // Bind the supplied SKR mint to the canonical protocol SKR mint.
    #[account(address = protocol_config.skr_mint @ LockVaultError::InvalidMint)]
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        token::mint = stable_mint,
        token::authority = lock_account,
        token::token_program = token_program
    )]
    pub stable_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = skr_mint,
        token::authority = lock_account,
        token::token_program = token_program
    )]
    pub skr_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = stable_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_stable_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = skr_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_skr_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub skr_mint: Pubkey,
    pub bump: u8,
}

impl VaultConfig {
    // Re-seeded from b"protocol" to avoid colliding with the pot config PDA
    // under one program ID.
    pub const SEED: &'static [u8] = b"vault-protocol";
}

#[account]
#[derive(InitSpace)]
pub struct LockAccount {
    pub owner: Pubkey,
    pub course_id_hash: [u8; 32],
    pub stable_mint: Pubkey,
    pub principal_amount: u64,
    pub skr_locked_amount: u64,
    pub lock_start_ts: i64,
    pub lock_end_ts: i64,
    pub status: u8,
    pub bump: u8,
}

impl LockAccount {
    pub const SEED: &'static [u8] = b"lock";

    #[allow(clippy::too_many_arguments)]
    fn initialize_from_funding(
        &mut self,
        owner: Pubkey,
        course_id_hash: [u8; 32],
        stable_mint: Pubkey,
        principal_amount: u64,
        skr_locked_amount: u64,
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
        self.skr_locked_amount = skr_locked_amount;
        self.lock_start_ts = now;
        // lock_end_ts is set ONCE; missed learning days are yield-only and
        // never extend the principal lock (v4 fire-timer model).
        self.lock_end_ts = now
            .checked_add(duration_seconds)
            .ok_or(LockVaultError::NumericalOverflow)?;
        self.status = ACTIVE_STATUS;
        self.bump = bump;

        Ok(())
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
}

#[event]
pub struct LockCreated {
    pub lock_account: Pubkey,
    pub owner: Pubkey,
    pub course_id_hash: [u8; 32],
    pub stable_mint: Pubkey,
    pub principal_amount: u64,
    pub skr_locked_amount: u64,
    pub lock_end_ts: i64,
}

#[event]
pub struct LockUnlocked {
    pub lock_account: Pubkey,
    pub owner: Pubkey,
    pub principal_amount: u64,
    pub skr_locked_amount: u64,
    pub unlocked_at_ts: i64,
}

#[error_code]
pub enum LockVaultError {
    #[msg("Lock duration must be one of the allowed canonical values.")]
    InvalidLockDuration,
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
    #[msg("The supplied mint does not match the lock's recorded mint or protocol config.")]
    InvalidMint,
}

fn validate_protocol_params(usdc_mint: Pubkey, skr_mint: Pubkey) -> Result<()> {
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
        matches!(lock_duration_days, 14 | 30 | 45 | 60 | 90 | 180 | 365),
        LockVaultError::InvalidLockDuration
    );

    Ok(())
}

fn validate_supported_mints(
    protocol: &VaultConfig,
    stable_mint: Pubkey,
    skr_mint: Pubkey,
) -> Result<()> {
    require!(
        stable_mint == protocol.usdc_mint,
        LockVaultError::UnsupportedStableMint
    );
    require!(skr_mint == protocol.skr_mint, LockVaultError::InvalidSkrMint);

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

#[cfg(test)]
mod tests {
    use super::*;

    fn protocol() -> VaultConfig {
        VaultConfig {
            authority: Pubkey::new_unique(),
            usdc_mint: Pubkey::new_unique(),
            skr_mint: Pubkey::new_unique(),
            bump: 255,
        }
    }

    fn lock(protocol: &VaultConfig) -> LockAccount {
        LockAccount {
            owner: Pubkey::new_unique(),
            course_id_hash: [7; 32],
            stable_mint: protocol.usdc_mint,
            principal_amount: 0,
            skr_locked_amount: 0,
            lock_start_ts: 0,
            lock_end_ts: 30 * DAY_SECONDS,
            status: ACTIVE_STATUS,
            bump: 254,
        }
    }

    #[test]
    fn protocol_params_require_distinct_mints() {
        let mint = Pubkey::new_unique();
        assert!(validate_protocol_params(mint, mint).is_err());
    }

    #[test]
    fn protocol_params_accept_distinct_mints() {
        let usdc = Pubkey::new_unique();
        let skr = Pubkey::new_unique();
        assert!(validate_protocol_params(usdc, skr).is_ok());
    }

    #[test]
    fn lock_duration_allows_canonical_v3_values() {
        for duration in [14u16, 30, 45, 60, 90, 180, 365] {
            assert!(
                validate_lock_duration(duration).is_ok(),
                "duration {duration} should pass"
            );
        }

        for duration in [1u16, 10, 15, 29, 120, 366] {
            assert!(
                validate_lock_duration(duration).is_err(),
                "duration {duration} should fail"
            );
        }
    }

    #[test]
    fn funded_lock_snapshots_principal_and_sets_immutable_end() {
        let protocol = protocol();
        let owner = Pubkey::new_unique();
        let mut lock = lock(&protocol);

        lock.initialize_from_funding(
            owner,
            [9; 32],
            protocol.usdc_mint,
            250_000_000,
            1_500_000_000,
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
        assert_eq!(lock.lock_start_ts, 1_700_000_000);
        assert_eq!(lock.lock_end_ts, 1_700_000_000 + 60 * DAY_SECONDS);
        assert_eq!(lock.status, ACTIVE_STATUS);
    }

    #[test]
    fn unlock_requires_lock_end_and_prevents_double_close() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        lock.initialize_from_funding(
            Pubkey::new_unique(),
            [3; 32],
            protocol.usdc_mint,
            1_000_000,
            1_000_000_000,
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
    fn assert_unlockable_exactly_at_lock_end_passes() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        lock.initialize_from_funding(
            Pubkey::new_unique(),
            [3; 32],
            protocol.usdc_mint,
            1_000_000,
            0,
            30,
            1_700_000_000,
            99,
        )
        .unwrap();

        assert!(lock.assert_unlockable(lock.lock_end_ts).is_ok());
    }

    #[test]
    fn assert_unlockable_one_second_before_lock_end_fails() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        lock.initialize_from_funding(
            Pubkey::new_unique(),
            [3; 32],
            protocol.usdc_mint,
            1_000_000,
            0,
            30,
            1_700_000_000,
            99,
        )
        .unwrap();

        assert!(lock.assert_unlockable(lock.lock_end_ts - 1).is_err());
    }

    #[test]
    fn invalid_duration_rejected_during_funding() {
        let protocol = protocol();
        let mut lock = lock(&protocol);
        // 29 days is not a canonical duration -> funding must fail.
        let result = lock.initialize_from_funding(
            Pubkey::new_unique(),
            [3; 32],
            protocol.usdc_mint,
            1_000_000,
            0,
            29,
            1_700_000_000,
            99,
        );
        assert!(result.is_err());
    }
}

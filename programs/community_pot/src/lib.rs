#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

declare_id!("BsJDnhJGVdLQ3mxBJ7YCMkkBitKP2RT49zFqR9XsGri1");

const OPEN_STATUS: u8 = 0;
const CLOSED_STATUS: u8 = 1;
const DISTRIBUTED_STATUS: u8 = 2;

#[program]
pub mod community_pot {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        stable_mint: Pubkey,
    ) -> Result<()> {
        let protocol = &mut ctx.accounts.protocol_config;
        protocol.authority = ctx.accounts.authority.key();
        protocol.stable_mint = stable_mint;
        protocol.bump = ctx.bumps.protocol_config;
        Ok(())
    }

    pub fn record_redirect(
        ctx: Context<RecordRedirect>,
        receipt_key: [u8; 32],
        window_id: i64,
        amount: u64,
        recorded_at_ts: i64,
    ) -> Result<()> {
        require!(amount > 0, CommunityPotError::InvalidRedirectAmount);

        let receipt = &mut ctx.accounts.receipt;
        if receipt.is_initialized() {
            return Ok(());
        }

        let window = &mut ctx.accounts.window;
        if !window.is_initialized() {
            window.initialize(
                ctx.accounts.protocol_config.key(),
                window_id,
                ctx.bumps.window,
                recorded_at_ts,
            );
        } else {
            require!(
                window.protocol_config == ctx.accounts.protocol_config.key(),
                CommunityPotError::WindowProtocolMismatch
            );
            require!(
                window.window_id == window_id,
                CommunityPotError::WindowIdMismatch
            );
        }

        window.record_redirect(amount, recorded_at_ts)?;
        let window_key = window.key();
        receipt.record(
            window_key,
            receipt_key,
            amount,
            ctx.bumps.receipt,
            recorded_at_ts,
        );

        emit!(RedirectRecorded {
            window: window_key,
            window_id,
            amount,
            total_redirected_amount: window.total_redirected_amount,
            redirect_count: window.redirect_count,
        });

        Ok(())
    }

    pub fn close_distribution_window(
        ctx: Context<CloseDistributionWindow>,
        window_id: i64,
        total_weight: u64,
        eligible_recipient_count: u32,
        closed_at_ts: i64,
    ) -> Result<()> {
        let pot_window = &ctx.accounts.window;
        require!(
            pot_window.is_initialized(),
            CommunityPotError::PotWindowNotInitialized
        );
        require!(
            pot_window.window_id == window_id,
            CommunityPotError::WindowIdMismatch
        );

        let distribution_window = &mut ctx.accounts.distribution_window;
        if distribution_window.is_initialized()
            && !(distribution_window.distribution_count == 0
                && distribution_window.total_weight == 0
                && distribution_window.eligible_recipient_count == 0)
        {
            return Ok(());
        }

        distribution_window.initialize(
            ctx.accounts.protocol_config.key(),
            pot_window.key(),
            window_id,
            pot_window.total_redirected_amount,
            total_weight,
            eligible_recipient_count,
            closed_at_ts,
            ctx.bumps.distribution_window,
        );

        emit!(DistributionWindowClosed {
            distribution_window: distribution_window.key(),
            pot_window: pot_window.key(),
            window_id,
            total_redirected_amount: pot_window.total_redirected_amount,
            total_weight,
            eligible_recipient_count,
            closed_at_ts,
        });

        Ok(())
    }

    pub fn distribute_window(
        ctx: Context<DistributeWindow>,
        recipient_key: [u8; 32],
        window_id: i64,
        amount: u64,
        distributed_at_ts: i64,
    ) -> Result<()> {
        require!(amount > 0, CommunityPotError::InvalidDistributionAmount);

        let distribution_window = &mut ctx.accounts.distribution_window;
        require!(
            distribution_window.is_initialized(),
            CommunityPotError::DistributionWindowNotInitialized
        );
        require!(
            distribution_window.window_id == window_id,
            CommunityPotError::WindowIdMismatch
        );

        let receipt = &mut ctx.accounts.distribution_receipt;
        if receipt.is_initialized() {
            return Ok(());
        }

        require!(
            distribution_window.remaining_amount() >= amount,
            CommunityPotError::InsufficientPotBalance
        );

        let protocol_seeds: &[&[&[u8]]] = &[&[
            ProtocolConfig::SEED,
            &[ctx.accounts.protocol_config.bump],
        ]];

        transfer_checked_from_protocol(
            &ctx.accounts.token_program,
            &ctx.accounts.pot_vault,
            &ctx.accounts.recipient_stable_token_account,
            &ctx.accounts.stable_mint,
            &ctx.accounts.protocol_config.to_account_info(),
            protocol_seeds,
            amount,
        )?;

        distribution_window.record_distribution(amount)?;
        let distribution_window_key = distribution_window.key();
        receipt.record(
            distribution_window_key,
            recipient_key,
            amount,
            distributed_at_ts,
            ctx.bumps.distribution_receipt,
        );

        emit!(DistributionPaid {
            distribution_window: distribution_window_key,
            recipient: ctx.accounts.recipient.key(),
            amount,
            distributed_amount: distribution_window.distributed_amount,
            distribution_count: distribution_window.distribution_count,
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
#[instruction(receipt_key: [u8; 32], window_id: i64)]
pub struct RecordRedirect<'info> {
    #[account(
        mut,
        seeds = [ProtocolConfig::SEED],
        bump = protocol_config.bump,
        has_one = authority @ CommunityPotError::UnauthorizedWorker,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + PotWindow::INIT_SPACE,
        seeds = [PotWindow::SEED, &window_id.to_le_bytes()],
        bump,
    )]
    pub window: Account<'info, PotWindow>,
    #[account(
        init,
        payer = authority,
        space = 8 + RedirectReceipt::INIT_SPACE,
        seeds = [RedirectReceipt::SEED, window.key().as_ref(), &receipt_key],
        bump,
    )]
    pub receipt: Account<'info, RedirectReceipt>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(window_id: i64)]
pub struct CloseDistributionWindow<'info> {
    #[account(
        mut,
        seeds = [ProtocolConfig::SEED],
        bump = protocol_config.bump,
        has_one = authority @ CommunityPotError::UnauthorizedWorker,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(
        seeds = [PotWindow::SEED, &window_id.to_le_bytes()],
        bump = window.bump,
    )]
    pub window: Account<'info, PotWindow>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + DistributionWindow::INIT_SPACE,
        seeds = [DistributionWindow::SEED, &window_id.to_le_bytes()],
        bump,
    )]
    pub distribution_window: Account<'info, DistributionWindow>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(recipient_key: [u8; 32], window_id: i64)]
pub struct DistributeWindow<'info> {
    #[account(
        seeds = [ProtocolConfig::SEED],
        bump = protocol_config.bump,
        has_one = authority @ CommunityPotError::UnauthorizedWorker,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [DistributionWindow::SEED, &window_id.to_le_bytes()],
        bump = distribution_window.bump,
    )]
    pub distribution_window: Account<'info, DistributionWindow>,
    #[account(
        mut,
        associated_token::mint = stable_mint,
        associated_token::authority = protocol_config,
        associated_token::token_program = token_program,
    )]
    pub pot_vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: payout destination wallet; used only as the authority/owner of
    /// `recipient_stable_token_account` (its ATA). No data is read from this
    /// account. The payout amount is bounded on-chain by the distribution_window
    /// remaining-amount cap and the distribution_receipt double-pay guard, so an
    /// arbitrary pubkey is safe here.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = stable_mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_stable_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = authority,
        space = 8 + DistributionReceipt::INIT_SPACE,
        seeds = [
            DistributionReceipt::SEED,
            distribution_window.key().as_ref(),
            &recipient_key
        ],
        bump,
    )]
    pub distribution_receipt: Account<'info, DistributionReceipt>,
    #[account(address = protocol_config.stable_mint)]
    pub stable_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub stable_mint: Pubkey,
    pub bump: u8,
}

impl ProtocolConfig {
    pub const SEED: &'static [u8] = b"protocol";
}

#[account]
#[derive(InitSpace)]
pub struct PotWindow {
    pub protocol_config: Pubkey,
    pub window_id: i64,
    pub total_redirected_amount: u64,
    pub redirect_count: u32,
    pub opened_at_ts: i64,
    pub last_recorded_at_ts: i64,
    pub status: u8,
    pub bump: u8,
}

impl PotWindow {
    pub const SEED: &'static [u8] = b"window";

    fn initialize(
        &mut self,
        protocol_config: Pubkey,
        window_id: i64,
        bump: u8,
        opened_at_ts: i64,
    ) {
        self.protocol_config = protocol_config;
        self.window_id = window_id;
        self.total_redirected_amount = 0;
        self.redirect_count = 0;
        self.opened_at_ts = opened_at_ts;
        self.last_recorded_at_ts = opened_at_ts;
        self.status = OPEN_STATUS;
        self.bump = bump;
    }

    fn is_initialized(&self) -> bool {
        self.protocol_config != Pubkey::default()
    }

    fn record_redirect(&mut self, amount: u64, recorded_at_ts: i64) -> Result<()> {
        self.total_redirected_amount = self
            .total_redirected_amount
            .checked_add(amount)
            .ok_or(CommunityPotError::NumericalOverflow)?;
        self.redirect_count = self
            .redirect_count
            .checked_add(1)
            .ok_or(CommunityPotError::NumericalOverflow)?;
        self.last_recorded_at_ts = recorded_at_ts;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct DistributionWindow {
    pub protocol_config: Pubkey,
    pub pot_window: Pubkey,
    pub window_id: i64,
    pub total_redirected_amount: u64,
    pub total_weight: u64,
    pub eligible_recipient_count: u32,
    pub distributed_amount: u64,
    pub distribution_count: u32,
    pub closed_at_ts: i64,
    pub status: u8,
    pub bump: u8,
}

impl DistributionWindow {
    pub const SEED: &'static [u8] = b"distribution";

    #[allow(clippy::too_many_arguments)]
    fn initialize(
        &mut self,
        protocol_config: Pubkey,
        pot_window: Pubkey,
        window_id: i64,
        total_redirected_amount: u64,
        total_weight: u64,
        eligible_recipient_count: u32,
        closed_at_ts: i64,
        bump: u8,
    ) {
        self.protocol_config = protocol_config;
        self.pot_window = pot_window;
        self.window_id = window_id;
        self.total_redirected_amount = total_redirected_amount;
        self.total_weight = total_weight;
        self.eligible_recipient_count = eligible_recipient_count;
        self.distributed_amount = 0;
        self.distribution_count = 0;
        self.closed_at_ts = closed_at_ts;
        self.status = CLOSED_STATUS;
        self.bump = bump;
    }

    fn is_initialized(&self) -> bool {
        self.protocol_config != Pubkey::default()
    }

    fn remaining_amount(&self) -> u64 {
        self.total_redirected_amount
            .saturating_sub(self.distributed_amount)
    }

    fn record_distribution(&mut self, amount: u64) -> Result<()> {
        self.distributed_amount = self
            .distributed_amount
            .checked_add(amount)
            .ok_or(CommunityPotError::NumericalOverflow)?;
        self.distribution_count = self
            .distribution_count
            .checked_add(1)
            .ok_or(CommunityPotError::NumericalOverflow)?;
        if self.distributed_amount >= self.total_redirected_amount {
            self.status = DISTRIBUTED_STATUS;
        }
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct RedirectReceipt {
    pub window: Pubkey,
    pub receipt_key: [u8; 32],
    pub amount: u64,
    pub recorded_at_ts: i64,
    pub bump: u8,
}

impl RedirectReceipt {
    pub const SEED: &'static [u8] = b"redirect";

    fn record(
        &mut self,
        window: Pubkey,
        receipt_key: [u8; 32],
        amount: u64,
        bump: u8,
        recorded_at_ts: i64,
    ) {
        self.window = window;
        self.receipt_key = receipt_key;
        self.amount = amount;
        self.recorded_at_ts = recorded_at_ts;
        self.bump = bump;
    }

    fn is_initialized(&self) -> bool {
        self.window != Pubkey::default()
    }
}

#[account]
#[derive(InitSpace)]
pub struct DistributionReceipt {
    pub distribution_window: Pubkey,
    pub recipient_key: [u8; 32],
    pub amount: u64,
    pub distributed_at_ts: i64,
    pub bump: u8,
}

impl DistributionReceipt {
    pub const SEED: &'static [u8] = b"distribution-receipt";

    fn record(
        &mut self,
        distribution_window: Pubkey,
        recipient_key: [u8; 32],
        amount: u64,
        distributed_at_ts: i64,
        bump: u8,
    ) {
        self.distribution_window = distribution_window;
        self.recipient_key = recipient_key;
        self.amount = amount;
        self.distributed_at_ts = distributed_at_ts;
        self.bump = bump;
    }

    fn is_initialized(&self) -> bool {
        self.distribution_window != Pubkey::default()
    }
}

#[event]
pub struct RedirectRecorded {
    pub window: Pubkey,
    pub window_id: i64,
    pub amount: u64,
    pub total_redirected_amount: u64,
    pub redirect_count: u32,
}

#[event]
pub struct DistributionWindowClosed {
    pub distribution_window: Pubkey,
    pub pot_window: Pubkey,
    pub window_id: i64,
    pub total_redirected_amount: u64,
    pub total_weight: u64,
    pub eligible_recipient_count: u32,
    pub closed_at_ts: i64,
}

#[event]
pub struct DistributionPaid {
    pub distribution_window: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub distributed_amount: u64,
    pub distribution_count: u32,
}

#[error_code]
pub enum CommunityPotError {
    #[msg("Only the configured worker authority may record redirects.")]
    UnauthorizedWorker,
    #[msg("Redirect amount must be greater than zero.")]
    InvalidRedirectAmount,
    #[msg("Pot window protocol does not match the configured protocol.")]
    WindowProtocolMismatch,
    #[msg("Pot window id does not match the expected window.")]
    WindowIdMismatch,
    #[msg("Pot window is not initialized.")]
    PotWindowNotInitialized,
    #[msg("Distribution window is not initialized.")]
    DistributionWindowNotInitialized,
    #[msg("Distribution amount must be greater than zero.")]
    InvalidDistributionAmount,
    #[msg("CommunityPot vault does not have enough balance for this payout.")]
    InsufficientPotBalance,
    #[msg("Numerical overflow.")]
    NumericalOverflow,
}

fn transfer_checked_from_protocol<'info>(
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

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded_window(window_id: i64) -> PotWindow {
        PotWindow {
            protocol_config: Pubkey::new_unique(),
            window_id,
            total_redirected_amount: 0,
            redirect_count: 0,
            opened_at_ts: 0,
            last_recorded_at_ts: 0,
            status: OPEN_STATUS,
            bump: 255,
        }
    }

    #[test]
    fn record_redirect_accumulates_totals() {
        let window = seeded_window(202603);
        let mut window = window;
        window.record_redirect(100_000, 1_700_000_000).unwrap();
        window.record_redirect(250_000, 1_700_010_000).unwrap();

        assert_eq!(window.total_redirected_amount, 350_000);
        assert_eq!(window.redirect_count, 2);
        assert_eq!(window.last_recorded_at_ts, 1_700_010_000);
    }

    #[test]
    fn receipt_marks_initialized_after_record() {
        let mut receipt = RedirectReceipt {
            window: Pubkey::default(),
            receipt_key: [0; 32],
            amount: 0,
            recorded_at_ts: 0,
            bump: 0,
        };

        assert!(!receipt.is_initialized());
        receipt.record(Pubkey::new_unique(), [7; 32], 123, 200, 1_700_000_000);
        assert!(receipt.is_initialized());
        assert_eq!(receipt.amount, 123);
    }

    #[test]
    fn window_initialize_sets_expected_defaults() {
        let protocol = Pubkey::new_unique();
        let mut window = PotWindow {
            protocol_config: Pubkey::default(),
            window_id: 0,
            total_redirected_amount: 0,
            redirect_count: 0,
            opened_at_ts: 0,
            last_recorded_at_ts: 0,
            status: 99,
            bump: 0,
        };

        window.initialize(protocol, 202603, 201, 1_700_000_000);

        assert_eq!(window.protocol_config, protocol);
        assert_eq!(window.window_id, 202603);
        assert_eq!(window.total_redirected_amount, 0);
        assert_eq!(window.redirect_count, 0);
        assert_eq!(window.status, OPEN_STATUS);
        assert_eq!(window.bump, 201);
    }

    #[test]
    fn distribution_window_initialize_sets_closed_snapshot() {
        let protocol = Pubkey::new_unique();
        let pot_window = Pubkey::new_unique();
        let mut distribution_window = DistributionWindow {
            protocol_config: Pubkey::default(),
            pot_window: Pubkey::default(),
            window_id: 0,
            total_redirected_amount: 0,
            total_weight: 0,
            eligible_recipient_count: 0,
            distributed_amount: 0,
            distribution_count: 0,
            closed_at_ts: 0,
            status: OPEN_STATUS,
            bump: 0,
        };

        distribution_window.initialize(
            protocol,
            pot_window,
            202603,
            100_000,
            1_000_000,
            3,
            1_700_100_000,
            211,
        );

        assert_eq!(distribution_window.protocol_config, protocol);
        assert_eq!(distribution_window.pot_window, pot_window);
        assert_eq!(distribution_window.window_id, 202603);
        assert_eq!(distribution_window.total_redirected_amount, 100_000);
        assert_eq!(distribution_window.total_weight, 1_000_000);
        assert_eq!(distribution_window.eligible_recipient_count, 3);
        assert_eq!(distribution_window.distributed_amount, 0);
        assert_eq!(distribution_window.distribution_count, 0);
        assert_eq!(distribution_window.closed_at_ts, 1_700_100_000);
        assert_eq!(distribution_window.status, CLOSED_STATUS);
        assert_eq!(distribution_window.bump, 211);
        assert!(distribution_window.is_initialized());
    }

    #[test]
    fn distribution_window_marks_distributed_when_fully_paid() {
        let protocol = Pubkey::new_unique();
        let pot_window = Pubkey::new_unique();
        let mut distribution_window = DistributionWindow {
            protocol_config: Pubkey::default(),
            pot_window: Pubkey::default(),
            window_id: 0,
            total_redirected_amount: 0,
            total_weight: 0,
            eligible_recipient_count: 0,
            distributed_amount: 0,
            distribution_count: 0,
            closed_at_ts: 0,
            status: OPEN_STATUS,
            bump: 0,
        };

        distribution_window.initialize(
            protocol,
            pot_window,
            202604,
            50_000,
            1_000_000,
            1,
            1_700_200_000,
            202,
        );
        distribution_window.record_distribution(50_000).unwrap();

        assert_eq!(distribution_window.distributed_amount, 50_000);
        assert_eq!(distribution_window.distribution_count, 1);
        assert_eq!(distribution_window.status, DISTRIBUTED_STATUS);
        assert_eq!(distribution_window.remaining_amount(), 0);
    }

    // ── New tests ──────────────────────────────────────────────────────

    #[test]
    fn record_redirect_near_u64_max_overflows() {
        let mut window = seeded_window(202605);
        window.total_redirected_amount = u64::MAX - 10;

        let result = window.record_redirect(20, 1_700_100_000);
        assert!(result.is_err());
    }

    #[test]
    fn remaining_amount_saturates_when_distributed_exceeds_total() {
        let protocol = Pubkey::new_unique();
        let pot_window = Pubkey::new_unique();
        let mut dw = DistributionWindow {
            protocol_config: Pubkey::default(),
            pot_window: Pubkey::default(),
            window_id: 0,
            total_redirected_amount: 0,
            total_weight: 0,
            eligible_recipient_count: 0,
            distributed_amount: 0,
            distribution_count: 0,
            closed_at_ts: 0,
            status: OPEN_STATUS,
            bump: 0,
        };

        dw.initialize(protocol, pot_window, 202606, 100, 1_000, 1, 1_700_300_000, 210);
        // Manually set distributed > total to exercise saturating_sub
        dw.distributed_amount = 200;
        assert_eq!(dw.remaining_amount(), 0);
    }

    #[test]
    fn record_distribution_overflow_is_caught() {
        let protocol = Pubkey::new_unique();
        let pot_window = Pubkey::new_unique();
        let mut dw = DistributionWindow {
            protocol_config: Pubkey::default(),
            pot_window: Pubkey::default(),
            window_id: 0,
            total_redirected_amount: 0,
            total_weight: 0,
            eligible_recipient_count: 0,
            distributed_amount: 0,
            distribution_count: 0,
            closed_at_ts: 0,
            status: OPEN_STATUS,
            bump: 0,
        };

        dw.initialize(
            protocol,
            pot_window,
            202607,
            u64::MAX,
            1_000,
            1,
            1_700_400_000,
            220,
        );
        dw.distributed_amount = u64::MAX - 5;
        let result = dw.record_distribution(10);
        assert!(result.is_err());
    }

    #[test]
    fn partial_distribution_keeps_closed_status() {
        let protocol = Pubkey::new_unique();
        let pot_window = Pubkey::new_unique();
        let mut dw = DistributionWindow {
            protocol_config: Pubkey::default(),
            pot_window: Pubkey::default(),
            window_id: 0,
            total_redirected_amount: 0,
            total_weight: 0,
            eligible_recipient_count: 0,
            distributed_amount: 0,
            distribution_count: 0,
            closed_at_ts: 0,
            status: OPEN_STATUS,
            bump: 0,
        };

        dw.initialize(protocol, pot_window, 202608, 100_000, 1_000, 2, 1_700_500_000, 230);
        dw.record_distribution(40_000).unwrap();

        assert_eq!(dw.distributed_amount, 40_000);
        assert_eq!(dw.distribution_count, 1);
        assert_eq!(dw.status, CLOSED_STATUS);
        assert_eq!(dw.remaining_amount(), 60_000);
    }

    #[test]
    fn pot_window_is_initialized_returns_false_for_default_pubkey() {
        let window = PotWindow {
            protocol_config: Pubkey::default(),
            window_id: 0,
            total_redirected_amount: 0,
            redirect_count: 0,
            opened_at_ts: 0,
            last_recorded_at_ts: 0,
            status: OPEN_STATUS,
            bump: 0,
        };
        assert!(!window.is_initialized());
    }

    #[test]
    fn redirect_receipt_is_initialized_returns_false_when_window_is_default() {
        let receipt = RedirectReceipt {
            window: Pubkey::default(),
            receipt_key: [0; 32],
            amount: 0,
            recorded_at_ts: 0,
            bump: 0,
        };
        assert!(!receipt.is_initialized());
    }

    #[test]
    fn distribution_window_is_initialized_returns_false_for_default() {
        let dw = DistributionWindow {
            protocol_config: Pubkey::default(),
            pot_window: Pubkey::default(),
            window_id: 0,
            total_redirected_amount: 0,
            total_weight: 0,
            eligible_recipient_count: 0,
            distributed_amount: 0,
            distribution_count: 0,
            closed_at_ts: 0,
            status: OPEN_STATUS,
            bump: 0,
        };
        assert!(!dw.is_initialized());
    }
}

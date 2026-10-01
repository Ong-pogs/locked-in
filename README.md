# Locked In

> [!IMPORTANT]
> `lockedin.quest` is live on Solana mainnet with real USDC (v2).
> Small caps are enforced on-chain: 10 to 50 USDC per lock, 1,000 USDC global TVL cap, and 0 platform fee.
> The smart contract has not undergone a third-party security audit.
> Locked principal sits in Kamino lending reserves, so deposits carry smart contract and protocol risk. The deposit screen warns users of these risks.
> A devnet deployment remains available for testing.

Locked In is a Solana-native learning product built around a simple bet on human behavior:

People are much more likely to stay consistent when progress feels real, visible, and costly to lose.

Instead of asking users to rely on willpower alone, Locked In turns online learning into a commitment device. Users lock stablecoin principal for the duration of a course, keep ownership of that principal, and let yield become the consequence layer for whether they stay on track.

## The Problem

Most online learning platforms have the same failure mode:

- signing up is easy
- starting is easy
- quitting is also easy

People know they should learn. They still stop.

That is the real retention problem. Streaks, badges, and XP help, but on their own they are usually too soft. When breaking the habit costs nothing, most users eventually drift.

Locked In exists to solve that gap between intention and follow-through.

## The Core Idea

Locked In combines three systems into one product:

1. A real commitment device
2. Habit-building gamification
3. Transparent on-chain yield logic

The user locks 10 to 50 USDC for a course.

Principal is not slashed or taken away arbitrarily. It is deposited into Kamino lending reserves to earn real yield.

The pressure comes from the yield generated on top of the locked capital:

- stay consistent with daily lessons
- protect your streak
- keep 100% of the yield you generated

If you lapse repeatedly, the product redirects your yield to a community pot that rewards learners who stayed consistent.

That makes the system high-pressure without being recklessly punitive.

## Why This Idea Works

Locked In is designed around a few behavioral truths.

### 1. Loss aversion is stronger than generic rewards

People protect what feels like theirs.

A normal streak counter is nice. Yield that you could have kept is harder to ignore. Locked In uses that emotional difference. The user is not just chasing points. They are trying not to waste value they already feel attached to.

### 2. Commitment works better than vague intention

Locking capital creates friction against quitting.

The user makes a deliberate decision to complete a course. The lock lasts until the course is completed, turning casual browsing into an active commitment.

### 3. Gamification works better when tied to real consequence

Yield routing turns abstract financial logic into something users understand every day. It provides tangible feedback for daily discipline.

### 4. Pressure should escalate gradually, not instantly

Locked In does not jump straight from a single missed day to total loss.

It uses a stepped consequence model that touches yield routing only, never your principal and never your lock duration:

- streak shields absorb missed days first
- if all shields are exhausted, the 1st lapse redirects 50% of generated yield to the community pot
- a 2nd lapse redirects 100% of generated yield to the community pot

That gives users opportunities to recover while preserving meaningful stakes. Missed days penalize yield routing only. They never extend the lock.

### 5. Social reinforcement matters

Forfeited yield does not disappear into a void. It flows into a community pot.

That creates a strong social loop: users who stay disciplined benefit from the inconsistency of users who do not.

## How Locked In Works

### Step 1: Sign in

Sign in with Privy using a Google account or a Solana wallet. The backend verifies the Privy session and issues its own JWT.

### Step 2: Choose a course and lock USDC

Select a course and lock between 10 and 50 USDC. The deposit flow executes two on-chain transactions:

1. `open_lock_v2`: initializes the lock account and collateral token account.
2. `lock_funds_v2`: deposits the USDC into Kamino lending reserves and issues collateral shares to the lock.

There is no fixed time duration. The lock remains active until the course is completed.

### Step 3: Complete daily lessons

Work through interactive daily lessons. Answers are verified server-side by the backend.

### Step 4: Protect your streak with shields

Each lock starts with 3 streak shields. Shields refill on active lesson days. If you miss a day, a shield is burned and your streak is paused without penalty.

### Step 5: Lapse consequences

If you miss a day with zero shields remaining, a lapse occurs:

- 1st lapse: 50% of the lock's yield is routed to the community pot.
- 2nd lapse: 100% of the lock's yield is routed to the community pot.

A nightly lapse-sweep cron runs at 00:30 UTC to evaluate the previous day for all active locks.

### Step 6: Complete the course and claim

When all lessons in the course are completed, the backend signs an Ed25519 completion voucher carrying your final yield tier.

You submit the `claim_v2` transaction:

- the program redeems collateral shares from Kamino
- your principal is returned to your wallet (less tiny rounding dust, or less if Kamino ever suffers a loss, since the owner absorbs any shortfall)
- generated yield is split between you, the community pot, and the fee vault based on your yield tier

Claiming is the exit path. There is no separate unlock step.

### Safety valve

If a lock is abandoned, anyone can call `force_return_v2` after 180 days from lock creation. The principal returns to the owner, and all accumulated yield routes to the community pot.

## Glossary

| Concept | Meaning |
| --- | --- |
| Lock | Escrowed USDC principal deposited into Kamino for the duration of a course |
| Course | A structured curriculum of interactive lessons on Web3 and Solana topics |
| Streak | Consecutive days with verified lesson completions |
| Streak Shields | 3 shields that absorb missed days and refill on active study days |
| Lapse | A missed day after all shields are exhausted (1st lapse forfeits 50% yield, 2nd forfeits 100%) |
| Voucher and Claim | Server-signed Ed25519 voucher and on-chain transaction that redeems Kamino shares, returns principal, and splits yield |
| Community Pot | Monthly reward pool funded by forfeited yield, distributed to active learners with positive streaks |
| Arena | 1v1 asynchronous quiz duels (7 questions, 20s each, Elo rating starting at 1200, XP rewards) |
| Season Stake | Staking an active course lock on a 30-day Arena season; negative rating change drops one yield tier |

## Why Solana

Locked In relies on high-speed, low-cost financial infrastructure:

- low transaction fees for user operations
- fast transaction finality
- seamless onboarding via Privy and embedded wallets
- native USDC stablecoin liquidity
- composability with Kamino lending reserves

## What We Have Built

### 1. On-chain program

The Anchor program `locked_in` handles custody, Kamino integration, and community pot accounting:

- Mainnet Program ID: `FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6` (merged vault v2 and community pot)
- Mainnet USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Real Kamino Lending Program: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- Devnet v2 Vault Program ID: `EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN`
- Devnet Pot / v1 Program ID: `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav`
- Devnet USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (with mock Kamino reserve)

### 2. Backend services

A Fastify API server hosted on Render (`https://locked-in-backend-oetf.onrender.com`):

- Privy authentication session exchange for JWT tokens
- Course catalog delivery and lesson progress tracking
- Server-side answer validation (with optional hybrid OpenAI evaluation)
- Nightly lapse sweep evaluating streaks and shield deductions
- Monthly community pot accounting and distribution transactions
- Arena matchmaking queue, invite challenge creation, and 30-day season sweeps
- Ed25519 voucher signing for course completion claims
- Gas stipend service: disburses a one-time 0.005 SOL stipend to onboarding wallets (capped at 200 wallets)

### 3. Web application

A Progressive Web App built with Next.js 16 (`web-app/`):

- Privy onboarding and wallet connection
- Course catalog and interactive lesson player
- v2 deposit modal (`open_lock_v2` and `lock_funds_v2`)
- v2 dashboard with position card, live APY chip, flame gauge, shield pips, and penalty banners
- 1v1 Arena duels (matchmaking queue, direct links, 7-question timed matches, ladder, and season staking)
- Practice mode for completed lessons
- Community pot overview and distribution history
- Global leaderboard ranked by streak and locked amount
- Claim page with voucher redemption and yield summary
- Legacy routes (`/alchemy`, `/shop`, `/inventory`) redirect to `/dashboard`

### 4. Documentation site

A Nextra-based documentation portal located in `docs-site/`, targeting `docs.lockedin.quest`.

## Repo Structure

- `web-app/`: Next.js 16 PWA frontend
- `backend/`: Fastify API server, SQL migrations, background cron workers
- `docs-site/`: Nextra documentation portal targeting `docs.lockedin.quest`
- `programs/`: Anchor smart contracts (`locked_in` v2 vault and pot, `mock_reserve`)
- `programs-tests/`: Anchor program integration test suites
- `docs/`: Technical specifications, architectural rulings, and runbooks
- `scripts/`: Local dev utilities and cluster inspection scripts

## Technical Docs

For deeper technical context, refer to the documentation in `docs/`:

- Architecture overview: [`docs/00-technical-architecture.md`](docs/00-technical-architecture.md)
- Mainnet deploy runbook: [`docs/mainnet-deploy-runbook.md`](docs/mainnet-deploy-runbook.md)
- Mainnet emergency runbook: [`docs/mainnet-emergency-runbook.md`](docs/mainnet-emergency-runbook.md)
- Mainnet readiness checklist: [`docs/mainnet-readiness-checklist.md`](docs/mainnet-readiness-checklist.md)

Note: Specifications numbered 00 through 10 predate v2. Where older specs differ from current behavior, the codebase, `README.md`, and `HANDOFF.md` represent the source of truth.

## Local Dev

Web app:

```bash
cd web-app
npm install
npm run dev
```

Backend:

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Run database migrations:

```bash
cd backend
npm run migrate
```

Programs:

```bash
cargo test --workspace
```

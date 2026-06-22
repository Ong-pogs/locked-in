# Locked In

> [!IMPORTANT]
> The current public test build is a PWA web app that connects to a backend hosted on Render and uses Solana devnet program/mint configuration.
> This is a QA/testing setup, not a production release.
> Because the current Render deployment may cold-start after inactivity, the first backend-auth or content request can occasionally be slow or need a retry.
> Deposit, unlock, and reward flows in this build should be treated as devnet test flows.

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

The user locks USDC for a course.

That principal is not meant to be arbitrarily taken away. The pressure comes from the yield generated on top of the locked capital:

- stay consistent and keep the system alive
- earn Fuel
- feed the fire to power the Brewer
- earn Ichor to spend in the in-game shop
- keep more of the yield you generated

If you lapse, the product does not slash your principal. Instead, it redirects your yield to a community pot that rewards users who stayed consistent.

That makes the system high-pressure without being recklessly punitive.

## Why This Idea Works

Locked In is designed around a few behavioral truths.

### 1. Loss aversion is stronger than generic rewards

People protect what feels like theirs.

A normal streak counter is nice. Yield that you could have kept is harder to ignore. Locked In uses that emotional difference. The user is not just chasing points. They are trying not to waste value they already feel attached to.

### 2. Commitment works better than vague intention

Locking capital creates friction against quitting.

The user has already made a deliberate decision: "I am doing this for the next 30, 60, or 90 days." That changes the psychology of the product from casual browsing to active commitment.

### 3. Gamification works better when it is tied to real consequence

Fuel, the Brewer, Ichor, and the dungeon layer make the system legible and satisfying. The game layer is not decoration. It turns abstract financial logic into something users can feel and understand every day.

### 4. Pressure should escalate gradually, not instantly

Locked In does not jump straight from "missed one day" to "everything is gone."

It uses a stepped consequence model that touches yield routing only — never your principal and never your lock duration:

- a missed day consumes one streak saver and bumps the yield-redirect tier up a notch
- once all savers are used, a further missed day resets the streak and the redirect stays at its cap
- if the fire goes out, that period's yield routes fully to the community pot until you feed it again

That gives users chances to recover while still preserving stakes. Missed days penalize yield only — they never extend the lock.

### 5. Social reinforcement matters

Forfeited yield does not disappear into a void. It flows into a community pot.

That creates a strong social and economic loop: users who stay disciplined benefit from the inconsistency of users who do not.

## How Locked In Works

### Step 1: Lock in

The user connects a Solana wallet, chooses a course, and locks USDC for the course duration. The vault is pure USDC principal custody; the full principal is returned at resurface.

### Step 2: Earn Fuel through verified learning

All mechanics fire from day 1. Lessons are verified, and verified completion credits Fuel.

Fuel is not a token in a wallet. It is an internal off-chain counter tied to the user's course lock, earned `+1` per lesson up to a cap.

### Step 3: Feed the fire and power the Brewer

Fuel feeds "the fire" in the Brewer. Feeding consumes `1` fuel and extends the fire timer by `+24h`.

While the fire is lit, the yield you generate routes to your wallet. While it is out, that yield routes to the community pot. The fire is the consequence layer made visible — more satisfying than watching tiny stablecoin decimals slowly move.

### Step 4: Earn and spend Ichor

Each lesson completion also awards a random `20-50` Ichor.

Ichor is a pure in-game shop currency — an off-chain counter, not a token and not redeemable for USDC. You spend it in the shop, for example to buy a Streak Saver.

### Step 5: Protect your streak

The user has streak savers. Missing a day does not immediately destroy everything, but it does hurt: a missed day consumes one saver and bumps the yield-redirect tier up.

- 0 savers used: `0%` yield redirected (all to your wallet)
- 1 saver used: `10%` yield redirected
- 2 savers used: `15%` yield redirected
- 3 savers used: `20%` yield redirected
- no savers left and a day missed: streak resets, redirect stays at the `20%` cap

Savers are restored by buying one in the shop with Ichor, which also steps the redirect tier back down. Consequences touch yield routing only — never the principal, never the lock duration.

### Step 6: Resurface

When the lock period ends, the user resurfaces.

Their principal comes back.
What changes is how much yield they preserved, how much Ichor they accumulated to spend in the shop, and whether they finished the course with momentum or regret.

## The Dungeon Model

Locked In uses one core metaphor so the system stays intuitive.

| Concept | Meaning |
| --- | --- |
| Fuel | Energy earned from verified learning, `+1` per lesson |
| Fire | The 24h-per-fuel timer that gates whether yield routes to you or the pot |
| Brewer | The engine that keeps the fire lit and routes yield while it burns |
| Ichor | In-game shop currency earned per lesson; spent in the shop, not redeemable for USDC |
| Savers | Streak protection that lowers the yield-redirect tier |
| Community pot | Yield redirected from inconsistent users to consistent ones |
| Resurface | End-of-lock exit where the principal returns |

Important implementation note:

In the current repo, `Fuel` and `Ichor` are off-chain counters, not SPL tokens. There is no on-chain Ichor and no Ichor-to-USDC redemption.

## Why Solana

Locked In only makes sense if the financial layer can feel native to the product.

Solana gives the project:

- low-cost state changes
- fast user transactions
- practical wallet-based onboarding
- stablecoin-native rails
- a realistic path to transparent yield accounting

## What We Have Built So Far

This repo is not just a concept write-up. The core structure already exists.

### 1. On-chain program

There is a single Anchor program in the repo, `locked_in` (program ID `68im45BCfv8sL6WnVVV9JF4edLkB11udeU9EAApNaEx3`, deployed on devnet). It contains two modules separated only by PDA seeds:

- `vault` (seed `vault-protocol`)
- `pot` (seed `pot-protocol`)

The earlier separate programs are gone: `yield_splitter` was fully removed, and `lock_vault` and `community_pot` were merged into this one program. Folding everything into one program plus a release build cut the default deploy cost from roughly `15.27` SOL to about `2.51` SOL.

The `vault` module is custody-only:

- escrows principal (USDC)
- clock-gated unlock with a full-principal assertion
- PDA-signed payout at resurface
- `unlock_funds` enforces mint binding (`InvalidMint`)

The on-chain `LockAccount` is `130` bytes with `8` fields: `owner`, `course_id_hash`, `stable_mint`, `principal_amount`, `lock_start_ts`, `lock_end_ts`, `status`, `bump`.

The `pot` module handles redirected-yield accounting:

- redirect recording
- distribution window creation and closing
- recipient settlement

Removed from chain in v4: Ichor counters, `redeem_ichor` / `IchorRedeemed`, the fuel-to-Ichor conversion, and the on-chain course policy. None of these are on-chain anymore — Fuel, Ichor, savers, and yield routing all live off-chain in the backend.

### 2. Backend logic

The backend already contains the core runtime layer for the product:

- lesson catalog and content delivery
- wallet challenge / verify / refresh auth
- lesson start and submit flows
- answer validation
- verified completion events
- Fuel, fire-timer, saver, Ichor, and yield-redirect state
- relay and harvest workers that publish to the on-chain program
- community pot accounting and a materialized leaderboard snapshot worker

### 3. App structure

The Next.js app (`web-app/`) already includes the main user-facing surfaces:

- wallet connection
- onboarding
- course selection
- deposit flow
- dungeon home
- lesson flow
- streak status
- alchemy / brewing
- leaderboard
- community pot views
- Ichor shop
- profile and resurface history

## Repo Structure

- `web-app/` - Next.js app
- `backend/` - API, workers, SQL migrations, runtime logic
- `programs/` - the `locked_in` Anchor program
- `programs-tests/` - program test suites
- `docs/` - technical architecture and detailed specs
- `scripts/` - local utilities, cluster profiles, and inspection scripts

## Technical Docs

This README is meant to explain the concept, the product logic, and what exists so far.

For the engineering source of truth, start with the architecture overview at [`docs/00-technical-architecture.md`](/Users/marcus/Projects/locked-in/docs/00-technical-architecture.md), then the current v4 specs: [`docs/08-timer-yield-product.md`](/Users/marcus/Projects/locked-in/docs/08-timer-yield-product.md), [`docs/04-tokenomics.md`](/Users/marcus/Projects/locked-in/docs/04-tokenomics.md), and [`docs/05-yield-calculator.md`](/Users/marcus/Projects/locked-in/docs/05-yield-calculator.md). Where the architecture overview and the v4 specs differ, the v4 specs describe the current state.

If the README and technical docs ever differ, the technical docs should win.

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

Programs:

```bash
cargo test --workspace
```

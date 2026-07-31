# docs.lockedin.quest — Design

Date: 2026-07-31
Status: Approved (tree approved in session; user requested immediate implementation)

## Goal

Public documentation site for Locked In at `docs.lockedin.quest`, scaffolded with
Nextra. Audience: users first, technical readers second. Full transparency on
mechanics and numbers, with a pre-publish walkthrough of every exposed number.

## Decisions

- **Location:** `docs-site/` in this monorepo, its own Vercel project, domain
  `docs.lockedin.quest`.
- **Stack:** Nextra 4 (App Router) + nextra-theme-docs, dark default, brand accent.
- **Source of truth:** current code only. The whitepaper, root CLAUDE.md, and v4
  architecture docs are all stale in places — every fact verified against
  `backend/src`, `web-app/`, and `programs/locked_in/` (v2 shield/lapse model).
- **Content model:** journey ("Start Here") + per-system reference ("Game
  Systems"), a dedicated trust section ("Your Money"), a small technical section
  ("Under the Hood"), and FAQ.

## Page tree

```
Start Here: what-is-locked-in, create-account, fund-wallet, lock-into-course,
            daily-loop, complete-claim-withdraw
Game Systems: village, courses-lessons, streak-shields-lapses, flame,
              xp-levels, practice-mode, leaderboard
Your Money: custody, yield-apy, lapses-and-yield, community-pot,
            claiming-force-return, risks
Under the Hood: architecture, on-chain-program, verification, security
FAQ
```

## Key verified facts the docs encode (2026-07-31)

- Locks: $10 min / $50 max per lock, $1,000 global TVL (beta caps,
  `programs/locked_in/src/caps.rs`); no duration — release on course completion.
- Streak: shields cap 3, +1 per 3 consecutive lesson-days; miss with shield =
  pause; miss without = reset + lapse (max 2, consecutive misses coalesce).
- Yield kept by lapse count: 100% / 50% / 0%. Fee 0 bps in beta (2000 hard max).
- Claim voucher: 90-day expiry, ~0.003 SOL gas gate; force return after 180 days.
- Community pot: monthly window, weight = on-chain principal × current streak.
- Lessons: 55-point pass bar, partial credit, per-question instant check,
  practice mode writes nothing.
- XP: +100 lesson / +500 module / +2000 course; cosmetic only.
- Dead systems that must NOT appear: fuel, fire-feeding, ichor, shop, alchemy,
  inventory, savers (0/10/15/20 tiers), gauntlet, lock durations.

## Publishing gates

1. Full number-by-number walkthrough with the user before deploy.
2. `npm run build` must pass locally.
3. Deploy to Vercel + domain attach done explicitly, not as a side effect.

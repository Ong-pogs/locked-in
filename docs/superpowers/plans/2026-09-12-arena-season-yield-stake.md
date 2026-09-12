# Arena Season Yield Stake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player may stake one of their course locks on a 30-day Arena season; a losing season costs that lock exactly one yield tier, signed into the completion voucher, with principal never at risk and no on-chain program change.

**Architecture:** Three new `arena.*` tables plus one new column on `lesson.completion_vouchers`. The money tier moves to a single owner function, `claimVoucher.effectiveYieldBps({ lapseCount, arenaPenaltyTiers })`, the only code permitted to decide the bps a voucher signs. **The arena module never writes the penalty** — the progress/voucher path *reads* `arena.season_entries` when it signs. That inversion keeps the existing isolation contract (`tests/integration/api/arenaIsolation.test.mjs`) true and unedited, and keeps the dependency one-directional: progress may read arena, arena may never write money.

**Tech Stack:** Node 20 ESM (`.mjs`), Fastify 5, Postgres (Supabase), vitest (`unit` + `api` projects), Next.js 16 App Router + TypeScript, `@solana/web3.js`, `tweetnacl`.

**Spec:** `docs/superpowers/specs/2026-09-12-arena-staking-design.md` (rev 2, post-audit)

## Global Constraints

- **No on-chain change.** `programs/locked_in/` is not touched by any task. No program upgrade, no new instruction, no IDL change.
- **Principal is never at risk.** Only the yield tier moves. No task may write `principal_amount`, extend a lock, or block a claim.
- **`VALID_YIELD_BPS = [10_000, 5_000, 0]`** (`backend/src/lib/claimVoucher.mjs:22`), mirrored by `programs/locked_in/src/settle.rs`. Every signed bps must be one of these three. `buildVoucherMessage` already throws otherwise — do not remove that guard.
- **`arenaPenaltyTiers` is 0 or 1. Never more.** Penalties never accumulate across seasons on one lock.
- **The arena never writes `lesson.*` except `user_xp` / `user_xp_events`.** `tests/integration/api/arenaIsolation.test.mjs` must pass unmodified at the end of every task.
- **Migrations run only through `backend/scripts/migrate.mjs`** (ruling R22). Run it as `node --env-file=.env scripts/migrate.mjs` — the script does not load dotenv itself.
- **New SQL files must be written with LF line endings.** The repo has `core.autocrlf=true`; a CRLF migration changes its checksum against production's tracker and the runner refuses it. Verify with `file backend/sql/<name>.sql` — it must not say "CRLF".
- **Migration numbering:** the next free number is `0065`. `0056` does not exist; do not reuse it.
- **No AI-attribution markers** in any commit message, comment, or file. Write as the author would.
- **`arena.seasons.id` is a NEW axis and is NOT `arena.matches.season`.** The integer column named `season` on `arena.matches` / `arena.ratings` / `arena.queue` is the *rating ladder* generation, permanently 1. Where the stake season is meant, the identifier is always `stake_season_id`. Never advance `arena.matches.season`; `arena.ratings` is keyed `(wallet_address, season)`, so doing so resets every ladder.
- **The season outcome is decided by the summed staked rating delta**, never by comparing global ratings.

---

## File Structure

**Backend — created**

| File | Responsibility |
|---|---|
| `backend/sql/0065_arena_seasons.sql` | Season tables, RLS, `arena_penalty_tiers` column, 0063 header amendment |
| `backend/src/lib/arenaSeason.mjs` | Pure season rules: outcome from staked delta, penalty tiers, pair cap. No I/O. |
| `backend/src/modules/arena/seasonRepository.mjs` | Season data access: open/close, opt-in, read my stake, link matches |
| `backend/src/lib/arenaSeasonSweep.mjs` | Advisory-locked cron body: open, close, settle |
| `backend/scripts/run-arena-season.mjs` | One-shot cron entry hitting the scheduler-gated endpoint |
| `backend/tests/unit/lib/effectiveYieldBps.test.mjs` | The money-tier matrix |
| `backend/tests/unit/lib/arenaSeason.test.mjs` | Season rules |
| `backend/tests/integration/api/arenaSeasonOptIn.test.mjs` | Opt-in guards |
| `backend/tests/integration/api/arenaSeasonSettle.test.mjs` | Settlement + voucher tier end to end |

**Backend — modified**

| File | Change |
|---|---|
| `backend/src/lib/claimVoucher.mjs` | `yieldBpsForLapses` → `effectiveYieldBps({lapseCount, arenaPenaltyTiers})`; `issueVoucher` gains `arenaPenaltyTiers` |
| `backend/src/lib/shieldLapseEngine.mjs` | `userYieldBps` → `lapseRedirectBps` (rename only; same maths) |
| `backend/src/modules/progress/repository.mjs` | Voucher issue reads the penalty; persist stores it; stored-read replays it |
| `backend/src/modules/progress/routes.mjs` | `POST /voucher` becomes read-through |
| `backend/src/modules/arena/settle.mjs` | Writes `season_match_links`; season-scoped repeat damper |
| `backend/src/modules/arena/routes.mjs` | Season endpoints + internal season cron endpoint |
| `backend/src/lib/arenaRating.mjs` | Correct the "rating buys nothing" comment |
| `backend/src/config.mjs` | `arenaSeasonDays` |
| `render.yaml` | `locked-in-arena-season` cron |

**Web app — created / modified**

| File | Change |
|---|---|
| `web-app/types/arena.ts` | `ArenaStakeEntry`, `ArenaSeason` |
| `web-app/services/api/arena/arenaApi.ts` | `getSeason`, `getMyStake`, `stakeSeason` |
| `web-app/lib/arenaStake.ts` | **created** — copy + days-remaining rules |
| `web-app/app/arena/StakePanel.tsx` | **created** — opt-in, standing indicator, settlement notice |
| `web-app/app/arena/page.tsx` | Mounts `StakePanel` |
| `web-app/app/claim/[courseId]/page.tsx` | At-claim tier notice |
| `web-app/__tests__/lib/arenaStake.test.ts` | Copy/formatting rules |

---

## Phase 1 — the loser side (Tasks 1–12)

### Task 1: The money tier gets exactly one owner

The audit's fatal finding: the spec named `shieldLapseEngine.userYieldBps`, but the bps actually signed into the 91-byte voucher comes from `claimVoucher.yieldBpsForLapses` (`claimVoucher.mjs:78`). `shieldLapseEngine.userYieldBps` is used at exactly one place — `repository.mjs:4247`, computing a *redirect* number for bookkeeping. Two identically-shaped functions, one on the signing path and one not, is how a penalty gets implemented into a display number.

**Files:**
- Modify: `backend/src/lib/claimVoucher.mjs:24-33,72-90`
- Modify: `backend/src/lib/shieldLapseEngine.mjs:19-25`
- Modify: `backend/src/modules/progress/repository.mjs:32-33,410,4247`
- Test: `backend/tests/unit/lib/effectiveYieldBps.test.mjs` (create)

**Interfaces:**
- Produces: `effectiveYieldBps({ lapseCount: number, arenaPenaltyTiers?: number }): 10000|5000|0`
- Produces: `issueVoucher({ programId, authoritySecretKey, owner, courseIdHash, lapseCount, arenaPenaltyTiers, expiry })` — return shape unchanged
- Produces: `lapseRedirectBps(lapseCount): number` (renamed from `userYieldBps`)
- Consumes: nothing

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/lib/effectiveYieldBps.test.mjs`:

```js
// The money tier. This is the only function allowed to decide the bps that a
// completion voucher signs, so its whole input space is asserted here rather
// than sampled — a wrong cell in this table is a user losing real yield.
import { describe, it, expect } from 'vitest';
import { effectiveYieldBps, VALID_YIELD_BPS } from '../../../src/lib/claimVoucher.mjs';

describe('effectiveYieldBps', () => {
  it('reproduces the lapse-only ladder when nothing is staked', () => {
    expect(effectiveYieldBps({ lapseCount: 0 })).toBe(10_000);
    expect(effectiveYieldBps({ lapseCount: 1 })).toBe(5_000);
    expect(effectiveYieldBps({ lapseCount: 2 })).toBe(0);
    expect(effectiveYieldBps({ lapseCount: 7 })).toBe(0);
  });

  it('an arena forfeit costs exactly one tier', () => {
    expect(effectiveYieldBps({ lapseCount: 0, arenaPenaltyTiers: 1 })).toBe(5_000);
    expect(effectiveYieldBps({ lapseCount: 1, arenaPenaltyTiers: 1 })).toBe(0);
  });

  it('never drops below the floor however the inputs are stacked', () => {
    expect(effectiveYieldBps({ lapseCount: 2, arenaPenaltyTiers: 1 })).toBe(0);
    expect(effectiveYieldBps({ lapseCount: 99, arenaPenaltyTiers: 99 })).toBe(0);
  });

  it('clamps arenaPenaltyTiers to 0..1 — penalties never accumulate', () => {
    // A 180-day lock can span six seasons. If tiers accumulated, season 3
    // would zero a lock whose owner lapsed nothing.
    expect(effectiveYieldBps({ lapseCount: 0, arenaPenaltyTiers: 2 })).toBe(5_000);
    expect(effectiveYieldBps({ lapseCount: 0, arenaPenaltyTiers: 6 })).toBe(5_000);
  });

  it('treats garbage as no penalty rather than as a penalty', () => {
    for (const junk of [undefined, null, NaN, -1, 'x', {}]) {
      expect(effectiveYieldBps({ lapseCount: 0, arenaPenaltyTiers: junk })).toBe(10_000);
      expect(effectiveYieldBps({ lapseCount: junk })).toBe(10_000);
    }
  });

  it('always returns a bps the program will accept', () => {
    for (let l = 0; l <= 4; l++) {
      for (let a = 0; a <= 3; a++) {
        expect(VALID_YIELD_BPS).toContain(effectiveYieldBps({ lapseCount: l, arenaPenaltyTiers: a }));
      }
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run --project unit tests/unit/lib/effectiveYieldBps.test.mjs`
Expected: FAIL — `effectiveYieldBps is not a function`.

- [ ] **Step 3: Implement the owner in `claimVoucher.mjs`**

Replace the `yieldBpsForLapses` block (lines 24–33) with:

```js
// The tier ladder. Index 0 keeps all yield, 1 keeps half, 2 keeps none.
const YIELD_TIERS = [10_000, 5_000, 0];
const MAX_TIER = YIELD_TIERS.length - 1;

function clampTier(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), max);
}

/**
 * THE MONEY TIER. This is the ONLY function permitted to decide the bps a
 * completion voucher signs — `issueVoucher` below is its single caller, and
 * every other yield-bps-shaped helper in this codebase is bookkeeping.
 *
 * Two inputs, both of which cost the user real yield:
 *   lapseCount        missed-day lapses, 0..2 (shieldLapseEngine)
 *   arenaPenaltyTiers 1 if the last settled arena stake season on this
 *                     (wallet, course, lock) was a FORFEIT, else 0
 *
 * arenaPenaltyTiers is clamped to 0..1 on purpose: a lock may span several
 * seasons, and an accumulating penalty would zero a position whose owner
 * never missed a day.
 */
export function effectiveYieldBps({ lapseCount = 0, arenaPenaltyTiers = 0 } = {}) {
  const tier = clampTier(lapseCount, MAX_TIER) + clampTier(arenaPenaltyTiers, 1);
  return YIELD_TIERS[Math.min(tier, MAX_TIER)];
}
```

In `issueVoucher` (line 72), add the parameter:

```js
export function issueVoucher({
  programId, authoritySecretKey, owner, courseIdHash,
  lapseCount = 0, arenaPenaltyTiers = 0, expiry,
}) {
```

and replace line 78:

```js
  const bps = effectiveYieldBps({ lapseCount, arenaPenaltyTiers });
```

- [ ] **Step 4: Rename the decoy in `shieldLapseEngine.mjs`**

Replace lines 19–25 with:

```js
// Redirect bookkeeping ONLY — this is not the signed tier. The bps a voucher
// signs comes from claimVoucher.effectiveYieldBps, which also folds in the
// arena stake penalty. Named apart from that owner so the two can never be
// confused at a call site.
export function lapseRedirectBps(lapseCount) {
  const tiers = [10_000, 5_000, 0];
  const n = Math.max(0, Math.min(Number(lapseCount) || 0, MAX_LAPSE));
  return tiers[n];
}
```

- [ ] **Step 5: Update the three call sites in `repository.mjs`**

Lines 32–33:

```js
import { issueVoucher, effectiveYieldBps } from '../../lib/claimVoucher.mjs';
import { applyLessonDay, applyMissDay, lapseRedirectBps } from '../../lib/shieldLapseEngine.mjs';
```

Line 4247:

```js
    redirectBpsAfter = 10_000 - lapseRedirectBps(next.lapseCount);
```

Line 410 (the drift check) — it now reads the voucher row's **stored** penalty, so a correctly-penalised voucher does not log drift forever:

```js
      const expectedBps = effectiveYieldBps({
        lapseCount: Number(row.runtime_lapse_count),
        arenaPenaltyTiers: Number(row.voucher_arena_penalty_tiers ?? 0),
      });
```

- [ ] **Step 6: Run the unit suite**

Run: `cd backend && npx vitest run --project unit`
Expected: PASS. `row.voucher_arena_penalty_tiers` is `undefined` until Tasks 2/4; `?? 0` makes that a no-op.

- [ ] **Step 7: Verify no orphaned references**

Run: `cd backend && grep -rn "yieldBpsForLapses\|userYieldBps" src/ scripts/ tests/`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add backend/src/lib/claimVoucher.mjs backend/src/lib/shieldLapseEngine.mjs \
        backend/src/modules/progress/repository.mjs \
        backend/tests/unit/lib/effectiveYieldBps.test.mjs
git commit -m "refactor(voucher): one owner for the signed yield tier"
```

The commit body should record: `yieldBpsForLapses` decided the bps a voucher signs while `shieldLapseEngine`'s identically-shaped `userYieldBps` only computed a redirect number; two functions that look the same, one of which moves money, is how a change lands on the wrong one.

---

### Task 2: Season schema

**Files:**
- Create: `backend/sql/0065_arena_seasons.sql`

**Interfaces:**
- Produces: tables `arena.seasons`, `arena.season_entries`, `arena.season_match_links`; column `lesson.completion_vouchers.arena_penalty_tiers integer not null default 0`
- Consumes: `arena.matches(id)` from 0063; `lesson.completion_vouchers` from 0047

- [ ] **Step 1: Write the migration**

Create `backend/sql/0065_arena_seasons.sql` **with LF endings**:

```sql
-- 0065: arena stake seasons — the loser side.
--
-- Spec: docs/superpowers/specs/2026-09-12-arena-staking-design.md
--
-- WHAT THIS CHANGES ABOUT 0063
--
-- 0063's header says "Nothing here is convertible into money. Rating buys
-- nothing." That is no longer true, and the sentence is amended at the end of
-- this file rather than left to mislead the next reader. A player may now
-- stake one course lock on a season; losing it costs that lock exactly one
-- yield tier. Principal is untouched either way.
--
-- WHICH "SEASON"
--
-- arena.matches.season / arena.ratings.season / arena.queue.season are the
-- RATING LADDER generation. They are permanently 1 and nothing advances them —
-- arena.ratings is keyed (wallet_address, season), so bumping that integer
-- would reset every ladder. The stake season is a SEPARATE axis and is always
-- spelled stake_season_id.
--
-- WHO WRITES THE PENALTY
--
-- Nothing in the arena module does. arena.season_entries.outcome is written by
-- the season cron; the progress/voucher path READS it when it signs. The
-- dependency points one way on purpose, which is what keeps the isolation
-- contract in tests/integration/api/arenaIsolation.test.mjs true.

-- ---------- Seasons ----------
create table if not exists arena.seasons (
  id         integer primary key,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  status     text not null check (status in ('OPEN', 'CLOSED', 'SETTLED')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- At most one season may be OPEN at a time. This is the mechanism, not a
-- convention: opt-in resolves "the current season" by selecting where
-- status = 'OPEN', and two open seasons would make that ambiguous.
create unique index if not exists arena_seasons_single_open_idx
  on arena.seasons ((status)) where status = 'OPEN';

-- ---------- Entries ----------
-- Keyed (stake_season_id, wallet_address, course_id) and NOT by wallet alone:
-- the tier is signed per (wallet, course) because lesson.completion_vouchers
-- is keyed that way and the lock PDA is [lock-v2, owner, course_id_hash]. A
-- wallet may hold several concurrent locks; only the staked one is penalised.
create table if not exists arena.season_entries (
  stake_season_id integer not null references arena.seasons(id),
  wallet_address  text not null,
  course_id       text not null,
  lock_address    text not null,
  opted_in_at     timestamptz not null default now(),
  consent_version text not null,
  rating_at_start integer not null,
  rating_at_end   integer,
  -- The value that decides the outcome: the sum of this wallet's rating
  -- deltas over COUNTED staked matches. rating_at_* are display only.
  staked_delta    integer,
  outcome         text not null default 'PENDING'
                  check (outcome in ('PENDING', 'KEPT', 'FORFEIT', 'VOID')),
  voided_reason   text,
  settled_at      timestamptz,
  primary key (stake_season_id, wallet_address, course_id)
);

create index if not exists arena_season_entries_pending_idx
  on arena.season_entries (stake_season_id, outcome);
-- The lookup the voucher signer makes on every issue.
create index if not exists arena_season_entries_lookup_idx
  on arena.season_entries (wallet_address, course_id, lock_address, settled_at desc);

-- ---------- Which matches counted ----------
create table if not exists arena.season_match_links (
  stake_season_id integer not null references arena.seasons(id),
  match_id        uuid not null references arena.matches(id) on delete cascade,
  wallet_address  text not null,
  -- false once this pair has already met twice in this season, so a colluding
  -- pair cannot grind a season outcome between themselves.
  counted         boolean not null default true,
  created_at      timestamptz not null default now(),
  primary key (stake_season_id, match_id, wallet_address)
);

create index if not exists arena_season_links_wallet_idx
  on arena.season_match_links (stake_season_id, wallet_address, counted);

-- ---------- RLS ----------
-- Both tables now carry a wallet's money consequence, so they get the same
-- treatment as lesson.completion_vouchers (0047:22-28). arena.seasons itself
-- is public calendar data and is deliberately left open.
alter table arena.season_entries enable row level security;
alter table arena.season_entries force row level security;
drop policy if exists season_entries_wallet_policy on arena.season_entries;
create policy season_entries_wallet_policy
  on arena.season_entries
  using ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address)
  with check ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address);

alter table arena.season_match_links enable row level security;
alter table arena.season_match_links force row level security;
drop policy if exists season_match_links_wallet_policy on arena.season_match_links;
create policy season_match_links_wallet_policy
  on arena.season_match_links
  using ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address)
  with check ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address);

-- ---------- The tier travels with the voucher ----------
-- A voucher is signed at course completion with a 90-day TTL, against a 30-day
-- season, and is re-served or re-signed later. Recomputing the tier at re-issue
-- would hand the same user a different bps depending on when they asked, so the
-- penalty is captured at FIRST issue and replayed verbatim on every re-issue.
alter table lesson.completion_vouchers
  add column if not exists arena_penalty_tiers integer not null default 0;

alter table lesson.completion_vouchers
  drop constraint if exists completion_vouchers_arena_penalty_tiers_check;
alter table lesson.completion_vouchers
  add constraint completion_vouchers_arena_penalty_tiers_check
  check (arena_penalty_tiers >= 0 and arena_penalty_tiers <= 1);

-- ---------- Amend the 0063 claim this change makes false ----------
comment on schema arena is
  'The Arena. Rating is no longer purely cosmetic: as of 0065 a player may '
  'stake ONE course lock on a 30-day season, and a losing season costs that '
  'lock exactly one yield tier (10000 -> 5000 -> 0 bps). Principal is never '
  'at risk. The arena module still writes only arena.* and lesson.user_xp / '
  'lesson.user_xp_events — the voucher signer READS arena.season_entries; '
  'nothing in arena writes a lesson.* money table.';
```

- [ ] **Step 2: Confirm the file is LF**

Run: `cd backend && file sql/0065_arena_seasons.sql`
Expected: `ASCII text` — **not** `with CRLF line terminators`. If CRLF: `sed -i 's/\r$//' sql/0065_arena_seasons.sql`

- [ ] **Step 3: Run it against a throwaway cluster**

```bash
cd backend && node --env-file=.env.test scripts/migrate.mjs
```

Expected: `0065_arena_seasons.sql` applied, no error. If `.env.test` does not exist, start the embedded-postgres cluster the `api` project already uses (`tests/setup/globalSetup.mjs`, Postgres on `:5433` as `test/test`) and point `DATABASE_URL` at it.

- [ ] **Step 4: Verify the shape landed**

```bash
cd backend && node --env-file=.env.test -e "import('./src/lib/db.mjs').then(async ({ query }) => { const t = await query(\"select table_name from information_schema.tables where table_schema='arena' order by 1\"); console.log('arena:', t.rows.map(r => r.table_name).join(', ')); const c = await query(\"select column_name, column_default from information_schema.columns where table_schema='lesson' and table_name='completion_vouchers' and column_name='arena_penalty_tiers'\"); console.log('voucher col:', JSON.stringify(c.rows)); process.exit(0); });"
```

Expected: `arena:` includes `season_entries, season_match_links, seasons`; `voucher col:` shows `arena_penalty_tiers` defaulting to `0`.

- [ ] **Step 5: Commit**

```bash
git add backend/sql/0065_arena_seasons.sql
git commit -m "feat(arena): stake season schema"
```

---

### Task 3: Season rules, pure

**Files:**
- Create: `backend/src/lib/arenaSeason.mjs`
- Modify: `backend/src/lib/arenaRating.mjs:3-5`
- Test: `backend/tests/unit/lib/arenaSeason.test.mjs` (create)

**Interfaces:**
- Produces: `seasonOutcome({ stakedDelta, lockLive }): 'KEPT'|'FORFEIT'|'VOID'`
- Produces: `penaltyTiersFor(outcome): 0|1`
- Produces: `MAX_STAKED_MEETINGS_PER_PAIR = 2`
- Produces: `shouldCountMatch(priorCountedMeetings): boolean`
- Consumes: nothing

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/lib/arenaSeason.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import {
  seasonOutcome, penaltyTiersFor, shouldCountMatch, MAX_STAKED_MEETINGS_PER_PAIR,
} from '../../../src/lib/arenaSeason.mjs';

describe('seasonOutcome', () => {
  it('forfeits only on a negative staked delta', () => {
    expect(seasonOutcome({ stakedDelta: -1, lockLive: true })).toBe('FORFEIT');
    expect(seasonOutcome({ stakedDelta: -48, lockLive: true })).toBe('FORFEIT');
  });

  it('keeps on zero — opting in and playing nothing is safe', () => {
    // Load-bearing. A player who opts in and never plays must not be punished
    // for it, or opting in becomes a trap.
    expect(seasonOutcome({ stakedDelta: 0, lockLive: true })).toBe('KEPT');
  });

  it('keeps on a positive delta', () => {
    expect(seasonOutcome({ stakedDelta: 32, lockLive: true })).toBe('KEPT');
  });

  it('voids when the lock is gone, whatever the delta says', () => {
    // A closed lock cannot be penalised retroactively — there is nothing left
    // to take a tier from, and the user already claimed at the old tier.
    expect(seasonOutcome({ stakedDelta: -99, lockLive: false })).toBe('VOID');
    expect(seasonOutcome({ stakedDelta: 99, lockLive: false })).toBe('VOID');
  });

  it('treats an unreadable delta as KEPT, never as a forfeit', () => {
    for (const junk of [null, undefined, NaN]) {
      expect(seasonOutcome({ stakedDelta: junk, lockLive: true })).toBe('KEPT');
    }
  });
});

describe('penaltyTiersFor', () => {
  it('costs a tier only on FORFEIT', () => {
    expect(penaltyTiersFor('FORFEIT')).toBe(1);
    expect(penaltyTiersFor('KEPT')).toBe(0);
    expect(penaltyTiersFor('VOID')).toBe(0);
    expect(penaltyTiersFor('PENDING')).toBe(0);
    expect(penaltyTiersFor('anything-else')).toBe(0);
  });
});

describe('shouldCountMatch', () => {
  it('counts the first two meetings of a pair, then stops', () => {
    expect(MAX_STAKED_MEETINGS_PER_PAIR).toBe(2);
    expect(shouldCountMatch(0)).toBe(true);
    expect(shouldCountMatch(1)).toBe(true);
    expect(shouldCountMatch(2)).toBe(false);
    expect(shouldCountMatch(9)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run --project unit tests/unit/lib/arenaSeason.test.mjs`
Expected: FAIL — cannot resolve `../../../src/lib/arenaSeason.mjs`.

- [ ] **Step 3: Implement**

Create `backend/src/lib/arenaSeason.mjs`:

```js
// Stake-season rules — pure, no I/O.
//
// Spec: docs/superpowers/specs/2026-09-12-arena-staking-design.md
//
// WHY THE OUTCOME READS A SUMMED DELTA AND NOT A RATING
//
// maybeSettleMatch applies Elo to every COMPLETE match regardless of origin,
// and the repeat-opponent damper resets every 24 hours. Scoring a season on
// global rating would let an accomplice pump a staked wallet with one link
// loss a day at full K. Only matches linked to the season, and only those
// still counted, move the number this file reads.

export const MAX_STAKED_MEETINGS_PER_PAIR = 2;

/**
 * The season's verdict for one entry.
 *
 * lockLive is read fresh from the chain at settle time. A lock that closed
 * mid-season voids: there is no position left to take a tier from, and the
 * owner has already claimed at whatever tier was signed.
 *
 * A null/NaN delta means nothing counted, which is KEPT. This fails safe on
 * purpose — the only direction an unknown may resolve is "no penalty".
 */
export function seasonOutcome({ stakedDelta, lockLive }) {
  if (!lockLive) return 'VOID';
  const delta = Number(stakedDelta);
  if (!Number.isFinite(delta)) return 'KEPT';
  return delta < 0 ? 'FORFEIT' : 'KEPT';
}

/** Tiers this outcome costs the backing lock. Only a FORFEIT costs anything. */
export function penaltyTiersFor(outcome) {
  return outcome === 'FORFEIT' ? 1 : 0;
}

/**
 * Whether a staked match between this pair still moves the season.
 *
 * At a three-wallet population a colluding pair IS the population, so the
 * honest control is narrow: the third and later meetings in one season are
 * recorded but contribute nothing.
 */
export function shouldCountMatch(priorCountedMeetings) {
  const n = Number(priorCountedMeetings);
  if (!Number.isFinite(n) || n < 0) return true;
  return n < MAX_STAKED_MEETINGS_PER_PAIR;
}
```

- [ ] **Step 4: Run the test**

Run: `cd backend && npx vitest run --project unit tests/unit/lib/arenaSeason.test.mjs`
Expected: PASS.

- [ ] **Step 5: Correct the now-false comment in `arenaRating.mjs`**

`backend/src/lib/arenaRating.mjs:3-5` justifies the damper with "because rating buys nothing". Replace that justification with:

```js
// The repeat-opponent damper shrinks K when the same two wallets keep meeting.
// It used to be justified by "rating buys nothing" — as of the stake seasons
// (0065) that is no longer true, so the damper is no longer the only control.
// A staked season is scored on linked matches only, and the third meeting of a
// pair within one season stops counting entirely (lib/arenaSeason.mjs).
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/arenaSeason.mjs backend/tests/unit/lib/arenaSeason.test.mjs \
        backend/src/lib/arenaRating.mjs
git commit -m "feat(arena): season outcome rules"
```

---

### Task 4: The voucher carries its tier

The second fatal audit finding: "at claim time" does not exist here. The voucher is signed post-commit at course completion (`repository.mjs:4946-4949`), served unchanged while unexpired (`repository.mjs:406-423`), re-signed on expiry, lazily healed when missing, and re-signed unconditionally by `POST /voucher` (`routes.mjs:503-527`). Recomputing the tier at any of those points hands the same user a different bps depending on which call their client made.

**Files:**
- Modify: `backend/src/modules/progress/repository.mjs:269-308,317-344,349-360,372-392,406-440`
- Modify: `backend/src/modules/progress/routes.mjs:502-528`

**Interfaces:**
- Consumes: `effectiveYieldBps` (Task 1), `arena_penalty_tiers` column (Task 2)
- Produces: `readArenaPenaltyTiers(walletAddress, courseId, lockAddress): Promise<0|1>`
- Produces: `reissueStoredVoucher(walletAddress, courseId, { lapseCount, arenaPenaltyTiers })`
- Produces: voucher response objects gain `arenaPenaltyTiers: number`

- [ ] **Step 1: Add the reader**

In `backend/src/modules/progress/repository.mjs`, immediately above `issueCourseCompletionVoucher`:

```js
/**
 * Tiers the arena stake costs this lock: 1 iff the most recent SETTLED season
 * entry for (wallet, course, lock) was a FORFEIT, else 0.
 *
 * Reads arena.season_entries. This is the ONLY direction the dependency runs —
 * the arena module never writes a lesson.* money table, which is what keeps
 * tests/integration/api/arenaIsolation.test.mjs true.
 *
 * Fails SAFE: any error, missing table or absent row resolves to 0. A signing
 * path that cannot read the arena must not invent a penalty.
 */
export async function readArenaPenaltyTiers(walletAddress, courseId, lockAddress) {
  try {
    const r = await query(
      `select outcome from arena.season_entries
        where wallet_address = $1 and course_id = $2 and lock_address = $3
          and settled_at is not null
        order by settled_at desc
        limit 1`,
      [walletAddress, courseId, lockAddress],
    );
    return r.rows[0]?.outcome === 'FORFEIT' ? 1 : 0;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 2: Capture the tier at first issue**

In `issueCourseCompletionVoucher`, after the `lapseCount` read (line ~275) and before `const expiry = ...`:

```js
  // The lock PDA is deterministic per (owner, courseIdHash), so it can be
  // derived before signing and used to scope the arena lookup.
  const lockAddress = deriveLockPdaServer(programId, walletAddress, courseId).toBase58();
  const arenaPenaltyTiers = await readArenaPenaltyTiers(walletAddress, courseId, lockAddress);
```

Add `deriveLockPdaServer` to the existing `lockPosition.mjs` import if it is not already there.

Pass it into `issueVoucher` (line ~279):

```js
  const voucher = issueVoucher({
    programId,
    authoritySecretKey,
    owner: walletAddress,
    courseIdHash: courseIdHashBytes(courseId),
    lapseCount,
    arenaPenaltyTiers,
    expiry,
  });
```

Widen the return (line 307):

```js
  return { courseId, lapseCount, arenaPenaltyTiers, ...voucher };
```

- [ ] **Step 3: Add an explicit replay entry point**

Directly below `issueCourseCompletionVoucher`:

```js
/**
 * Re-sign a voucher at a tier that was already decided, rather than at
 * whatever the tier would be today.
 *
 * A voucher is signed at course completion with a 90-day TTL against a 30-day
 * season. Between the two, arena_penalty_tiers can change. If a re-issue
 * recomputed it, a user who asked twice would be handed two different bps for
 * the same completed course — so every re-issue replays the stored value.
 */
export async function reissueStoredVoucher(walletAddress, courseId, stored) {
  const { programId, authoritySecretKey } = voucherSigningMaterial();
  const expiry = Math.floor(Date.now() / 1000) + appConfig.voucherTtlSeconds;
  const lapseCount = Number(stored.lapseCount) || 0;
  const arenaPenaltyTiers = Number(stored.arenaPenaltyTiers) || 0;
  const voucher = issueVoucher({
    programId,
    authoritySecretKey,
    owner: walletAddress,
    courseIdHash: courseIdHashBytes(courseId),
    lapseCount,
    arenaPenaltyTiers,
    expiry,
  });
  return { courseId, lapseCount, arenaPenaltyTiers, ...voucher };
}
```

If `voucherSigningMaterial()` does not exist, extract the `programId` / `authoritySecretKey` resolution from the top of `issueCourseCompletionVoucher` into one and call it from both.

- [ ] **Step 4: Store and serve the column**

In `persistCompletionVoucher` (line 317):

```js
    `INSERT INTO lesson.completion_vouchers
       (wallet_address, course_id, lock_address, lapse_count, arena_penalty_tiers,
        bps, expiry, authority_pubkey, message, signature, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (wallet_address, course_id) DO UPDATE SET
       lock_address = excluded.lock_address,
       lapse_count = excluded.lapse_count,
       arena_penalty_tiers = excluded.arena_penalty_tiers,
       bps = excluded.bps,
       expiry = excluded.expiry,
       authority_pubkey = excluded.authority_pubkey,
       message = excluded.message,
       signature = excluded.signature,
       issued_at = now()`,
    [
      walletAddress,
      courseId,
      voucher.lock,
      voucher.lapseCount,
      voucher.arenaPenaltyTiers ?? 0,
      voucher.bps,
      voucher.expiry,
      voucher.authorityPubkey,
      voucher.message,
      voucher.signature,
    ],
```

In `getStoredCompletionVoucher`'s SELECT (line ~373), add:

```sql
            coalesce(v.arena_penalty_tiers, 0) AS voucher_arena_penalty_tiers,
```

In `voucherRowToResponse` (line 349), add:

```js
    arenaPenaltyTiers: Number(row.voucher_arena_penalty_tiers ?? 0),
```

- [ ] **Step 5: Replay on expiry-reissue**

In `getStoredCompletionVoucher`, branch (c) — "expired, re-issue" (line ~424) — becomes a **replay**:

```js
    // (c) expired — re-sign at the tier that was already decided. Recomputing
    // here would change the bps out from under a user who simply waited.
    if (voucherSigningConfigured()) {
      const voucher = await reissueStoredVoucher(walletAddress, courseId, {
        lapseCount: Number(row.voucher_lapse_count),
        arenaPenaltyTiers: Number(row.voucher_arena_penalty_tiers ?? 0),
      });
      await persistCompletionVoucher(walletAddress, courseId, voucher);
      return voucher;
    }
```

Branch (d) — "completed but never stored" — stays as it is. There is no stored tier to replay, so a first computation is correct there.

- [ ] **Step 6: Make `POST /voucher` read-through**

In `backend/src/modules/progress/routes.mjs`, replace the handler body at lines 505–527:

```js
    async (request) => {
      const courseId = assertPathParam(request.params?.courseId, 'courseId');
      // Read-through, not re-sign. This endpoint used to sign unconditionally,
      // so a client that called POST got a freshly computed tier while a client
      // that read the position endpoint got the stored one — the same user,
      // two different bps, decided by which call their client happened to make.
      // getStoredCompletionVoucher owns issue, replay and the lazy heal.
      const voucher = await getStoredCompletionVoucher(
        request.auth.walletAddress, courseId, { log: request.log },
      );
      if (!voucher) {
        throw new HttpError(403, 'Course not yet complete', 'COURSE_NOT_COMPLETE');
      }
      return voucher;
    },
```

Update the imports: `getStoredCompletionVoucher` in; `issueCourseCompletionVoucher` and `persistCompletionVoucher` out **if** they have no other caller in that file. Ensure `HttpError` is imported.

- [ ] **Step 7: Run the voucher suites**

```bash
cd backend && npx vitest run --project unit && npx vitest run --project api tests/integration/api/voucherAutoIssue.test.mjs tests/integration/api/completionVoucher.test.mjs tests/integration/api/claimAudit.test.mjs
```

Expected: PASS. If a test asserted that `POST /voucher` returns a *newly signed* voucher each call, update it — the new contract is that it returns the stored one, and that is the behaviour being fixed, not a regression.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/progress/repository.mjs backend/src/modules/progress/routes.mjs
git commit -m "fix(voucher): the signed tier is captured once and replayed"
```

---

### Task 5: Season data access

**Files:**
- Create: `backend/src/modules/arena/seasonRepository.mjs`
- Modify: `backend/src/config.mjs` (beside `voucherTtlSeconds`, line ~276)

**Interfaces:**
- Consumes: `arenaSeason.mjs` (Task 3), the 0065 tables (Task 2), `readLockV2AccountFresh` from `backend/src/lib/lockPosition.mjs:233`
- Produces:
  - `getOpenSeason(): Promise<{id, startsAt, endsAt, status} | null>`
  - `ensureOpenSeason(client): Promise<season>`
  - `optIntoSeason(walletAddress, courseId, consentVersion): Promise<{season, entry, created}>`
  - `getMyStake(walletAddress): Promise<entry | null>`
  - `linkMatchForSeason(client, matchId, wallets): Promise<void>`
  - `computeStakedDelta(client, stakeSeasonId, walletAddress): Promise<{stakedDelta, matchesCounted}>`

- [ ] **Step 1: Add the season length to config**

In `backend/src/config.mjs`, beside `voucherTtlSeconds`:

```js
  // Platform-fixed season length. 30 days in production; overridable so a test
  // season can open and settle inside one run rather than one month.
  arenaSeasonDays: optionalInt('ARENA_SEASON_DAYS', 30),
```

- [ ] **Step 2: Write the repository**

Create `backend/src/modules/arena/seasonRepository.mjs`:

```js
// Stake-season data access.
//
// ISOLATION CONTRACT: this module writes arena.* only. The yield tier it
// decides is written to arena.season_entries.outcome; the voucher signer in
// progress/repository.mjs reads it from there. Nothing here writes lesson.*.
import { query, getPool } from '../../lib/db.mjs';
import { badRequest, conflict } from '../../lib/errors.mjs';
import { appConfig } from '../../config.mjs';
import { readLockV2AccountFresh } from '../../lib/lockPosition.mjs';
import { ARENA_START_RATING } from '../../lib/arenaRating.mjs';
import { shouldCountMatch } from '../../lib/arenaSeason.mjs';

export async function getOpenSeason() {
  const r = await query(
    `select id, starts_at as "startsAt", ends_at as "endsAt", status
       from arena.seasons where status = 'OPEN' limit 1`,
  );
  return r.rows[0] ?? null;
}

/**
 * Open a season if none is open. Caller owns the transaction.
 *
 * Starts on a UTC day boundary so the cron, which runs after 00:30 UTC, always
 * sees a season that has fully closed rather than one ending mid-run.
 */
export async function ensureOpenSeason(client) {
  const open = await client.query(
    `select id, starts_at as "startsAt", ends_at as "endsAt", status
       from arena.seasons where status = 'OPEN' limit 1`,
  );
  if (open.rowCount > 0) return open.rows[0];

  const inserted = await client.query(
    `insert into arena.seasons (id, starts_at, ends_at, status)
     values (
       coalesce((select max(id) from arena.seasons), 0) + 1,
       date_trunc('day', now() at time zone 'utc'),
       date_trunc('day', now() at time zone 'utc') + ($1::int * interval '1 day')
         + interval '1 second',
       'OPEN'
     )
     returning id, starts_at as "startsAt", ends_at as "endsAt", status`,
    [appConfig.arenaSeasonDays],
  );
  return inserted.rows[0];
}

/**
 * Stake one course lock on the open season.
 *
 * BINDING HAPPENS HERE, not after N matches. A threshold is under the losing
 * player's control — current rating is readable any time from GET /v1/arena/me,
 * so "play three then it counts" means play two, check, and stop if behind.
 * Binding at opt-in makes the commitment real; a player who then plays nothing
 * has a zero staked delta and forfeits nothing, so opting in stays safe.
 */
export async function optIntoSeason(walletAddress, courseId, consentVersion) {
  const season = await getOpenSeason();
  if (!season) {
    throw badRequest('No arena season is open right now', 'ARENA_SEASON_CLOSED');
  }

  const existing = await query(
    `select stake_season_id as "stakeSeasonId", wallet_address as "walletAddress",
            course_id as "courseId", lock_address as "lockAddress",
            opted_in_at as "optedInAt", rating_at_start as "ratingAtStart", outcome
       from arena.season_entries
      where stake_season_id = $1 and wallet_address = $2 and course_id = $3`,
    [season.id, walletAddress, courseId],
  );
  if (existing.rowCount > 0) return { season, entry: existing.rows[0], created: false };

  // A course that is already complete, or already has a signed voucher, cannot
  // be staked: its tier is frozen and a penalty could never reach it. Refusing
  // is the honest answer — silently accepting a stake that can never be
  // collected would be worse.
  const settled = await query(
    `select 1
       from lesson.user_course_runtime_state r
       left join lesson.completion_vouchers v
         on v.wallet_address = r.wallet_address and v.course_id = r.course_id
      where r.wallet_address = $1 and r.course_id = $2
        and (r.course_completed_at is not null or v.signature is not null)
      limit 1`,
    [walletAddress, courseId],
  );
  if (settled.rowCount > 0) {
    throw conflict(
      'That course is already finished — its yield tier is locked in and cannot be staked',
      'ARENA_STAKE_COURSE_SETTLED',
    );
  }

  // Eligibility is read from the CHAIN, not the database. Uncached and fail-
  // closed: if we cannot prove a live lock, there is no stake.
  const lock = await readLockV2AccountFresh(walletAddress, courseId);
  if (!lock || lock.mismatch || lock.status !== 'ACTIVE' || !(lock.principal > 0n)) {
    throw badRequest(
      'You need an active lock on that course to stake it',
      'ARENA_STAKE_NO_LOCK',
    );
  }

  const rating = await query(
    `select rating from arena.ratings where wallet_address = $1 and season = 1`,
    [walletAddress],
  );

  const inserted = await query(
    `insert into arena.season_entries
       (stake_season_id, wallet_address, course_id, lock_address,
        consent_version, rating_at_start, outcome)
     values ($1, $2, $3, $4, $5, $6, 'PENDING')
     on conflict (stake_season_id, wallet_address, course_id) do nothing
     returning stake_season_id as "stakeSeasonId", wallet_address as "walletAddress",
               course_id as "courseId", lock_address as "lockAddress",
               opted_in_at as "optedInAt", rating_at_start as "ratingAtStart", outcome`,
    [
      season.id, walletAddress, courseId, lock.lockAddress,
      consentVersion, rating.rows[0]?.rating ?? ARENA_START_RATING,
    ],
  );

  // A concurrent duplicate lost the race; re-read rather than error.
  if (inserted.rowCount === 0) {
    const again = await query(
      `select stake_season_id as "stakeSeasonId", wallet_address as "walletAddress",
              course_id as "courseId", lock_address as "lockAddress",
              opted_in_at as "optedInAt", rating_at_start as "ratingAtStart", outcome
         from arena.season_entries
        where stake_season_id = $1 and wallet_address = $2 and course_id = $3`,
      [season.id, walletAddress, courseId],
    );
    return { season, entry: again.rows[0], created: false };
  }
  return { season, entry: inserted.rows[0], created: true };
}

/** Sum of this wallet's rating deltas over COUNTED linked matches. */
export async function computeStakedDelta(client, stakeSeasonId, walletAddress) {
  const r = await client.query(
    `select coalesce(sum(e.delta), 0)::int as "stakedDelta",
            count(*)::int as "matchesCounted"
       from arena.season_match_links l
       join arena.rating_events e
         on e.match_id = l.match_id and e.wallet_address = l.wallet_address
      where l.stake_season_id = $1 and l.wallet_address = $2 and l.counted`,
    [stakeSeasonId, walletAddress],
  );
  return { stakedDelta: r.rows[0].stakedDelta, matchesCounted: r.rows[0].matchesCounted };
}

/**
 * Link a settled match to the open season for its players.
 * Caller owns the transaction — this runs inside maybeSettleMatch's.
 *
 * Only matches where BOTH players hold a PENDING entry are linked. A staked
 * player beating an unstaked one moves the ladder but not the season:
 * otherwise the cheapest way to win a season is to farm people with nothing
 * at risk.
 */
export async function linkMatchForSeason(client, matchId, wallets) {
  const season = await client.query(
    `select id from arena.seasons where status = 'OPEN' limit 1`);
  if (season.rowCount === 0) return;
  const stakeSeasonId = season.rows[0].id;

  const entries = await client.query(
    `select distinct wallet_address from arena.season_entries
      where stake_season_id = $1 and wallet_address = any($2::text[])
        and outcome = 'PENDING'`,
    [stakeSeasonId, wallets],
  );
  if (entries.rowCount < 2) return;

  const prior = await client.query(
    `select count(*)::int as n
       from arena.season_match_links l
       join arena.matches m on m.id = l.match_id
      where l.stake_season_id = $1 and l.counted and l.wallet_address = $2
        and (m.creator = $3 or m.opponent = $3)`,
    [stakeSeasonId, wallets[0], wallets[1]],
  );
  const counted = shouldCountMatch(prior.rows[0].n);

  for (const wallet of wallets) {
    await client.query(
      `insert into arena.season_match_links
         (stake_season_id, match_id, wallet_address, counted)
       values ($1, $2, $3, $4)
       on conflict (stake_season_id, match_id, wallet_address) do nothing`,
      [stakeSeasonId, matchId, wallet, counted],
    );
  }
}

/** What the UI shows a staked player: the season, their entry, live delta. */
export async function getMyStake(walletAddress) {
  const r = await query(
    `select e.stake_season_id as "stakeSeasonId", e.course_id as "courseId",
            e.lock_address as "lockAddress", e.opted_in_at as "optedInAt",
            e.rating_at_start as "ratingAtStart", e.rating_at_end as "ratingAtEnd",
            e.staked_delta as "settledDelta", e.outcome,
            e.voided_reason as "voidedReason", e.settled_at as "settledAt",
            s.starts_at as "startsAt", s.ends_at as "endsAt", s.status as "seasonStatus"
       from arena.season_entries e
       join arena.seasons s on s.id = e.stake_season_id
      where e.wallet_address = $1
      order by e.stake_season_id desc
      limit 1`,
    [walletAddress],
  );
  const entry = r.rows[0];
  if (!entry) return null;

  if (entry.outcome !== 'PENDING') {
    return { ...entry, stakedDelta: entry.settledDelta ?? 0, matchesCounted: 0 };
  }
  const live = await computeStakedDelta(
    { query: (text, params) => query(text, params) },
    entry.stakeSeasonId,
    walletAddress,
  );
  return { ...entry, ...live };
}
```

Note `getPool` is imported for parity with the sibling repository; drop the import if the linter flags it as unused.

- [ ] **Step 3: Verify it loads**

Run: `cd backend && node -e "import('./src/modules/arena/seasonRepository.mjs').then(m => console.log(Object.keys(m).join(', ')))"`
Expected: `getOpenSeason, ensureOpenSeason, optIntoSeason, computeStakedDelta, linkMatchForSeason, getMyStake`

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/arena/seasonRepository.mjs backend/src/config.mjs
git commit -m "feat(arena): season data access"
```

---

### Task 6: Settled matches link to the season

**Files:**
- Modify: `backend/src/modules/arena/settle.mjs:1-5,28-38,~105`

**Interfaces:**
- Consumes: `linkMatchForSeason` (Task 5)
- Produces: rows in `arena.season_match_links` for every settled match with two staked players

- [ ] **Step 1: Widen the repeat damper for staked pairs**

Replace `priorMeetings` (lines 28–38) with:

```js
// How many times these two have already settled a match that still counts
// against the damper.
//
// The window is 24h for unstaked play and the whole open season when BOTH are
// staked: a season is decided by a summed delta, so a pair who reset the
// damper daily could trade a season between themselves at full K.
async function priorMeetings(client, a, b) {
  const staked = await client.query(
    `select count(distinct e.wallet_address)::int as n
       from arena.season_entries e
       join arena.seasons s on s.id = e.stake_season_id and s.status = 'OPEN'
      where e.outcome = 'PENDING' and e.wallet_address = any($1::text[])`,
    [[a, b]],
  );
  const bothStaked = staked.rows[0].n >= 2;

  const r = await client.query(
    `select count(*)::int as n from arena.matches
      where status = 'COMPLETE'
        and resolved_at > case when $3 then
              coalesce((select starts_at from arena.seasons where status = 'OPEN' limit 1),
                       now() - interval '24 hours')
            else now() - interval '24 hours' end
        and ((creator = $1 and opponent = $2) or (creator = $2 and opponent = $1))`,
    [a, b, bothStaked],
  );
  return r.rows[0].n;
}
```

- [ ] **Step 2: Link the match after the rating events are written**

In `maybeSettleMatch`, immediately after the `for` loop that inserts `arena.rating_events` and updates `arena.ratings`, and **before** the XP loop:

```js
  // Record which season this match belongs to, inside the same transaction as
  // the rating events it will later be summed with. Doing it here rather than
  // in a sweep means a link can never disagree with a rating event.
  await linkMatchForSeason(client, matchId, [a.walletAddress, b.walletAddress]);
```

Add the import at the top:

```js
import { linkMatchForSeason } from './seasonRepository.mjs';
```

- [ ] **Step 3: Extend the file header**

`settle.mjs:1-5` says "Nothing here reads or writes principal, yield, shields, lapses, streak, the pot, or vouchers." That must stay true. Extend it:

```js
// Match settlement: rating, XP, season linkage, and exactly-once semantics.
//
// The ONLY lesson.* tables this file may touch are user_xp and user_xp_events,
// via lib/xp.mjs. Nothing here reads or writes principal, yield, shields,
// lapses, streak, the pot, or vouchers — still true with stake seasons: this
// file records WHICH matches a season counts (arena.*), and the voucher signer
// reads the settled outcome from there. The dependency never runs the other way.
```

- [ ] **Step 4: Run the arena suites**

```bash
cd backend && npx vitest run --project api tests/integration/api/arenaSettle.test.mjs tests/integration/api/arenaPlay.test.mjs tests/integration/api/arenaQueue.test.mjs tests/integration/api/arenaMatch.test.mjs tests/integration/api/arenaIsolation.test.mjs
```

Expected: PASS, all five. `arenaIsolation.test.mjs` must pass **unmodified** — if it fails, the dependency has been inverted and the fix is in this task, not in the test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/arena/settle.mjs
git commit -m "feat(arena): settled matches link to the open season"
```

---

### Task 7: The season settles itself

**Files:**
- Create: `backend/src/lib/arenaSeasonSweep.mjs`
- Create: `backend/scripts/run-arena-season.mjs`
- Modify: `backend/src/modules/arena/routes.mjs:106-110`
- Modify: `render.yaml`, `backend/package.json`

**Interfaces:**
- Consumes: `ensureOpenSeason`, `computeStakedDelta` (Task 5), `seasonOutcome` (Task 3), `readLockV2AccountFresh`
- Produces: `runArenaSeasonSweep({ log }): Promise<{opened, closed, settled, failed, seasonsSettled, skipped?}>`
- Produces: `ARENA_SEASON_LOCK_KEY = 727274003`
- Produces: `POST /v1/internal/arena/season`

- [ ] **Step 1: Write the sweep**

Create `backend/src/lib/arenaSeasonSweep.mjs`:

```js
// Arena stake-season cron: open, close, settle.
//
// Mirrors lib/arenaSweep.mjs — advisory-locked so two crons cannot run it at
// once, idempotent so a retry is a no-op.
//
// WHY EACH ENTRY GETS ITS OWN TRANSACTION
//
// Settling one entry needs a fresh on-chain read (readLockV2AccountFresh), and
// this backend runs in us-east against a Supabase instance in ap-southeast-1 —
// roughly 230ms per round trip. One long transaction across every entry would
// hold locks for the whole run and lose all of it to a single RPC hiccup. Per
// entry, a failure leaves settled entries settled and retries only PENDING.
import { getPool } from './db.mjs';
import { seasonOutcome } from './arenaSeason.mjs';
import { readLockV2AccountFresh } from './lockPosition.mjs';
import { ensureOpenSeason, computeStakedDelta } from '../modules/arena/seasonRepository.mjs';

// Distinct from the migration runner (727274001) and the match sweep (727274002).
export const ARENA_SEASON_LOCK_KEY = 727274003;

export async function runArenaSeasonSweep({ log = console } = {}) {
  const pool = getPool();
  if (!pool) return { opened: 0, closed: 0, settled: 0, failed: 0, skipped: 'no-database' };

  const client = await pool.connect();
  try {
    const got = await client.query(
      'select pg_try_advisory_lock($1) as ok', [ARENA_SEASON_LOCK_KEY]);
    if (!got.rows[0].ok) {
      return { opened: 0, closed: 0, settled: 0, failed: 0, skipped: 'lock-held' };
    }

    try {
      let settled = 0;
      let failed = 0;

      // 1. Close any season whose window has passed. CLOSED stops new opt-ins
      //    and new links while its entries are still being settled.
      const closing = await client.query(
        `update arena.seasons set status = 'CLOSED'
          where status = 'OPEN' and ends_at <= now()
        returning id`,
      );
      const closed = closing.rowCount;

      // 2. Settle every PENDING entry of every CLOSED season, one transaction
      //    each.
      const due = await client.query(
        `select e.stake_season_id as "stakeSeasonId", e.wallet_address as "walletAddress",
                e.course_id as "courseId", e.lock_address as "lockAddress"
           from arena.season_entries e
           join arena.seasons s on s.id = e.stake_season_id
          where s.status = 'CLOSED' and e.outcome = 'PENDING'
          order by e.stake_season_id, e.wallet_address
          limit 1000`,
      );

      for (const entry of due.rows) {
        try {
          const { stakedDelta } = await computeStakedDelta(
            client, entry.stakeSeasonId, entry.walletAddress,
          );

          // Fresh chain read. If it throws we do NOT guess — the catch below
          // leaves the entry PENDING for the next run.
          const lock = await readLockV2AccountFresh(entry.walletAddress, entry.courseId);
          const lockLive = Boolean(
            lock && !lock.mismatch && lock.status === 'ACTIVE'
            && lock.lockAddress === entry.lockAddress,
          );

          const outcome = seasonOutcome({ stakedDelta, lockLive });

          await client.query('begin');
          const rating = await client.query(
            `select rating from arena.ratings where wallet_address = $1 and season = 1`,
            [entry.walletAddress],
          );
          await client.query(
            `update arena.season_entries
                set outcome = $4, staked_delta = $5, rating_at_end = $6,
                    voided_reason = $7, settled_at = now()
              where stake_season_id = $1 and wallet_address = $2 and course_id = $3
                and outcome = 'PENDING'`,
            [
              entry.stakeSeasonId, entry.walletAddress, entry.courseId,
              outcome, stakedDelta, rating.rows[0]?.rating ?? null,
              outcome === 'VOID' ? 'LOCK_NOT_ACTIVE' : null,
            ],
          );
          await client.query('commit');
          settled += 1;
        } catch (err) {
          try { await client.query('rollback'); } catch { /* connection gone */ }
          failed += 1;
          // Fails CLOSED. The entry stays PENDING and is retried next run; it
          // is never resolved by guessing.
          log.error?.(
            `[arena-season] entry ${entry.walletAddress}/${entry.courseId} failed: ${err?.message ?? err}`,
          );
        }
      }

      // 3. A CLOSED season with nothing left PENDING is SETTLED.
      const done = await client.query(
        `update arena.seasons s set status = 'SETTLED'
          where s.status = 'CLOSED'
            and not exists (
              select 1 from arena.season_entries e
               where e.stake_season_id = s.id and e.outcome = 'PENDING')
        returning id`,
      );

      // 4. Open the next one so players are never between seasons.
      const before = await client.query(
        `select count(*)::int as n from arena.seasons where status = 'OPEN'`);
      await client.query('begin');
      await ensureOpenSeason(client);
      await client.query('commit');
      const opened = before.rows[0].n === 0 ? 1 : 0;

      return { opened, closed, settled, failed, seasonsSettled: done.rowCount };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [ARENA_SEASON_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Add the internal endpoint**

In `backend/src/modules/arena/routes.mjs`, beside the existing sweep endpoint (line 106):

```js
  app.post('/v1/internal/arena/season', async (request) => {
    requireSchedulerAuth(request);
    return runArenaSeasonSweep({ log: request.log });
  });
```

and to the imports:

```js
import { runArenaSeasonSweep } from '../../lib/arenaSeasonSweep.mjs';
```

- [ ] **Step 3: Write the cron entry**

Create `backend/scripts/run-arena-season.mjs` (**no shebang** — the vitest transform rejects them):

```js
// One-shot arena stake-season tick for cron services.
// Render cron: schedule "35 0 * * *", command: npm run cron:arena-season
//
// Runs after 00:30 UTC so a season ending on a UTC day boundary has fully
// closed before this reads it — the same reasoning as run-lapse-sweep.mjs.
//
// Same HTTP pattern as cron:arena-sweep: hit the scheduler-gated endpoint on
// the running web service, which owns the DB and RPC env.
import { config as loadEnv } from 'dotenv';

loadEnv();

const apiBaseUrl = process.env.ARENA_SWEEP_BASE_URL
  ?? process.env.API_BASE_URL
  ?? `http://127.0.0.1:${process.env.PORT ?? '3001'}`;
const url = `${apiBaseUrl.replace(/\/+$/, '')}/v1/internal/arena/season`;
const schedulerSecret = process.env.SCHEDULER_SECRET;

if (!schedulerSecret) {
  console.error('SCHEDULER_SECRET is required to run the arena season tick.');
  process.exit(1);
}

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-scheduler-key': schedulerSecret },
  body: '{}',
});

if (!res.ok) {
  console.error(`[arena-season] ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const b = await res.json();
console.log(
  `[arena-season] opened=${b.opened} closed=${b.closed} settled=${b.settled} `
  + `failed=${b.failed}${b.skipped ? ` skipped=${b.skipped}` : ''}`,
);
```

- [ ] **Step 4: Wire the script and the cron service**

In `backend/package.json`, beside `cron:arena-sweep`:

```json
    "cron:arena-season": "node scripts/run-arena-season.mjs",
```

In `render.yaml`, copy the `locked-in-arena-sweep` cron block and change `name` to `locked-in-arena-season`, `schedule` to `"35 0 * * *"`, `startCommand` to `npm run cron:arena-season`.

**Both `SCHEDULER_SECRET` and `ARENA_SWEEP_BASE_URL` must be set on this service.** The existing arena-sweep cron failed every 15 minutes for exactly this reason: `render.yaml` declared them `sync: false`, so Render created them empty. Set them explicitly, or through the Render API immediately after the service is created, and confirm the first run logs `[arena-season] opened=…` rather than `SCHEDULER_SECRET is required`.

- [ ] **Step 5: Verify the sweep runs against an empty database**

```bash
cd backend && node --env-file=.env.test -e "import('./src/lib/arenaSeasonSweep.mjs').then(async ({ runArenaSeasonSweep }) => { console.log('1:', JSON.stringify(await runArenaSeasonSweep())); console.log('2:', JSON.stringify(await runArenaSeasonSweep())); process.exit(0); });"
```

Expected: the first tick reports `opened: 1`; the second reports `opened: 0`, proving idempotence.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/arenaSeasonSweep.mjs backend/scripts/run-arena-season.mjs backend/src/modules/arena/routes.mjs backend/package.json render.yaml
git commit -m "feat(arena): season open/close/settle cron"
```

---

### Task 8: Season endpoints

**Files:**
- Modify: `backend/src/modules/arena/routes.mjs`

**Interfaces:**
- Consumes: `optIntoSeason`, `getMyStake`, `getOpenSeason` (Task 5)
- Produces:
  - `GET /v1/arena/season` → `{ id, startsAt, endsAt, status } | null`
  - `GET /v1/arena/stake` → entry with `stakedDelta`, `matchesCounted`, or `null`
  - `POST /v1/arena/stake` `{ courseId, consentVersion }` → `{ season, entry, created }`

- [ ] **Step 1: Add the routes**

In `backend/src/modules/arena/routes.mjs`, after the `/v1/arena/me` route:

```js
  app.get('/v1/arena/season', async () => getOpenSeason());

  app.get(
    '/v1/arena/stake',
    { preHandler: requireAccessAuth },
    async (request) => getMyStake(request.auth.walletAddress),
  );

  app.post(
    '/v1/arena/stake',
    {
      preHandler: requireAccessAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator } },
    },
    async (request, reply) => {
      const courseId = String(request.body?.courseId ?? '').trim();
      if (!courseId) throw badRequest('courseId is required', 'COURSE_ID_REQUIRED');
      const consentVersion = String(request.body?.consentVersion ?? '').trim();
      if (!consentVersion) {
        throw badRequest('consentVersion is required', 'CONSENT_VERSION_REQUIRED');
      }
      const result = await optIntoSeason(
        request.auth.walletAddress, courseId, consentVersion,
      );
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );
```

Extend the imports — merge `badRequest` into the existing `../../lib/errors.mjs` import rather than duplicating the line:

```js
import { unauthorized, badRequest } from '../../lib/errors.mjs';
import { optIntoSeason, getMyStake, getOpenSeason } from './seasonRepository.mjs';
```

- [ ] **Step 2: Smoke the routes**

Run: `cd backend && npx vitest run --project api tests/integration/api/health.test.mjs`
Expected: PASS — this proves the server still boots with the new routes registered. A missing import shows up here as a boot failure.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/arena/routes.mjs
git commit -m "feat(arena): season and stake endpoints"
```

---

### Task 9: Integration tests

**Files:**
- Create: `backend/tests/integration/api/arenaSeasonOptIn.test.mjs`
- Create: `backend/tests/integration/api/arenaSeasonSettle.test.mjs`

**Interfaces:** consumes Tasks 1–8; produces nothing downstream.

Before writing either file, open `backend/tests/integration/api/arenaSettle.test.mjs` and copy its header verbatim — the exact `createTestServer()` / `closeTestServer()` shapes and the auth-header helper signature. Do not guess them.

- [ ] **Step 1: Write the opt-in guards test**

Create `backend/tests/integration/api/arenaSeasonOptIn.test.mjs`:

```js
// Opt-in guards. Every one of these protects a user from a stake that could
// never be collected, or from being staked without a live position.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';
import { __setLockV2FreshReadOverride } from '../../../src/lib/lockPosition.mjs';

let app;
let db;

const COURSE = 'swaps-and-dexs';
const LOCK = 'Lock1111111111111111111111111111111111111';

const activeLock = () => ({
  mismatch: false, status: 'ACTIVE', principal: 10_000_000n, lockStartTs: 0, lockAddress: LOCK,
});

beforeAll(async () => {
  ({ app, db } = await createTestServer());
  await db.query(
    `insert into arena.seasons (id, starts_at, ends_at, status)
     values (1, now() - interval '1 day', now() + interval '29 days', 'OPEN')
     on conflict (id) do update set status = 'OPEN'`,
  );
});

afterAll(async () => {
  __setLockV2FreshReadOverride(null);
  await closeTestServer({ app, db });
});

describe('POST /v1/arena/stake', () => {
  it('refuses a wallet with no live lock', async () => {
    __setLockV2FreshReadOverride(async () => null);
    const wallet = generateTestWallet();
    const res = await app.inject({
      method: 'POST', url: '/v1/arena/stake',
      headers: await getTestAuthHeaders(wallet),
      payload: { courseId: COURSE, consentVersion: 'v1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ARENA_STAKE_NO_LOCK');
  });

  it('refuses a CLOSED lock', async () => {
    __setLockV2FreshReadOverride(async () => ({ ...activeLock(), status: 'CLOSED' }));
    const wallet = generateTestWallet();
    const res = await app.inject({
      method: 'POST', url: '/v1/arena/stake',
      headers: await getTestAuthHeaders(wallet),
      payload: { courseId: COURSE, consentVersion: 'v1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ARENA_STAKE_NO_LOCK');
  });

  it('accepts an ACTIVE lock and binds immediately', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    const wallet = generateTestWallet();
    const res = await app.inject({
      method: 'POST', url: '/v1/arena/stake',
      headers: await getTestAuthHeaders(wallet),
      payload: { courseId: COURSE, consentVersion: 'v1' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.created).toBe(true);
    expect(body.entry.outcome).toBe('PENDING');
    // Binding is at opt-in, not after N matches: zero matches played and the
    // entry already exists.
    expect(body.entry.lockAddress).toBe(LOCK);
  });

  it('is idempotent — a second opt-in returns the same entry', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    const first = await app.inject({
      method: 'POST', url: '/v1/arena/stake', headers,
      payload: { courseId: COURSE, consentVersion: 'v1' },
    });
    const second = await app.inject({
      method: 'POST', url: '/v1/arena/stake', headers,
      payload: { courseId: COURSE, consentVersion: 'v1' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().created).toBe(false);
  });

  it('refuses a course that is already complete', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    const wallet = generateTestWallet();
    await db.query(
      `insert into lesson.user_course_runtime_state (wallet_address, course_id, course_completed_at)
       values ($1, $2, now())
       on conflict (wallet_address, course_id) do update set course_completed_at = now()`,
      [wallet.address, COURSE],
    );
    const res = await app.inject({
      method: 'POST', url: '/v1/arena/stake',
      headers: await getTestAuthHeaders(wallet),
      payload: { courseId: COURSE, consentVersion: 'v1' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ARENA_STAKE_COURSE_SETTLED');
  });

  it('requires a consent version', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    const wallet = generateTestWallet();
    const res = await app.inject({
      method: 'POST', url: '/v1/arena/stake',
      headers: await getTestAuthHeaders(wallet),
      payload: { courseId: COURSE },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npx vitest run --project api tests/integration/api/arenaSeasonOptIn.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 3: Write the settlement test**

Create `backend/tests/integration/api/arenaSeasonSettle.test.mjs`:

```js
// Settlement end to end: a lost season takes exactly one tier off the voucher
// the loser's course eventually signs, and takes nothing off anyone else's.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet } from '../../helpers/test-auth.mjs';
import { __setLockV2FreshReadOverride } from '../../../src/lib/lockPosition.mjs';
import { runArenaSeasonSweep } from '../../../src/lib/arenaSeasonSweep.mjs';
import { readArenaPenaltyTiers } from '../../../src/modules/progress/repository.mjs';
import { effectiveYieldBps } from '../../../src/lib/claimVoucher.mjs';

let app;
let db;

const COURSE = 'swaps-and-dexs';
const LOCK = 'Lock1111111111111111111111111111111111111';
const quiet = { log: { error: () => {} } };

const liveLock = (status = 'ACTIVE') => async () => ({
  mismatch: false, status, principal: status === 'ACTIVE' ? 10_000_000n : 0n,
  lockStartTs: 0, lockAddress: LOCK,
});

async function seedClosedSeasonWithEntry(wallet, { stakedDelta }) {
  await db.query(
    `insert into arena.seasons (id, starts_at, ends_at, status)
     values (9, now() - interval '31 days', now() - interval '1 day', 'CLOSED')
     on conflict (id) do update set status = 'CLOSED'`,
  );
  await db.query(
    `insert into arena.season_entries
       (stake_season_id, wallet_address, course_id, lock_address, consent_version,
        rating_at_start, outcome)
     values (9, $1, $2, $3, 'v1', 1200, 'PENDING')
     on conflict do nothing`,
    [wallet, COURSE, LOCK],
  );
  const m = await db.query(
    `insert into arena.matches (origin, status, creator, opponent, question_ids, expires_at, resolved_at)
     values ('queue', 'COMPLETE', $1, $2, array['x'], now(), now()) returning id`,
    [wallet, 'Other111111111111111111111111111111111111'],
  );
  const matchId = m.rows[0].id;
  await db.query(
    `insert into arena.rating_events (match_id, wallet_address, rating_before, rating_after, delta)
     values ($1, $2, 1200, $3, $4)`,
    [matchId, wallet, 1200 + stakedDelta, stakedDelta],
  );
  await db.query(
    `insert into arena.season_match_links (stake_season_id, match_id, wallet_address, counted)
     values (9, $1, $2, true)`,
    [matchId, wallet],
  );
}

async function outcomeOf(wallet) {
  const r = await db.query(
    `select outcome, staked_delta, voided_reason from arena.season_entries
      where stake_season_id = 9 and wallet_address = $1`, [wallet]);
  return r.rows[0];
}

beforeAll(async () => { ({ app, db } = await createTestServer()); });
afterAll(async () => {
  __setLockV2FreshReadOverride(null);
  await closeTestServer({ app, db });
});

describe('season settlement', () => {
  it('a negative staked delta forfeits exactly one tier', async () => {
    const wallet = generateTestWallet().address;
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(liveLock());

    await runArenaSeasonSweep(quiet);

    const e = await outcomeOf(wallet);
    expect(e.outcome).toBe('FORFEIT');
    expect(e.staked_delta).toBe(-16);
    expect(await readArenaPenaltyTiers(wallet, COURSE, LOCK)).toBe(1);
    // The tier that would now be signed: one step down from full.
    expect(effectiveYieldBps({ lapseCount: 0, arenaPenaltyTiers: 1 })).toBe(5_000);
  });

  it('a positive staked delta keeps the tier', async () => {
    const wallet = generateTestWallet().address;
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: 24 });
    __setLockV2FreshReadOverride(liveLock());

    await runArenaSeasonSweep(quiet);

    expect((await outcomeOf(wallet)).outcome).toBe('KEPT');
    expect(await readArenaPenaltyTiers(wallet, COURSE, LOCK)).toBe(0);
  });

  it('a closed lock voids rather than forfeits', async () => {
    const wallet = generateTestWallet().address;
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -48 });
    __setLockV2FreshReadOverride(liveLock('CLOSED'));

    await runArenaSeasonSweep(quiet);

    const e = await outcomeOf(wallet);
    expect(e.outcome).toBe('VOID');
    expect(e.voided_reason).toBe('LOCK_NOT_ACTIVE');
    // VOID costs nothing. Nobody is penalised retroactively.
    expect(await readArenaPenaltyTiers(wallet, COURSE, LOCK)).toBe(0);
  });

  it('an unreadable chain leaves the entry PENDING rather than guessing', async () => {
    const wallet = generateTestWallet().address;
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(async () => { throw new Error('rpc down'); });

    await runArenaSeasonSweep(quiet);

    expect((await outcomeOf(wallet)).outcome).toBe('PENDING');
  });

  it("a forfeit on one lock does not touch the wallet's other course", async () => {
    const wallet = generateTestWallet().address;
    await seedClosedSeasonWithEntry(wallet, { stakedDelta: -16 });
    __setLockV2FreshReadOverride(liveLock());
    await runArenaSeasonSweep(quiet);

    expect(await readArenaPenaltyTiers(wallet, COURSE, LOCK)).toBe(1);
    // A different course, a different lock — untouched.
    expect(await readArenaPenaltyTiers(
      wallet, 'stablecoins-money-on-chain', 'Lock2222222222222222222222222222222222222',
    )).toBe(0);
  });
});
```

- [ ] **Step 4: Run it**

Run: `cd backend && npx vitest run --project api tests/integration/api/arenaSeasonSettle.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run everything**

Run: `cd backend && npx vitest run`
Expected: the whole `unit` and `api` suite green. Any pre-existing failure must be *proved* pre-existing by re-running it at a stashed working tree before it is dismissed.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/integration/api/arenaSeasonOptIn.test.mjs backend/tests/integration/api/arenaSeasonSettle.test.mjs
git commit -m "test(arena): season opt-in guards and settlement"
```

---

### Task 10: The player can see they are staked

Nothing today tells a player their lock is at stake. Shipping the penalty without the disclosure would be the worst version of this feature.

**Files:**
- Modify: `web-app/types/arena.ts`, `web-app/services/api/arena/arenaApi.ts`, `web-app/app/arena/page.tsx`
- Create: `web-app/lib/arenaStake.ts`, `web-app/app/arena/StakePanel.tsx`
- Test: `web-app/__tests__/lib/arenaStake.test.ts` (create)

**Interfaces:**
- Consumes: `GET /v1/arena/season`, `GET /v1/arena/stake`, `POST /v1/arena/stake` (Task 8); `GET /v1/progress/enrollments` for the course list
- Produces: `describeStake(entry): { headline, detail, tone }`, `daysRemaining(endsAt, now?): number`, `StakePanel`

- [ ] **Step 1: Add the types**

Append to `web-app/types/arena.ts`:

```ts
export type ArenaStakeOutcome = 'PENDING' | 'KEPT' | 'FORFEIT' | 'VOID';

export interface ArenaSeason {
  id: number;
  startsAt: string;
  endsAt: string;
  status: 'OPEN' | 'CLOSED' | 'SETTLED';
}

export interface ArenaStakeEntry {
  stakeSeasonId: number;
  courseId: string;
  lockAddress: string;
  optedInAt: string;
  ratingAtStart: number;
  ratingAtEnd: number | null;
  outcome: ArenaStakeOutcome;
  voidedReason: string | null;
  settledAt: string | null;
  startsAt: string;
  endsAt: string;
  seasonStatus: ArenaSeason['status'];
  /** Summed rating delta over counted staked matches — this decides the season. */
  stakedDelta: number;
  matchesCounted: number;
}
```

- [ ] **Step 2: Add the API calls**

Append to `web-app/services/api/arena/arenaApi.ts`, extending the type import at the top with `ArenaSeason` and `ArenaStakeEntry`:

```ts
export function getSeason(): Promise<ArenaSeason | null> {
  return httpRequest<ArenaSeason | null>('/v1/arena/season');
}

export function getMyStake(token: string): Promise<ArenaStakeEntry | null> {
  return httpRequest<ArenaStakeEntry | null>('/v1/arena/stake', { token });
}

export function stakeSeason(
  token: string, courseId: string, consentVersion: string,
): Promise<{ created: boolean; entry: ArenaStakeEntry }> {
  return httpRequest<{ created: boolean; entry: ArenaStakeEntry }>(
    '/v1/arena/stake',
    { method: 'POST', token, body: { courseId, consentVersion } },
  );
}
```

- [ ] **Step 3: Write the failing copy test**

Create `web-app/__tests__/lib/arenaStake.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { describeStake, daysRemaining } from '../../lib/arenaStake';

const base = {
  stakeSeasonId: 1, courseId: 'swaps-and-dexs', lockAddress: 'L',
  optedInAt: '2026-09-01T00:00:00Z', ratingAtStart: 1200, ratingAtEnd: null,
  voidedReason: null, settledAt: null,
  startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z',
  seasonStatus: 'OPEN' as const, matchesCounted: 2,
};

describe('describeStake', () => {
  it('says plainly that a tier is at risk while behind', () => {
    const d = describeStake({ ...base, outcome: 'PENDING', stakedDelta: -12 });
    expect(d.tone).toBe('danger');
    expect(d.headline).toMatch(/behind/i);
  });

  it('is calm while ahead', () => {
    expect(describeStake({ ...base, outcome: 'PENDING', stakedDelta: 18 }).tone).toBe('good');
  });

  it('treats level as safe — a tie keeps the tier', () => {
    // Zero is KEPT, so the copy must not imply danger at zero.
    expect(describeStake({ ...base, outcome: 'PENDING', stakedDelta: 0 }).tone).not.toBe('danger');
  });

  it('never omits the deposit-safety sentence while a stake is live', () => {
    for (const delta of [-12, 0, 18]) {
      const d = describeStake({ ...base, outcome: 'PENDING', stakedDelta: delta });
      expect(`${d.headline} ${d.detail}`).toMatch(/deposit/i);
    }
  });

  it('states the consequence after a forfeit', () => {
    const d = describeStake({ ...base, outcome: 'FORFEIT', stakedDelta: -30, settledAt: 'x' });
    expect(d.tone).toBe('danger');
    expect(d.detail).toMatch(/half/i);
    expect(d.detail).toMatch(/deposit/i);
  });

  it('says nothing was taken on a void', () => {
    const d = describeStake({ ...base, outcome: 'VOID', stakedDelta: -30, settledAt: 'x' });
    expect(d.detail).toMatch(/nothing/i);
    expect(d.tone).not.toBe('danger');
  });

  it('confirms the tier was kept', () => {
    expect(describeStake({ ...base, outcome: 'KEPT', stakedDelta: 12, settledAt: 'x' }).tone).toBe('good');
  });
});

describe('daysRemaining', () => {
  it('counts whole days and never goes negative', () => {
    expect(daysRemaining('2026-09-11T00:00:00Z', new Date('2026-09-01T00:00:00Z'))).toBe(10);
    expect(daysRemaining('2026-09-01T00:00:00Z', new Date('2026-09-30T00:00:00Z'))).toBe(0);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd web-app && npx vitest run __tests__/lib/arenaStake.test.ts`
Expected: FAIL — cannot resolve `../../lib/arenaStake`.

- [ ] **Step 5: Implement the copy module**

Create `web-app/lib/arenaStake.ts`:

```ts
import type { ArenaStakeEntry } from '../types/arena';

export type StakeTone = 'neutral' | 'good' | 'danger';

export interface StakeDescription {
  headline: string;
  detail: string;
  tone: StakeTone;
}

const DEPOSIT_SAFE = 'Your deposit is never at risk.';

export function daysRemaining(endsAt: string, now: Date = new Date()): number {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/**
 * Plain-language state of a stake. The amounts here are currently cents, and
 * the opt-in copy says so rather than implying a jackpot.
 */
export function describeStake(entry: ArenaStakeEntry): StakeDescription {
  const delta = Number(entry.stakedDelta) || 0;
  const n = entry.matchesCounted;
  const matches = `${n} staked ${n === 1 ? 'match' : 'matches'}`;

  if (entry.outcome === 'FORFEIT') {
    return {
      headline: 'Season lost',
      detail: `Your staked course keeps half its yield instead of all of it when you claim. ${DEPOSIT_SAFE}`,
      tone: 'danger',
    };
  }
  if (entry.outcome === 'VOID') {
    return {
      headline: 'Season voided',
      detail: `Your lock closed before the season ended, so nothing was taken. ${DEPOSIT_SAFE}`,
      tone: 'good',
    };
  }
  if (entry.outcome === 'KEPT') {
    return {
      headline: 'Season won',
      detail: `Your staked course keeps all of its yield. ${DEPOSIT_SAFE}`,
      tone: 'good',
    };
  }

  const days = daysRemaining(entry.endsAt);
  const left = days === 1 ? '1 day left' : `${days} days left`;

  if (delta < 0) {
    return {
      headline: `You are behind — ${left}`,
      detail: `Down ${Math.abs(delta)} rating across ${matches}. If the season ends here, your `
        + `staked course keeps half its yield instead of all of it. ${DEPOSIT_SAFE}`,
      tone: 'danger',
    };
  }
  if (delta > 0) {
    return {
      headline: `You are ahead — ${left}`,
      detail: `Up ${delta} rating across ${matches}. Finish level or better and you keep all `
        + `your yield. ${DEPOSIT_SAFE}`,
      tone: 'good',
    };
  }
  return {
    headline: `Level — ${left}`,
    detail: `Level keeps your full yield. Only finishing the season behind costs you a tier. ${DEPOSIT_SAFE}`,
    tone: 'neutral',
  };
}
```

- [ ] **Step 6: Run the test**

Run: `cd web-app && npx vitest run __tests__/lib/arenaStake.test.ts`
Expected: PASS.

- [ ] **Step 7: Build the panel**

First confirm the tokens and helper actually exist — do not invent either:

```bash
cd web-app && grep -n "card\|input\|buttonPrimary\|buttonGhost\|textHeading\|textMuted\|textSuccess\|textDanger" components/theme.ts
grep -rn "enrollments" services/
```

If `getEnrollments` is absent, add it to the progress API module following the neighbouring calls: `httpRequest('/v1/progress/enrollments', { token })`.

Create `web-app/app/arena/StakePanel.tsx`, substituting the real token names wherever they differ from the placeholders below:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { T } from '../../components/theme';
import { fetchWithAuth } from '../../services/api/httpClient';
import { getSeason, getMyStake, stakeSeason } from '../../services/api/arena/arenaApi';
import { getEnrollments } from '../../services/api/progress/progressApi';
import { describeStake, daysRemaining } from '../../lib/arenaStake';
import type { ArenaSeason, ArenaStakeEntry, StakeTone } from '../../types/arena';

const CONSENT_VERSION = 'arena-stake-v1';

const TONE: Record<StakeTone, string> = {
  neutral: T.textMuted,
  good: T.textSuccess,
  danger: T.textDanger,
};

export function StakePanel() {
  const [season, setSeason] = useState<ArenaSeason | null>(null);
  const [stake, setStake] = useState<ArenaStakeEntry | null>(null);
  const [courses, setCourses] = useState<{ courseId: string }[]>([]);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    getSeason().then(setSeason).catch(() => setSeason(null));
    fetchWithAuth((t) => getMyStake(t)).then(setStake).catch(() => setStake(null));
    fetchWithAuth((t) => getEnrollments(t))
      .then((e) => setCourses(e.enrollments ?? []))
      .catch(() => setCourses([]));
  }, []);

  async function onStake() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchWithAuth((t) => stakeSeason(t, chosen, CONSENT_VERSION));
      setStake(r.entry);
      setConfirming(false);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setError(
        code === 'ARENA_STAKE_NO_LOCK'
          ? 'You need an active lock on that course before you can stake it.'
          : code === 'ARENA_STAKE_COURSE_SETTLED'
            ? 'That course is already finished — its yield is locked in and cannot be staked.'
            : code === 'ARENA_SEASON_CLOSED'
              ? 'No season is open right now. Check back shortly.'
              : 'Could not stake that course. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!season && !stake) return null;

  // ---- Already staked: the standing indicator. ----
  if (stake) {
    const d = describeStake(stake);
    return (
      <section className={`${T.card} p-4`} aria-live="polite">
        <h2 className={`${T.textHeading} text-sm uppercase tracking-wider`}>Your stake</h2>
        <p className={`${TONE[d.tone]} mt-2 text-lg font-semibold`}>{d.headline}</p>
        <p className={`${T.textMuted} mt-1 text-sm leading-relaxed`}>{d.detail}</p>
        <dl className={`${T.textMuted} mt-3 grid grid-cols-2 gap-2 text-xs`}>
          <div>
            <dt className="opacity-60">Staked course</dt>
            <dd>{stake.courseId}</dd>
          </div>
          <div>
            <dt className="opacity-60">Staked rating</dt>
            <dd style={{ fontVariantNumeric: 'tabular-nums' }}>
              {stake.stakedDelta > 0 ? `+${stake.stakedDelta}` : stake.stakedDelta}
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  // ---- Not staked: the opt-in. ----
  const days = season ? daysRemaining(season.endsAt) : 0;
  return (
    <section className={`${T.card} p-4`}>
      <h2 className={`${T.textHeading} text-sm uppercase tracking-wider`}>Stake a course</h2>
      <p className={`${T.textMuted} mt-2 text-sm leading-relaxed`}>
        Put one of your locked courses on this season. Finish level or ahead across your staked
        matches and it keeps all of its yield. Finish behind and it keeps half instead.{' '}
        <strong className={T.textHeading}>Your deposit is never at risk either way.</strong>
      </p>
      <p className={`${T.textMuted} mt-2 text-xs leading-relaxed opacity-80`}>
        Yields here are small today — the difference is currently worth cents, not dollars.
        {days > 0 ? ` ${days} days left in this season.` : ''} Once you stake, it is bound for
        the whole season; there is no early exit.
      </p>

      <label
        className={`${T.textMuted} mt-3 block text-xs uppercase tracking-wider`}
        htmlFor="stake-course"
      >
        Course
      </label>
      <select
        id="stake-course"
        className={`${T.input} mt-1 w-full`}
        value={chosen}
        onChange={(e) => { setChosen(e.target.value); setConfirming(false); }}
      >
        <option value="">Choose a locked course…</option>
        {courses.map((c) => (
          <option key={c.courseId} value={c.courseId}>{c.courseId}</option>
        ))}
      </select>

      {error ? <p className={`${T.textDanger} mt-2 text-sm`}>{error}</p> : null}

      {!confirming ? (
        <button
          type="button"
          className={`${T.buttonPrimary} mt-3 w-full`}
          disabled={!chosen || busy}
          onClick={() => setConfirming(true)}
        >
          Stake this course
        </button>
      ) : (
        <div className="mt-3">
          <p className={`${T.textHeading} text-sm`}>
            Stake {chosen} for the whole season? This cannot be undone.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={`${T.buttonPrimary} flex-1`}
              disabled={busy}
              onClick={onStake}
            >
              {busy ? 'Staking…' : 'Yes, stake it'}
            </button>
            <button
              type="button"
              className={`${T.buttonGhost} flex-1`}
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

Export `StakeTone` from `web-app/types/arena.ts` or import it from `../../lib/arenaStake` — whichever matches the file's existing import style.

- [ ] **Step 8: Mount it**

In `web-app/app/arena/page.tsx`, import `StakePanel` and render it directly below the profile/rating block and above the ladder, so a staked player sees their state before anything else on the page.

- [ ] **Step 9: Typecheck and build**

```bash
cd web-app && npx vitest run && npx tsc --noEmit && rm -rf .next && npm run build
```

Expected: no type errors, build succeeds. `rm -rf .next` is not optional — stale `.next/dev/types` referencing removed pages has broken this build before. If the build complains about `NEXT_PUBLIC_PRIVY_APP_ID`, set it from `.env.local` for the build.

- [ ] **Step 10: Commit**

```bash
git add web-app/types/arena.ts web-app/services/api web-app/lib/arenaStake.ts web-app/app/arena/StakePanel.tsx web-app/app/arena/page.tsx web-app/__tests__/lib/arenaStake.test.ts
git commit -m "feat(arena): stake opt-in and standing indicator"
```

---

### Task 11: The claim page shows the tier that was actually signed

**Files:**
- Modify: `web-app/app/claim/[courseId]/page.tsx` (and the voucher type in `web-app/types/`)

**Interfaces:** consumes the voucher response's `bps`, `lapseCount` and new `arenaPenaltyTiers` (Task 4).

- [ ] **Step 1: Find where the claim page reads the voucher**

Run: `cd web-app && grep -rn "voucher\|bps" app/claim/ types/`
Read the file and locate where the voucher object is already in hand.

- [ ] **Step 2: Add `arenaPenaltyTiers` to the voucher type**

Wherever `bps` and `lapseCount` are declared on the voucher interface in `web-app/types/`, add:

```ts
  /** 1 if a staked Arena season finished behind, else 0. */
  arenaPenaltyTiers: number;
```

- [ ] **Step 3: Add the notice**

Where the claim summary renders, using the file's existing theme tokens:

```tsx
{voucher && voucher.bps < 10_000 ? (
  <p className={`${T.textMuted} mt-2 text-sm leading-relaxed`}>
    This claim returns your full deposit plus{' '}
    <strong className={T.textHeading}>{voucher.bps / 100}%</strong> of the yield it earned.
    {voucher.arenaPenaltyTiers > 0
      ? ' One tier was given up when your staked Arena season finished behind.'
      : ''}
    {voucher.lapseCount > 0
      ? ` ${voucher.lapseCount === 1 ? 'One lapse' : `${voucher.lapseCount} lapses`} also reduced it.`
      : ''}
  </p>
) : null}
```

- [ ] **Step 4: Typecheck**

Run: `cd web-app && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web-app/app/claim web-app/types
git commit -m "feat(claim): say why the yield share is what it is"
```

---

### Task 12: Audit and end-to-end verification

This is the gate, not a task with a deliverable.

- [ ] **Step 1: Full suite, both projects**

```bash
cd backend && npx vitest run
cd ../web-app && npx vitest run && npx tsc --noEmit
```

Expected: green. `backend/tests/integration/api/arenaIsolation.test.mjs` must be **unmodified** and passing.

- [ ] **Step 2: Prove the money path end to end with a short season**

```bash
cd backend && ARENA_SEASON_DAYS=0 node --env-file=.env.test -e "import('./src/lib/arenaSeasonSweep.mjs').then(async ({ runArenaSeasonSweep }) => { console.log('tick 1', JSON.stringify(await runArenaSeasonSweep())); console.log('tick 2', JSON.stringify(await runArenaSeasonSweep())); process.exit(0); });"
```

Expected: the first tick opens a season; the second closes it, settles its entries, and opens the next. This is the only way to exercise the full open→close→settle cycle without waiting 30 days.

- [ ] **Step 3: Confirm the tier reaches the signed bytes**

Write a throwaway script under the scratchpad directory that: seeds a settled FORFEIT entry; calls `issueCourseCompletionVoucher`; asserts the returned `bps === 5000`; calls it a second time and asserts the **same** bps and `arenaPenaltyTiers`; then decodes the 91-byte message and asserts `Buffer.from(voucher.message, 'base64').readUInt16LE(81) === 5000`.

**This is the assertion the whole feature exists for.** If the signed bytes say `10000`, the feature is a no-op and nothing else in this plan matters.

- [ ] **Step 4: Drive the UI with Playwright**

```bash
cd web-app && npx playwright test --config e2e/arena.config.ts
```

Set auth via `context.addCookies()` **before** navigation (the edge guard reads it there), storage key `locked-in-user` at version 1, and leave Privy hanging or `useAuth` wipes the session. Capture screenshots of: the opt-in panel, the confirm step, the staked indicator while behind, and the settled FORFEIT state.

- [ ] **Step 5: Read the screenshots**

Check each one: the deposit-safety sentence is visible in every state; numbers line up in columns; nothing is clipped at 400px width; the danger tone is not used for a level (zero) delta.

- [ ] **Step 6: Adversarial audit**

Run a small review workflow — 4–5 agents, not more — over the diff with these lenses, and fix what survives:

1. **The signed bytes.** Can any path produce a bps outside `[10000, 5000, 0]`, or a tier the user did not incur? Trace every caller of `issueVoucher`.
2. **Accumulation.** Can `arenaPenaltyTiers` ever exceed 1, across seasons or across a re-issue?
3. **Isolation.** Does anything under `backend/src/modules/arena/` write a `lesson.*` table other than `user_xp` / `user_xp_events`?
4. **Settlement.** Can an entry settle twice, settle on an unread chain, or be decided by a global rating rather than the summed staked delta?
5. **Disclosure.** Is there any state where a staked player is not told they are staked?

- [ ] **Step 7: Migrate production**

Only after everything above is green:

```bash
cd backend && node --env-file=.env scripts/migrate.mjs
```

Then set `SCHEDULER_SECRET` and `ARENA_SWEEP_BASE_URL` on the new Render cron service **before** its first scheduled run, and confirm the first execution logs `[arena-season] opened=1` rather than `SCHEDULER_SECRET is required`.

---

## Phase 2 — the winner side (deferred, with its gate)

Phase 2 pays winners a weighted share of the pot. It is **not** in this plan, and the spec's own gate is why:

> **Phase-1 gate:** at least one season settles with every entry reaching a terminal outcome and no drift-check firing.

No season has ever run. Shipping untested payout logic that moves real pot money before a single season has settled is the specific risk this split exists to avoid. Phase 2 becomes its own plan once the first season settles, covering:

- `computeWeightedPayouts` over `KEPT` entries, weighted by staked delta
- The 3-distinct-opponent eligibility rule, which belongs here rather than on the binding — where it would be both unreachable at a 3-wallet population and gameable
- Pot accounting and the winner-side disclosure

`ARENA_SEASON_DAYS` makes the gate reachable in a deliberate test run rather than after 30 days of wall clock.

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Season model, 30 days, platform-fixed | 2 (schema), 5 (config + `ensureOpenSeason`) |
| Stake binds at opt-in | 5 (`optIntoSeason`), 9 (asserted) |
| Losing = summed staked delta < 0 | 3 (`seasonOutcome`), 5 (`computeStakedDelta`), 9 |
| Exactly one tier, never more | 1 (clamped), 3 (`penaltyTiersFor`), 9 |
| `effectiveYieldBps` sole owner of the signed bps | 1 |
| `lapseRedirectBps` rename | 1 |
| Voucher captures + replays the tier | 4 |
| `POST /voucher` read-through | 4 |
| Opt-in rejects an already-settled course | 5, 9 |
| Eligibility read from chain, fail-closed | 5, 9 |
| Lock closed mid-season → VOID | 3, 7, 9 |
| Arena never blocks a claim | No task adds a freeze; audited by Task 12 lens 3 |
| Pair cap, `counted = false` | 3 (`shouldCountMatch`), 6 (`linkMatchForSeason`) |
| Damper widens to the season for staked pairs | 6 |
| `stake_season_id` is a new axis | 2 (header + naming), Global Constraints |
| RLS on both new tables | 2 |
| 0063 header amended | 2 |
| Season opens/closes/settles; own advisory lock key | 7 |
| Per-entry transaction; fails closed | 7, 9 |
| `outcome not null default 'PENDING'` | 2 |
| Disclosure: standing, at-settlement, at-claim | 10, 11 |
| `consent_version` | 2, 5, 8, 10 |
| Error codes | 5, 8, 9, 10 |
| Testing section | 1, 3, 9, 12 |
| Phase split + gate | Phase 2 section |
| Question-draw asymmetry | Recorded in the spec as deferred; not a Phase-1 task |

**Placeholder scan:** none. Every code step carries its code; every run step carries its command and its expected result.

**Type consistency:** `effectiveYieldBps({ lapseCount, arenaPenaltyTiers })` keeps the same name and shape in Tasks 1, 4, 9 and 12. `arenaPenaltyTiers` (camel) in JS/TS, `arena_penalty_tiers` (snake) in SQL, consistently; likewise `stakedDelta` / `staked_delta`. `seasonOutcome` returns exactly the four strings the Task 2 CHECK constraint allows, and `PENDING` is produced only by the schema default, never by that function. `ARENA_SEASON_LOCK_KEY = 727274003` is distinct from 727274001 (migrations) and 727274002 (match sweep). The voucher row alias is `voucher_arena_penalty_tiers` in Tasks 1, 4 and the SELECT that produces it.

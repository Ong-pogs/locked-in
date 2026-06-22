# Task C Refactor Blueprint — Web-App Correctness vs Merged `locked_in` Program

Make the web-app's on-chain client read only the 9 custody fields that still exist on `LockAccount`, and re-source all game state (fuel, ichor, streak, saver, yield-redirect, gauntlet) from the backend `progress` module. Verified against the authoritative IDL at `/Users/marcus/Projects/locked-in/target/idl/locked_in.json` and against the live source.

## 0. Ground-Truth Verification (done — no assumptions)

IDL confirms:
- Program name `locked_in`, address `68im45BCfv8sL6WnVVV9JF4edLkB11udeU9EAApNaEx3`.
- Instructions present: `close_distribution_window, distribute_window, initialize_pot, initialize_vault, lock_funds, record_redirect, unlock_funds`. **No `redeem_ichor`. No `course_policy` account anywhere.**
- `LockAccount` discriminator `[223,64,71,124,255,86,118,192]` == hex `df40477cff5676c0` (matches current `LOCK_ACCOUNT_DISCRIMINATOR_HEX`).
- `lock_funds` discriminator `[171,49,9,86,156,155,2,88]`; `unlock_funds` `[175,119,16,245,141,55,255,43]` — both already correct in code.
- `lock_funds` accounts, exact order: `protocol_config, lock_account, stable_mint, skr_mint, owner, owner_stable_token_account, stable_vault, skr_vault, token_program, associated_token_program, system_program, owner_skr_token_account` (12 keys, **no course_policy**). The current builder injects 13 keys with `coursePolicy` at index 1 — that key MUST be dropped.
- `lock_funds` args: `course_id_hash [u8;32], lock_duration_days u16, stable_amount u64, skr_amount u64` — matches `encodeLockFundsInstructionData`.

LockAccount fields in IDL order (the new decoder layout):
`owner: pubkey | course_id_hash: [u8;32] | stable_mint: pubkey | principal_amount: u64 | skr_locked_amount: u64 | lock_start_ts: i64 | lock_end_ts: i64 | status: u8 | bump: u8`. Total = 8 (disc) + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1 = **138 bytes**.

Note the layout change vs the old struct: `skr_locked_amount` now sits **immediately after `principal_amount`** (before the timestamps), and the old struct's `extension_seconds_total`, gauntlet/streak/savers/fuel/ichor/skrTier/redirect fields are all gone.

---

## 1. New custody-only `LockAccountSnapshot` + `decodeLockAccountSnapshot`

### New interface (replaces `lockVault.ts` lines 75-94)
```ts
export interface LockAccountSnapshot {
  lockAccountAddress: string;
  principalAmountUi: string;
  skrLockedAmountUi: string;
  lockStartDate: string;   // ISO from lock_start_ts*1000
  lockEndDate: string;     // ISO from lock_end_ts*1000
  unlockEligible: boolean; // status !== 2 && now >= lock_end_ts*1000
  status: number;          // u8
}
```
REMOVED fields: `gauntletComplete, gauntletDay, fuelCounter, fuelCap, saverRecoveryMode, currentYieldRedirectBps, extensionDays, ichorCounter, ichorLifetimeTotal, conversionBps, conversionRateLabel`.

### New decoder (replaces `lockVault.ts` lines 214-299), reading the 9 IDL fields in order
```ts
function decodeLockAccountSnapshot(
  data: Uint8Array,
  lockAccountAddress: string,
  stableDecimals: number,
  skrDecimals: number,
): LockAccountSnapshot {
  if (bytesToHex(data.subarray(0, 8)) !== LOCK_ACCOUNT_DISCRIMINATOR_HEX) {
    throw new Error('Account is not a LockVault lock account.');
  }

  let offset = 8;
  const skip = (size: number) => { offset += size; };
  const readU64 = () => { const v = readU64LE(data, offset); offset += 8; return v; };
  const readI64 = () => { const v = readI64LE(data, offset); offset += 8; return v; };
  const readU8  = () => { const v = data[offset] ?? 0; offset += 1; return v; };

  skip(32);                       // owner
  skip(32);                       // course_id_hash
  skip(32);                       // stable_mint
  const principalAmount   = readU64();   // principal_amount
  const skrLockedAmount   = readU64();   // skr_locked_amount  (NEW position)
  const lockStartTs       = readI64();   // lock_start_ts
  const lockEndTs         = readI64();   // lock_end_ts
  const status            = readU8();    // status
  // bump (u8) intentionally not read

  return {
    lockAccountAddress,
    principalAmountUi: formatAtomicAmount(principalAmount, stableDecimals),
    skrLockedAmountUi: formatAtomicAmount(skrLockedAmount, skrDecimals),
    lockStartDate: new Date(Number(lockStartTs) * 1000).toISOString(),
    lockEndDate: new Date(Number(lockEndTs) * 1000).toISOString(),
    unlockEligible: status !== 2 && Date.now() >= Number(lockEndTs) * 1000,
    status,
  };
}
```
Helpers `readU8 / readU64LE / readI64LE / bytesToHex / formatAtomicAmount` stay. Helpers `readBool / readU16` become unused — delete them (or they will trip `noUnusedLocals` if enabled).

---

## 2. `lockVault.ts` — REMOVE / REPOINT / KEEP

### REMOVE (deleted game economy + course_policy)
- `buildRedeemIchorTransaction` (and its internal `encodeRedeemIchorInstructionData`).
- `REDEEM_ICHOR_DISCRIMINATOR` (line 20).
- `getIchorConversionBps` (lines 203-208) and `formatIchorConversionRate` (lines 210-212).
- `getIchorRedemptionQuote`, `parseIchorAmount`.
- `fetchRedemptionVaultBalance` (lines 518-545) + interface `RedemptionVaultBalance` (lines 43-46).
- `RedeemIchorBuildResult` interface (lines 67-73).
- `deriveCoursePolicyAddress` (lines 434-443) + `COURSE_POLICY_SEED` (line 24).
- In `buildLockFundsTransaction`: delete the `coursePolicy` PDA derivation (lines 577-580) and remove the `{ pubkey: coursePolicy, ... }` key (line 632). Result: 12 keys, matching the IDL `lock_funds` account order exactly.

### REPOINT / VERIFY (already done in code — confirm only)
- `PROTOCOL_SEED = Buffer.from('vault-protocol')` (line 23) — correct vault config seed. After removals, only `buildLockFundsTransaction` references it (deriving `protocol_config`); keep.
- `LOCK_ACCOUNT_DISCRIMINATOR_HEX` `df40477cff5676c0` (line 21) — verified equal to IDL. Keep.
- `LOCK_FUNDS_DISCRIMINATOR` / `UNLOCK_FUNDS_DISCRIMINATOR` — verified equal to IDL. Keep.
- `LOCK_SEED = Buffer.from('lock')` — keep (lock_account PDA seed).
- **Program ID is an ENV change, not code**: set `NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID=68im45BCfv8sL6WnVVV9JF4edLkB11udeU9EAApNaEx3` in the web-app `.env`. `initialize_vault` is a deploy/admin instruction — the web-app does not call it, so no client code is added for it.

### KEEP (custody-correct as-is, aside from the coursePolicy edit)
- `buildLockFundsTransaction` (with coursePolicy removed), `buildUnlockFundsTransaction`, `batchCheckLockAccounts`, `deriveLockAccountAddress`, `fetchLockAccountSnapshot`, `fetchWalletDepositBalances`, `getLockVaultConfig`, `hasLockVaultConfig`, `parseUiTokenAmount`, `formatDepositAmountUi`, `getStableMintAddress`.
- Interfaces `LockFundsBuildResult`, `UnlockFundsBuildResult`, `WalletDepositBalances`; types `LockDurationDays`.

### `services/solana/index.ts` barrel
Remove these from the export list: `buildRedeemIchorTransaction`, `deriveCoursePolicyAddress`, `fetchRedemptionVaultBalance`, `getIchorRedemptionQuote`, `parseIchorAmount`, `type RedeemIchorBuildResult`, `type RedemptionVaultBalance`. Keep the rest.

---

## 3. Per-Consumer File Changes

### CORE — `stores/courseStore.ts` (the only behavioral fix outside lockVault.ts)
`syncLockSnapshot` (lines 457-479) currently copies `extensionDays, saverRecoveryMode, currentYieldRedirectBps, fuelCounter, fuelCap, ichorBalance(=ichorCounter), totalIchorProduced(=ichorLifetimeTotal)` out of the on-chain snapshot. Those fields no longer exist on the trimmed snapshot. Rewrite the writer to set **custody fields only**:
```ts
syncLockSnapshot: (courseId, snapshot) => {
  const state = get();
  const existingState = normalizeCourseGameState(state.courseStates[courseId]);
  set({
    courseStates: {
      ...state.courseStates,
      [courseId]: {
        ...existingState,
        lockAccountAddress: snapshot.lockAccountAddress ?? existingState.lockAccountAddress,
        lockStartDate: snapshot.lockStartDate,
        skrLockedAmount: Number(snapshot.skrLockedAmountUi), // custody, optional
        // game-state fields (fuel/ichor/saver/redirect/streak/extension) are NOT set here;
        // they come from syncCourseRuntime/restoreFromBackend (backend progress API).
      },
    },
  });
},
```
`syncOnChainEnrollments` (lines 527-562): keep on-chain lock discovery via `batchCheckLockAccounts` + `activateCourse` (which only reads `principalAmountUi, lockStartDate, lockEndDate, lockAccountAddress` — all still present). After enrolling a discovered lock, it must obtain a token and call `refreshCourseRuntime(courseId, token)` to hydrate game state from the backend (or rely on the existing mount-time `refreshCourseRuntime`/`restoreFromBackend` path). The `syncLockSnapshot` call on line 554 stays but now writes custody-only.

### `types/courseState.ts`
No removal strictly required — the in-memory `CourseGameState` keeps its game fields, now populated **only** from `CourseRuntimeSnapshot` (via `syncCourseRuntime`/`restoreFromBackend`). Optional cleanup: drop `extensionDays` (line 17, default line 55) since the extension model is gone on-chain and is not needed by any live UI; leave it if you prefer minimal churn. Keep all custody fields.

### `services/api/types.ts`
Backend DTO source-of-truth — **no change required**. `CourseRuntimeSnapshot` already carries `currentStreak, longestStreak, gauntletActive, gauntletDay, saverCount, saverRecoveryMode, currentYieldRedirectBps, fuelCounter, fuelCap, ichorCounter?, ichorLifetimeTotal?`. `BreweryStateResponse` carries `fuelCounter, fuelCap, saverCount, saversBanked, currentYieldRedirectBps, ichorCounter`. Optional: drop `gauntletActive/gauntletDay` only if backend confirms the gauntlet field is being removed (the repo still emits them, so keep for now).

### `app/onboarding/deposit/page.tsx` (only live consumer of the lock builders)
- The build call (line 297) is unchanged structurally — `buildLockFundsTransaction` keeps its signature; the coursePolicy removal is internal to the builder.
- **Min/max principal enforcement already exists** (lines 255-273), reading `courseLockPolicy.minPrincipalAmountUi` / `maxPrincipalAmountUi` from the backend content `lockPolicy` DTO (`ApiCourseLockPolicy`, `services/api/types.ts:4-9`). No new code needed — just verify it stays. (See section 4.)
- No redeem/convert UI exists in this file. No removal.

### `app/dashboard/page.tsx`
Reads `fuelCounter, fuelCap, ichorBalance, currentStreak, longestStreak, saverCount, saverRecoveryMode, currentYieldRedirectBps` from `courseStore` `activeState`/`courseStates`. **No JSX edit.** Correct automatically once the store is backend-sourced. The page already calls `refreshCourseRuntime` on mount. `ichorBalance` comes from `ichorCounter` (brewery endpoint is the reliable source; `getBreweryState` is already wired and the alchemy/dashboard refresh path covers it). Verify null-runtime renders fall back to defaults (0).

### `app/inventory/page.tsx`
Reads `fuelCounter, fuelCap, ichorBalance, saverCount, longestStreak` from `courseStore`. **No code change** beyond store re-sourcing. Optional copy review: the UI labels Fuel as "Refines into Ichor" — under the v4 fire-timer model this wording may be stale, but that is a content decision, not a Task C data-wiring fix.

### `app/alchemy/page.tsx` (Brewery)
Already backend-sourced via `getBreweryState`/`feedFire`/`claimYield`; reads `fuelCounter/fuelCap` from the store. **No change.** Its `refreshCourseRuntime` after feed/claim is fine once the store is backend-only. No redeem UI (feedFire = fuel→fire timer, claimYield = USDC payout, both backend).

### `app/community-pot/page.tsx`
Per-course chip strip reads `saverCount, saverRecoveryMode, currentYieldRedirectBps` from `courseStore`. **No JSX edit** — correct once store is backend-sourced. Pot history already from `getCommunityPotHistory`. No redeem UI.

### `app/courses/page.tsx`
Streak read from `courseStates` (store) + `enrollment.runtime.currentStreak` (backend, in `onComplete`). **No change** once store is backend-sourced. Keep `runtime?.currentStreak` optional chaining.

### `app/lessons/[id]/page.tsx`
`fuelCounter`/`fuelAwarded` come from the backend `submitLesson` response (`result.courseRuntime`) — correct. `currentStreak` from store post-completion. **No change.**

### `app/lessons/[id]/result/page.tsx`
Fuel via URL params (originally backend submit response); streak from store. **No change** once store is backend-sourced.

### `components/WalletConnect.tsx`, `components/AppShell.tsx`, `components/Sidebar.tsx`
Already on the correct off-chain path: streak from `getUserEnrollments().enrollments[].runtime?.currentStreak`; `AppShell` uses `courseStates[].lockAccountAddress` (custody field, survives) for `hasActiveLock`. Sidebar reads via `getStreak()` selector. **No change** — they inherit the store re-sourcing. Verify `lockAccountAddress` is still populated post-refactor (it is: via `restoreFromBackend` + the custody-only on-chain check).

---

## 4. Principal Min/Max Client-Side Enforcement

**Already implemented and on the correct surface** — `app/onboarding/deposit/page.tsx` lines 255-273. It reads `minPrincipalAmountUi` / `maxPrincipalAmountUi` (and `demoPrincipalAmountUi`) from `courseLockPolicy` (the backend content module's `lockPolicy` DTO, `ApiCourseLockPolicy` in `services/api/types.ts:4-9`), blocks submit before building the transaction, and shows a clear message. Duration bounds are likewise enforced via `minLockDurationDays`/`maxLockDurationDays` (lines 137-138).

Action: **verify only.** Because the on-chain program no longer holds a `course_policy` account (the chain will not reject an out-of-bounds principal), this client-side gate is now the *sole* enforcement of bounds — ensure it stays in place and runs before `buildLockFundsTransaction`. No new code required. If you want defense-in-depth, optionally surface the same bounds inside `buildLockFundsTransaction` as a guard, but it is not required and the policy values are not available inside the solana service layer (they live in the content DTO), so keep enforcement in the deposit page.

---

## 5. Missing Backend Endpoints (blockers)

- **`skrTier` — NOT BLOCKING but UNSOURCED.** No backend endpoint or DB field provides `skrTier`/`skr_tier` (grep over `backend/src` and `web-app/services/api` returns zero). It is also NOT read by any live web-app consumer (none of the 7 pages read `skrTier`). The only SKR datum is the on-chain custody `skr_locked_amount`, surfaced as `skrLockedAmountUi`. Conclusion: no UI depends on `skrTier`, so the refactor is **not blocked**. If a future feature needs a tier, a new backend field or a client-side derivation from `skrLockedAmount` must be added — do not assume one exists.
- **Ichor balance source nuance.** `ichorCounter` is always present on `GET /v1/progress/brewery` but only optional on `GET /v1/progress/runtime/courses/:courseId` (`CourseRuntimeSnapshot.ichorCounter?`) and absent in the no-DB fallback. Dashboard/inventory read `ichorBalance` from the store. To populate it reliably, the store's ichor field should be fed from the brewery response (already fetched on the alchemy page and refreshable elsewhere) or from `getCourseRuntime` when present. **Not a missing endpoint** — the data exists via brewery — but wire ichor from the brewery/runtime response, not the (now-removed) decoder. If product wants ichor on the dashboard without visiting the brewery, ensure dashboard mount calls `getBreweryState` (or that `getCourseRuntime` reliably returns `ichorCounter`). Flag for confirmation, not a hard blocker.

All other game-state fields (fuel, fuelCap, streak, gauntlet, saver, redirect) have authoritative backend endpoints already wrapped in `progressApi.ts`.

---

## 6. Risks + Safe Implementation Order (keep `npx tsc --noEmit` green at each step)

### Risks
- **Type-cascade if order is wrong.** Trimming `LockAccountSnapshot` before fixing `syncLockSnapshot` produces TS errors (store reads removed fields). Fix the store in the same step.
- **Account-key order regression.** Dropping `coursePolicy` must keep the remaining 12 keys in exact IDL order (`protocol_config` first, then `lock_account`, …). Off-by-one ordering silently breaks `lock_funds` at runtime, not at compile time — diff against the IDL list in section 0.
- **Stale `.env` program ID.** If `NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID` still points at the old program, PDAs derive against the wrong program → "no lock account" / failed lock. Env change is mandatory and silent (no TS signal).
- **Unused-helper / unused-export lint.** Removing functions can leave `readBool`/`readU16` and dead imports; if `noUnusedLocals`/`noUnusedParameters` are on, these fail tsc. Remove them in the same commit.
- **`ichorBalance` showing 0** on dashboard/inventory if the only ichor source (brewery) is not fetched on those pages. Cosmetic, not a crash, but confirm with product.
- **Null runtime.** Backend `runtime` can be `null`; keep optional chaining and default-to-0 in selectors/`normalizeCourseGameState`.

### Order (each step compiles independently)
1. **Env first (no code):** set `NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID` to the merged ID. Run `npx tsc --noEmit` (still green; nothing changed in TS).
2. **`lockVault.ts` — coursePolicy removal in `buildLockFundsTransaction`** + delete `COURSE_POLICY_SEED`, `deriveCoursePolicyAddress`. Remove `deriveCoursePolicyAddress` from `index.ts` barrel in the same step. `tsc` green (no consumer imported it).
3. **`lockVault.ts` — delete ichor/redeem/redemption surface**: `buildRedeemIchorTransaction`, `encodeRedeemIchorInstructionData`, `REDEEM_ICHOR_DISCRIMINATOR`, `getIchorConversionBps`, `formatIchorConversionRate`, `getIchorRedemptionQuote`, `parseIchorAmount`, `fetchRedemptionVaultBalance`, `RedeemIchorBuildResult`, `RedemptionVaultBalance`. Drop the matching `index.ts` barrel exports in the same step. `tsc` green (no consumer imports any of them).
4. **`lockVault.ts` — rewrite `decodeLockAccountSnapshot` + trim `LockAccountSnapshot`** (section 1) and delete now-unused `readBool`/`readU16`. This is the step that breaks `courseStore.syncLockSnapshot` typing, so do step 5 in the **same** commit/step.
5. **`stores/courseStore.ts` — rewrite `syncLockSnapshot`** to custody-only (section 3) and add the backend `refreshCourseRuntime` trigger in `syncOnChainEnrollments`. Now `tsc` green again.
6. **Optional `types/courseState.ts`** cleanup (drop `extensionDays`) — only if you also remove its writers/readers; otherwise skip. `tsc` green.
7. **Verify-only passes:** confirm deposit page min/max gate (lines 255-273) intact; confirm pages render with `runtime = null`. Run full `npx tsc --noEmit`, then build (`next build` / lint).
8. **Independent verification:** run a Codex review pass on the diff (custody decoder offsets vs IDL, the 12-key `lock_funds` order, store re-sourcing) before claiming done — self-verification shares the decoder's blind spots.

Steps 2 and 3 are independent and can be done in either order; steps 4+5 must land together to keep tsc green.
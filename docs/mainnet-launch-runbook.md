# Mainnet Launch Runbook

Operational runbook for the remaining pre-mainnet blockers. Companion to the
mainnet-readiness audit. Do these on **devnet first**, then mainnet.

> Status legend: 🔴 blocker · 🟡 do-before-launch · ✅ done

Current live program (devnet): `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav`
Current upgrade authority (single key): `2myuLZ82FoZgk9rboKpog2n5qbHvoWeCxJ75R2n4VF1t`

---

## 1. 🔴 Move program upgrade authority to a Squads multisig

**Why:** today one key can push new bytecode to the custody program and drain
every lock. A multisig means an upgrade needs N-of-M approvals. This is the
single most important pre-mainnet hardening for a fund-custody program.

**Decision — multisig vs immutable:**
- **Squads multisig (recommended):** keeps the ability to ship a fix, but no
  single key can. Best for a custody program that may need patching.
- `--final` (immutable): no one can ever upgrade. Safer against key compromise,
  but you can't fix a bug. Only choose this after an audit + battle-testing.

### Steps (do on the MAINNET deployment; rehearse on devnet first)

1. **Create the multisig.** In the Squads app (https://app.squads.so) create a
   multisig with your signer set + threshold (e.g. 2-of-3). Note its **Vault
   (program-authority) address** — this becomes the new upgrade authority.

2. **Transfer upgrade authority** with the *current* deployer key signing.
   The new authority is a PDA (can't sign), so the signer-check must be skipped:
   ```bash
   solana program set-upgrade-authority <PROGRAM_ID> \
     --new-upgrade-authority <SQUADS_VAULT_ADDRESS> \
     --upgrade-authority <CURRENT_DEPLOYER_KEYPAIR.json> \
     --skip-new-upgrade-authority-signer-check \
     --url <CLUSTER_RPC>
   ```
   (Equivalently, use Squads' "Add program" flow, which performs this for you.)

3. **Verify** the authority changed:
   ```bash
   solana program show <PROGRAM_ID> --url <CLUSTER_RPC>
   # → "Authority:" must now be the Squads vault address, not 2myuLZ…
   ```

4. **From now on, upgrades go through Squads:** propose the new program buffer,
   collect threshold approvals, execute. Keep the multisig members' keys safe
   and geographically/organizationally separated.

> Verify exact UI steps against current Squads docs — the `solana` CLI portion
> above is stable; the Squads app flow may evolve.

---

## 5. 🔴 Validate `unlock_funds` on real devnet (principal returns 1:1)

**Why:** every money path is proven in simulation (LiteSVM) and the *lock* side
is proven on real devnet — but **unlock has never executed on a real cluster.**
We need one real unlock that returns principal and flips the lock to closed.

**Constraint:** the program enforces `now >= lock_end_ts`, and the shortest
allowed lock is **14 days** (allow-list: 14/30/45/60/90/180/365). You cannot
warp the clock on a real cluster, so a real unlock requires a matured lock.

### Path A — canonical (no code change, recommended)
1. In the app, lock a **small** amount (e.g. 1 test USDC) on a **14-day** term
   against `3RC9Xk…`. Record the lock date and the lock account address
   (`scripts/inspect-lock-vault.mjs` lists it).
2. Wait for maturity (14 days). *(Your existing 30-day lock from Jun 22 matures
   ~Jul 22 and is a second opportunity.)*
3. On/after the end date, **unlock** from the app (the matured course shows the
   withdraw action). On-chain this is `unlock_funds` — 8 accounts, **no**
   `protocol_config` (the SKR-free path).
4. **Verify** with `scripts/inspect-lock-vault.mjs`:
   - the lock's `status` flips `0 → 1` (closed),
   - the owner's USDC balance increased by exactly the principal,
   - capture the **transaction signature** + explorer link as the proof.

### Path B — faster smoke test (throwaway program)
If you want to exercise the unlock instruction sooner than 14 days: temporarily
add a short test duration (e.g. `1`) to `validate_lock_duration` in
`programs/locked_in/src/vault.rs`, deploy to a **separate throwaway devnet
program ID**, lock → wait 1 day → unlock. This proves the instruction end-to-end
without touching the real program. Discard the throwaway program after.

**Do not promote to mainnet until at least one real-cluster unlock has returned
principal and been recorded here:**

```
Lock acct:   ____________________   amount: ____ USDC   term: 14d
Locked tx:   ____________________   date: ________
Unlock tx:   ____________________   date: ________   ✅ principal returned, status→1
```

---

## 4. ✅ Production DB migrations — runner is built; here's how to use it

`backend/scripts/migrate.mjs` applies `backend/sql/*.sql` in order against
`$DATABASE_URL`, tracked in `public.schema_migrations` (each file runs once,
each in its own transaction). Verified on a fresh DB (39/39) and on the adopt
path. Run via `npm run migrate` (from `backend/`).

### One-time prod bootstrap (the live DB predates the runner)
The prod DB is at `0038` and has the non-re-runnable seed migrations already
applied, so we **adopt** it rather than replay history:
```bash
# inside the Render backend shell (DATABASE_URL is set there):
node scripts/migrate.mjs --baseline --through 0038_drop_yield_splitter_columns.sql
node scripts/migrate.mjs          # applies the pending 0039_drop_skr_columns
node scripts/migrate.mjs --status # confirm 39/39 applied
```
(If you skip the baseline on a populated DB, the runner **refuses** and tells you
this — it won't blindly replay the seed files.)

### Going forward
1. Add `backend/sql/00NN_description.sql`.
2. Wire `npm run migrate` as a **Render pre-deploy / release command** on the
   backend service so every deploy applies pending migrations automatically.
3. New deploys then self-migrate; `migrate` is a no-op when nothing is pending.

---

## 3. ✅ Misleading copy fixed
`web-app/app/village/VillageTour.tsx` no longer claims Ichor "redeems for USDC."
Ichor is correctly described as in-game-only (spent on Streak Savers).

---

## Remaining (tracked elsewhere, not in this runbook)
- 🔴 **Simulated yield paid as real USDC** — keep the `isDevnetOnly()` guards on;
  do NOT enable yield/community-pot USDC payouts on mainnet until a real
  on-chain yield source (Kamino CPI) + a solvency cap back them. The safe v1 is
  a **commitment/savings device**: lock principal, return 1:1, all yield/ichor/
  fuel are cosmetic off-chain points.
- 🔴 **Third-party security audit** of the custody program before real funds.
- 🟡 Error tracking (Sentry), auth-endpoint rate limits, security headers.
- 🟡 `computeLeaderboardRows` N+1 → batch via `getMultipleAccounts` before scale
  (mitigated for now by cron-only refresh).

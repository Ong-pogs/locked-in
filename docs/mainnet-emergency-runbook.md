# Locked In — Mainnet Emergency Runbook

What to do when something breaks on mainnet with real user USDC in the vault.
Every claim below is traced to code; where the code says something inconvenient,
this document says the inconvenient thing.

**Read this first:** `docs/mainnet-deploy-runbook.md` §14 says *"Principal is
always claimable (owner-only redeem); no admin drain path."* The second half is
true. **The first half is false.** There is no owner-only redeem in v2. A user
cannot get their principal back without either (a) an ops-signed voucher, or
(b) waiting 180 days. That single fact drives this entire document.

---

## 0. The exit map (what actually moves principal)

| Path | Instruction | Who must sign | Precondition |
| --- | --- | --- | --- |
| Normal claim | `claim_v2` | the **owner**, plus an Ed25519 voucher signed by `config.authority` (the ops key) in the same tx | lock `ACTIVE`, voucher unexpired |
| Backstop | `force_return_v2` | **anyone** (caller pays fees) | lock `ACTIVE` and ≥ **180 days** since `lock_start_ts` |
| Admin drain | — | — | **does not exist** |

- `claim_v2` (`programs/locked_in/src/vault_v2.rs`) calls `verify_voucher`
  against `config.authority`; without a matching Ed25519 precompile instruction
  earlier in the transaction it fails with `VoucherNotEd25519` /
  `VoucherWrongMessage`. The owner's signature alone is not sufficient.
- `force_return_v2` is permissionless and takes no arguments. It pays the owner
  principal + rent, sends **all yield to the community pot** (bps 0), and closes
  the lock. `caps.rs FORCE_RETURN_AFTER_SECS = 15_552_000` (180 days).
- No instruction can send principal anywhere other than the lock's owner.

**Consequence: the ops voucher key is the only fast exit.** Escrow it offline
(paper/hardware, geographically separated, at least two copies) *before* the
first mainnet deposit. Losing it does not lose user funds, but it converts every
outstanding lock into a 180-day wait.

---

## 1. Voucher endpoint outage (backend down, DB down, signer misconfigured)

Symptom: users can deposit but "Claim" fails; `POST
/v1/progress/courses/:courseId/voucher` errors or 5xx.

Funds are safe — nothing is stuck on-chain, the lock stays `ACTIVE`. The claim
path is offline, not broken.

1. **Pause new deposits** so the affected population stops growing:
   `set_config_v2(..., paused = true)`, signed by the ops key (see §3 for what
   pause does and does not do).
2. Check the boot guards first: `backend/src/lib/bootGuards.mjs` refuses to boot
   with `VAULT_V2_PROGRAM_ID` set but `LOCK_VAULT_WORKER_PRIVATE_KEY` missing.
   A silent claim failure with a healthy boot usually means the key is present
   but is **not** the on-chain `config.authority` — compare
   `LOCK_VAULT_WORKER_PRIVATE_KEY`'s pubkey against bytes 8..40 of the config
   account (`decodeVaultV2Config` in `backend/scripts/force-return-crank.mjs`).
3. Vouchers are valid for **90 days** by default (`VOUCHER_TTL_SECONDS`), and
   already-issued vouchers are persisted, so anyone who fetched one before the
   outage can still claim. There is no on-chain deadline pressure for 90 days.
4. If the endpoint cannot be restored, a voucher can be signed **out of band**
   with the escrowed ops key: the message is
   `"lockedin:claim:v1" || program_id || lock || bps(u16 LE) || expiry(i64 LE)`
   (91 bytes, `backend/src/lib/claimVoucher.mjs` / `voucher.rs::build_message`),
   `bps ∈ {10000, 5000, 0}`. Hand-signing vouchers is a manual, audited,
   one-at-a-time process — treat it as a last resort, not a workflow.

---

## 2. Ops key lost or compromised

The ops key (`LOCK_VAULT_WORKER_PRIVATE_KEY`) is `config.authority`. It signs
vouchers and `set_config_v2`. It **cannot** move principal, rotate itself, or
touch the pinned Kamino accounts.

**Recovery = `set_authority_v2`, and only the program's upgrade authority can
call it.** From `vault_v2.rs`:

```
#[derive(Accounts)]
pub struct SetAuthorityV2<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, VaultV2Config>,
    pub payer: Signer<'info>,                       // must BE the upgrade authority
    pub program: Program<'info, crate::program::LockedIn>,
    pub program_data: Account<'info, ProgramData>,  // upgrade_authority_address == payer
}
```

There is deliberately **no `has_one = authority`** here: a compromised hot key
cannot rotate itself away, and a lost hot key does not brick the vault.

**Who can sign it:** whoever holds the mainnet program's upgrade authority —
per the deploy runbook that is the Squads multisig created in the ceremony, so
it needs the multisig's threshold of co-signers, not one person.

**Procedure** (mirror of the devnet-proven
`programs-tests/scripts/devnet-v2-set-authority.mjs`, which is the only checked-in
implementation — it hardcodes the devnet program id and devnet RPC, so a mainnet
rotation needs the mainnet program id and RPC substituted):

1. Generate a fresh ops keypair offline. Record its pubkey.
2. Build the instruction: data = `sha256("global:set_authority_v2")[..8] ||
   new_authority(32)`; accounts, in order:
   `config` (PDA of `["vault-v2b"]`, writable) · `payer` (signer, = upgrade
   authority) · `program` (the program id) · `program_data`
   (PDA of `[program_id]` under `BPFLoaderUpgradeab1e11111111111111111111111`).
3. Sign with the upgrade authority (Squads: propose → collect threshold →
   execute).
4. Verify: re-read the config account, bytes 8..40 must equal the new pubkey.
5. Put the new key in `LOCK_VAULT_WORKER_PRIVATE_KEY` on Render and redeploy.
   Old vouchers signed by the *previous* authority stop verifying the moment the
   rotation lands — re-issue vouchers for anyone mid-claim.

**`[⚠]` If the program is ever made immutable** (upgrade authority set to
`None`), `set_authority_v2` becomes permanently uncallable and ops-key loss is
unrecoverable: every outstanding lock then exits only via the 180-day
`force_return_v2`. Do not burn the upgrade authority while locks are open.

---

## 3. Pause semantics — exactly what `paused` does

`set_config_v2(min, max, global, fee_bps, paused)` is ops-key gated.
`paused` is read in exactly one place: `caps.rs::assert_lock_allowed`, which is
called only from `lock_funds_v2`. Therefore:

- **Blocked while paused:** funding a lock (`lock_funds_v2` → `VaultPaused`).
- **Still allowed while paused:** `open_lock_v2` — it creates the `PENDING`
  lock account and never consults `paused`. A user can open a lock and then be
  unable to fund it; the frontend should not offer this. The `PENDING` lock is
  harmless (principal 0) but is *not* force-returnable (that requires `ACTIVE`).
- **Never blocked:** `claim_v2` and `force_return_v2` do not read `paused` at
  all. **Pausing never traps anyone's money.** This is the one guardrail that
  works exactly as the deploy runbook advertises.
- Caps (`min`/`max`/`global`) likewise apply only to new locks; lowering them
  does not affect existing positions.

Pause is the correct first move for almost every incident: it stops the blast
radius growing without touching anyone already in.

---

## 4. The 180-day force-return path

`backend/scripts/force-return-crank.mjs` scans every `LockV2` account, keeps the
`ACTIVE` ones past `lock_start_ts + 180d`, and submits `force_return_v2` for
each. It is permissionless — any funded key can run it, so users are not
dependent on the team being alive.

```
node scripts/force-return-crank.mjs --dry-run   # list what is due
node scripts/force-return-crank.mjs             # submit
```

Per lock it sends: idempotent owner-USDC ATA create (the program does not
`init_if_needed` `owner_usdc`, and a closed ATA would otherwise trap the
return) → compute-budget bump → **`refresh_reserve`** (real klend only) →
`force_return_v2`. The `refresh_reserve` prepend is required because klend
rejects a settle against a stale reserve (max oracle age 180s); it is built
byte-for-byte like `buildRefreshReserveIx` in
`web-app/services/solana/vaultV2.ts` and is skipped on the devnet mock reserve,
which needs no refresh.

- Env: `VAULT_V2_PROGRAM_ID`, `LOCK_VAULT_WORKER_PRIVATE_KEY` (any funded key
  works here — it is only the fee payer), and `KAMINO_SCOPE_PRICES` if the
  pinned reserve's scope oracle differs from the Kamino main-market USDC
  default. Scope prices is a public account, not a secret.
- The crank logs which mode it is in before scanning and fails before submitting
  anything if the scope oracle is unusable, so a misconfiguration cannot burn
  fees on a whole sweep of failed settles.
- Yield on a forced return goes **entirely to the community pot**, not the user.
  This path returns principal, not profit. It is a backstop, not an exit users
  should ever be routed to on purpose.

**Untested against real klend.** The crank's real-Kamino instruction shape is
unit-pinned against the frontend builder that was proven on a surfpool mainnet
fork (`docs/real-kamino-fork-proof.md`), but no `force_return_v2` has been
executed against a real klend reserve. Rehearse it on devnet (§5) before
relying on it.

---

## 5. Devnet rehearsal — do this before mainnet

The live devnet v2 program `EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN` is
several source generations behind `programs/locked_in/src/lib.rs` (which
declares the staging id `3RC9XkPZ…kBav`). Until it is rebuilt and upgraded,
`set_pot_authority`, the 2-arg `initialize_pot`, and `open_lock_v2`'s
`init_if_needed` have **never executed anywhere** — mainnet would be their first
run. Fix that:

```
scripts/deploy/build-devnet-v2.sh    # patches declare_id -> EUAB…GucsN, builds, restores the tree
# then upgrade, signed by the devnet upgrade authority:
solana program deploy --url devnet --program-id target/deploy/locked_in-keypair.json \
  --upgrade-authority <upgrade-authority.json> target/deploy/locked_in.so
```

The script restores `declare_id` on exit including on build failure, and
refuses to run if the tree is mid-edit. Deploy the artifact immediately — any
later `anchor build` overwrites it with the staging id.

Then rehearse each emergency path on devnet, in this order:

1. `set_config_v2(paused = true)` → confirm a deposit fails and a claim succeeds.
2. `set_authority_v2` → rotate the ops key and back
   (`programs-tests/scripts/devnet-v2-set-authority.mjs`), confirm vouchers
   signed by the old key stop verifying.
3. `force_return_v2` → on a lock whose `lock_start_ts` is past the window.
4. Only then flip mainnet.

---

## 6. Pre-launch checklist for the things this document depends on

- [ ] Ops voucher key generated offline and **escrowed** (≥2 copies, separated).
- [ ] Upgrade authority is the Squads multisig, threshold and co-signers
      documented and reachable **out of band** — §2 is unusable if the only
      person who can convene the multisig is unreachable.
- [ ] Upgrade authority NOT burned; no plan to make the program immutable while
      locks are open.
- [ ] §5 rehearsal completed on devnet against the rebuilt program.
- [ ] `force-return-crank.mjs` runnable by someone other than the primary
      operator, with the command and env documented where they can find it.
- [ ] `docs/mainnet-deploy-runbook.md` §14's "principal is always claimable"
      line corrected to point here.

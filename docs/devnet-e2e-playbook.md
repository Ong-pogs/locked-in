# `locked_in` — Devnet Deploy + End-to-End Test Walkthrough

> Operator runbook for the **merged** `locked_in` program.
> Program ID: **`3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav`**
> One on-chain program, two config domains (vault + pot) under distinct PDA seeds. The game layer (fuel / ichor / streak) is **off-chain** in Postgres.
>
> Follow top to bottom. Every command is copy-pasteable. All paths are absolute.

---

## 1. Overview & sequence

This used to be three programs (`lock_vault`, `community_pot`, `yield_splitter`). It is now **one** program, `locked_in`, ID `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav`. The vault and pot share that single program ID and are separated only by their PDA seeds:

- Vault config PDA: `seeds = [b"vault-protocol"]`
- Pot config PDA: `seeds = [b"pot-protocol"]`

**Dead IDs — must appear NOWHERE in clients anymore:**

| Old program | Dead ID |
|---|---|
| `lock_vault` | `41TexnrHDMV4ASJmqNNFcgQ7RBk6N193yvukfiCzKQmD` |
| `community_pot` | `BsJDnhJGVdLQ3mxBJ7YCMkkBitKP2RT49zFqR9XsGri1` |
| `yield_splitter` | `8bevd3T3LWoUh2Z9348UKwFFN1p5MdbRbAe2zniCrnVv` |

**Why deploy-first ordering:** The off-chain stack does *nothing useful* until the program is live and the two config PDAs exist. `lock_funds`, `unlock_funds`, `record_redirect`, `close_distribution_window`, and `distribute_window` all read `VaultConfig` / `PotConfig` from those PDAs; if they don't exist, every on-chain test fails with an account-not-initialized error and you'll waste time chasing phantom client bugs. So the sequence is:

```
Phase A  Deploy .so → verify → initialize_vault + initialize_pot → confirm PDAs exist
Phase B  Wire backend + web-app env to the merged ID + devnet → start DB → run stack → confirm clean boot
Phase C  E2E test matrix (custody path lock → … → unlock FIRST, since it's the highest-risk part of the merge)
Phase D  Restructuring-specific watch list
Phase E  Troubleshooting
```

**The 7 on-chain instructions (authoritative, from `/Users/marcus/Projects/locked-in/target/idl/locked_in.json`):**
`initialize_vault`, `initialize_pot`, `lock_funds`, `unlock_funds`, `record_redirect`, `close_distribution_window`, `distribute_window`.
There is **no `redeem_ichor`** and no yield-splitter instruction — ichor is spent purely in the DB.

**Verified toolchain / state:** `solana-cli 3.0.6 (Agave)`, `anchor-cli 0.31.1`. `declare_id!` at `/Users/marcus/Projects/locked-in/programs/locked_in/src/lib.rs:39`, the program keypair pubkey, and the IDL `address` field all equal `68im45…`. The `.so` is built (`/Users/marcus/Projects/locked-in/target/deploy/locked_in.so`, ~360 KB).

---

## 2. Phase A — Deploy + initialize on devnet

### A0. Sanity pre-checks (do not skip)

```bash
# The program keypair pubkey MUST equal the declared program ID.
# If it differs, STOP: the .so was built against a different keypair.
solana-keygen pubkey /Users/marcus/Projects/locked-in/target/deploy/locked_in-keypair.json
# Expect: 3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav

# The built artifact must exist.
ls -la /Users/marcus/Projects/locked-in/target/deploy/locked_in.so

# The IDL address must match (belt and suspenders).
node -e "console.log(require('/Users/marcus/Projects/locked-in/target/idl/locked_in.json').address)"
# Expect: 3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav
```

> **BACK UP `target/deploy/locked_in-keypair.json` NOW.** It is gitignored and exists only on this machine. Lose it and you can never deploy or upgrade this program ID again.

### A1. Point CLI at devnet, pick the deployer wallet, fund it

```bash
solana config set --url https://api.devnet.solana.com --keypair ~/.config/solana/id.json
solana config get
solana address          # this is the deployer/payer AND default upgrade authority
solana balance
```

**Cost reality:** an upgradeable deploy reserves **2× the bytecode** for programdata. At ~360 KB the real cost is **~5.0 SOL**, not 2.51 (2.51 is just 1× the raw `.so`). **Budget ~5.1–5.5 SOL.** Rent is reclaimable on close but the wallet must hold it up front.

Devnet airdrop is rate-limited (~1–2 SOL/request, per-IP cooldowns). Request in chunks; wait 10–30s between attempts:

```bash
solana airdrop 2
solana airdrop 2
solana airdrop 2
solana balance     # do not proceed until >= ~5.1 SOL
```

If the CLI airdrop keeps getting throttled, use the web faucet to your `solana address`:
- https://faucet.solana.com (select **Devnet**) — larger per-request amounts, separate quota.
- Or airdrop via a less-throttled RPC (Helius/QuickNode devnet endpoint) if you have one.

### A2. Deploy the `.so` at the fixed program ID

Use `solana program deploy` directly. `Anchor.toml` `[provider] cluster = "Localnet"`, so plain `anchor deploy` would target the wrong cluster. The explicit form removes all cluster ambiguity:

```bash
solana program deploy \
  /Users/marcus/Projects/locked-in/target/deploy/locked_in.so \
  --program-id /Users/marcus/Projects/locked-in/target/deploy/locked_in-keypair.json \
  --keypair ~/.config/solana/id.json \
  --url https://api.devnet.solana.com
```

Notes / gotchas:
- `--program-id` takes the **keypair file**, not the base58 string. That keypair is what pins the deploy to `68im…`.
- Default `--max-len` = 1× the current `.so` (no headroom for a *larger* future upgrade). Fine for devnet. If you expect the binary to grow, add headroom now, e.g. `--max-len 800000` (costs more rent up front, avoids a later `solana program extend`).
- Interrupted deploy → a "buffer" account holds your SOL. Recover with `solana program close --buffers`, or resume with `solana program deploy --buffer <BUFFER_KEYPAIR>`.
- The deployer wallet becomes the **upgrade authority** by default — keep it as authority on devnet so you can redeploy fixes. Do **not** run `--final` or transfer authority on devnet.

**Alternative (Anchor flow), only if you prefer it** — you must force the cluster:
```bash
anchor deploy --provider.cluster devnet --provider.wallet ~/.config/solana/id.json --program-name locked_in
```
Do **not** run a fresh `anchor build` unless Rust source actually changed — a rebuild against a different keypair would break the `declare_id` match.

### A3. Verify the deploy

```bash
solana program show 3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav --url https://api.devnet.solana.com
```
Confirm:
- **Program Id:** `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav`
- **Owner:** `BPFLoaderUpgradeab1e11111111111111111111111`
- **ProgramData Address:** present
- **Authority:** your `solana address`
- **Data Length:** ~360,544 bytes

Explorer: `https://explorer.solana.com/address/3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav?cluster=devnet`

**Optional but recommended — publish the IDL on-chain** so explorers/clients can fetch it:
```bash
anchor idl init 3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav \
  --filepath /Users/marcus/Projects/locked-in/target/idl/locked_in.json \
  --provider.cluster devnet \
  --provider.wallet ~/.config/solana/id.json
# Use `anchor idl upgrade` (not init) on subsequent IDL changes.
```

### A4. Initialize the two config PDAs

Both init instructions live in the one merged program. They coexist via distinct seeds.

| Instruction | Discriminator (verified vs IDL) | Seed (bytes) | Args |
|---|---|---|---|
| `initialize_vault` | `[48,191,163,44,71,129,63,164]` | `b"vault-protocol"` `[118,97,117,108,116,45,112,114,111,116,111,99,111,108]` | `usdc_mint: pubkey` |
| `initialize_pot` | `[142,71,252,186,244,59,203,118]` | `b"pot-protocol"` `[112,111,116,45,112,114,111,116,111,99,111,108]` | `stable_mint: pubkey` |

**Authority is load-bearing.** The `authority` signer on each init becomes the stored config authority. For the pot, `record_redirect`, `close_distribution_window`, and `distribute_window` all enforce `has_one = authority` (error `UnauthorizedWorker`). So **the keypair that signs `initialize_pot` MUST be the same key the backend later uses as the pot worker** (`LOCK_VAULT_WORKER_PRIVATE_KEY`, or `COMMUNITY_POT_WORKER_PRIVATE_KEY` if you set it). On-chain validation also requires (vault only) `usdc_mint` to be non-default, else `InvalidMintConfig` (6002).

**Run the (fixed) init scripts.** They are env-driven and idempotent (short-circuit `already_initialized` if the PDA exists). They read `.env` from the **current working directory** and need `@solana/web3.js` + `bs58`, which are installed under `backend/`. So run from `backend/`:

```bash
# 1) Make sure backend/.env has the required keys (see Phase B for the full list).
#    Minimum for init: EXPO_PUBLIC_LOCKED_IN_PROGRAM_ID (or EXPO_PUBLIC_LOCK_VAULT_PROGRAM_ID),
#    EXPO_PUBLIC_LOCK_VAULT_USDC_MINT,
#    DEPLOYER_PRIVATE_KEY (base58 secret of the protocol authority — must sign),
#    EXPO_PUBLIC_SOLANA_RPC_URL (defaults to devnet if omitted).

# 2) Fund the authority pubkey with a little SOL for rent + fees.
solana airdrop 2 <AUTHORITY_PUBKEY> --url https://api.devnet.solana.com

# 3) Run both inits from backend/ (scripts live one dir up in scripts/).
cd /Users/marcus/Projects/locked-in/backend
node ../scripts/init-lock-vault-protocol.mjs     # initialize_vault  (seed vault-protocol)
node ../scripts/init-community-pot-protocol.mjs   # initialize_pot    (seed pot-protocol)
```
- `init-yield-splitter-protocol.mjs` no longer exists (deleted with the merge) — do not look for it.
- Expect each to print a tx signature, or `already_initialized` on a re-run.

### A5. Confirm the config PDAs exist on-chain

Derive the PDAs and confirm they're owned by the program. Run from `backend/` (has `@solana/web3.js`):

```bash
cd /Users/marcus/Projects/locked-in/backend
node -e '
const {PublicKey,Connection}=require("@solana/web3.js");
const PROGRAM=new PublicKey("3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav");
const conn=new Connection("https://api.devnet.solana.com","confirmed");
(async()=>{
  for (const seed of ["vault-protocol","pot-protocol"]) {
    const [pda]=PublicKey.findProgramAddressSync([Buffer.from(seed)],PROGRAM);
    const info=await conn.getAccountInfo(pda);
    console.log(seed,"PDA",pda.toBase58(),
      info?`OK owner=${info.owner.toBase58()} bytes=${info.data.length}`:"MISSING");
  }
})();
'
```
Expect both PDAs to print **`OK owner=68im45…`**. If either is `MISSING`, the corresponding init didn't land — re-run the script and check the signer/RPC/mint env values before moving to Phase B.

**Phase A done when:** program shows on-chain (A3) AND both config PDAs are owned by `68im45…` (A5).

---

## 3. Phase B — Wire env + run the stack

The merged ID and devnet are already the defaults in all three `.env.example` files; dead IDs have been scrubbed. Copy examples to real `.env` files and fill secrets.

### B1. Sanity grep — no dead IDs in clients

```bash
grep -rn "41TexnrHDMV4ASJmqNNFcgQ7RBk6N193yvukfiCzKQmD\|BsJDnhJGVdLQ3mxBJ7YCMkkBitKP2RT49zFqR9XsGri1\|8bevd3T3LWoUh2Z9348UKwFFN1p5MdbRbAe2zniCrnVv" \
  /Users/marcus/Projects/locked-in/backend /Users/marcus/Projects/locked-in/web-app \
  --exclude-dir=node_modules --exclude-dir=.next
# Expect: NO matches.
```

### B2. Backend env (`/Users/marcus/Projects/locked-in/backend/.env`)

```bash
cp /Users/marcus/Projects/locked-in/backend/.env.example /Users/marcus/Projects/locked-in/backend/.env
```

Set / verify these keys:

**Cluster / program IDs (both → merged ID):**
```
SOLANA_RPC_URL=https://api.devnet.solana.com      # MUST contain "devnet" (fail-closed dev-secret guard)
LOCK_VAULT_PROGRAM_ID=3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav
COMMUNITY_POT_PROGRAM_ID=3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav
```
(`YIELD_SPLITTER_PROGRAM_ID` is dead — must NOT be present.)

**Mint (devnet test mint — must match web-app exactly):**
```
LOCK_VAULT_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

**Authority / worker keys (THIS key must equal the `initialize_vault`/`initialize_pot` authority):**
```
LOCK_VAULT_WORKER_PRIVATE_KEY=<base58 or JSON secret of the funded devnet authority>
# COMMUNITY_POT_WORKER_PRIVATE_KEY=   # optional; falls back to LOCK_VAULT_WORKER_PRIVATE_KEY then DEPLOYER_PRIVATE_KEY
```

**Auth / Privy / DB:**
```
JWT_SECRET=<long random>             # dev fallback works only on devnet RPC; set a real one
SCHEDULER_SECRET=<long random>       # protects internal/scheduler endpoints
PRIVY_APP_ID=cmncshird026v0cl5n6yqq8z0   # must match web-app
PRIVY_APP_SECRET=<from Privy dashboard>
DATABASE_URL=<postgres/supabase connection string>   # required, no fallback
```

**Faucet (turn ON for E2E so test wallets get funded; draws from the worker key):**
```
FAUCET_ENABLED=true
# FAUCET_SOL_LAMPORTS=100000000  FAUCET_USDC_AMOUNT_UI=20  FAUCET_ROUND=1  (defaults fine)
```

**Workers — turn ON for E2E (all default false):**
```
RUNTIME_SCHEDULER_ENABLED=true     RUNTIME_SCHEDULER_INTERVAL_MS=15000   RUNTIME_SCHEDULER_BATCH_SIZE=5
UNLOCK_INDEXER_ENABLED=true        UNLOCK_INDEXER_INTERVAL_MS=15000      UNLOCK_INDEXER_SCAN_LIMIT=25
LEADERBOARD_SNAPSHOT_ENABLED=true  LEADERBOARD_SNAPSHOT_INTERVAL_MS=60000 LEADERBOARD_SNAPSHOT_PAGE_SIZE=25
```

Production leaderboard snapshots are cron-owned. Keep
`LEADERBOARD_SNAPSHOT_ENABLED=false` there and run
`npm run cron:leaderboard-refresh` daily with `LEADERBOARD_REFRESH_BASE_URL`
pointing at the backend API.

**CORS + server (defaults mostly fine):**
```
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
PORT=3001  HOST=0.0.0.0  LOG_LEVEL=info
```
Yield strategy / OpenAI validator are optional for E2E (leave disabled).

### B3. Web-app env (`/Users/marcus/Projects/locked-in/web-app/.env`)

```bash
cp /Users/marcus/Projects/locked-in/web-app/.env.example /Users/marcus/Projects/locked-in/web-app/.env
```
Exactly 7 `NEXT_PUBLIC_*` vars are read by source:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_PRIVY_APP_ID=cmncshird026v0cl5n6yqq8z0          # == backend PRIVY_APP_ID
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_WS_URL=wss://api.devnet.solana.com
NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID=3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav   # merged; pot PDA derived from this
NEXT_PUBLIC_LOCK_VAULT_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU    # == backend
```
`NEXT_PUBLIC_YIELD_SPLITTER_PROGRAM_ID` and `NEXT_PUBLIC_COMMUNITY_POT_PROGRAM_ID` are **not** read — `lockVault.ts` derives both the vault PDA (`vault-protocol`) and pot PDA (`pot-protocol`) from the single `NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID`. Don't set them.

### B4. Consistency invariants (must all hold or E2E breaks)

- `LOCK_VAULT_USDC_MINT` (backend) == `NEXT_PUBLIC_LOCK_VAULT_USDC_MINT` (web-app)
- `PRIVY_APP_ID` (backend) == `NEXT_PUBLIC_PRIVY_APP_ID` (web-app)
- backend `CORS_ALLOWED_ORIGINS` includes `http://localhost:3000`
- on-chain authority used in A4 == `LOCK_VAULT_WORKER_PRIVATE_KEY`
- both env USDC mints == the mint passed to `initialize_vault` in A4

### B5. Start the test DB

```bash
cd /Users/marcus/Projects/locked-in/backend
npm run test:db:up        # docker compose -f docker-compose.test.yml up -d --wait
# Tear down later with: npm run test:db:down
```
Point `DATABASE_URL` at this DB (or at your Supabase devnet DB). Run any migrations/seeders your DB flow requires before booting the server.

### B6. Boot backend

```bash
cd /Users/marcus/Projects/locked-in/backend
npm run check     # node --check src/server.mjs — fast syntax gate
npm run dev       # node --watch src/server.mjs
```
**Clean-boot checklist (watch the logs):**
- Listening on `:3001`, no `CRITICAL` lines.
- Each enabled worker logs that it started (`runtime_scheduler`, `unlock_indexer`, `leaderboard_snapshot`). If a worker logs `CRITICAL` about a non-devnet cluster or incomplete lock-vault read config, fix `SOLANA_RPC_URL`/program ID/mints — it refuses to run otherwise.
- No "missing DATABASE_URL" / "config invalid" errors.

### B7. Boot web-app

```bash
cd /Users/marcus/Projects/locked-in/web-app
npm run typecheck   # optional but cheap
npm run dev         # next dev → http://localhost:3000
```
Open `http://localhost:3000/courses`. Confirm the catalog loads and the browser console shows the API calls hitting `http://localhost:3001` with no CORS errors.

**Phase B done when:** backend listening with all three workers started clean, web-app renders `/courses`, no dead-ID grep hits.

---

## 4. Phase C — End-to-end test matrix

Run **top to bottom**. The on-chain custody path (lock → redirect → close → distribute → unlock) is sequenced **first** because it's the highest-risk part of the restructuring (account ordering, `protocol_config` resolution on a live cluster, the new unlock account layout). Auth/Faucet are prerequisites for it, so they lead. Tick the checkbox as each passes.

### Setup prerequisite (already done in Phase A — re-verify if unsure)

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | Setup | `initialize_vault` + `initialize_pot` exist | Re-run A5 PDA check | Both PDAs owned by `68im45…`; re-running init fails "already exists"; config mints == env mints | critical |

### Auth (gate for everything below)

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | Auth | Privy external-wallet connect + first sign-in | On `/courses` (onboarding) click Sign In → `login({loginMethods:['google','wallet']})` → pick Phantom (devnet) → approve SIWS | Modal shows wallet choice (no auto-sign); `POST /v1/auth/privy-session` → 200 with access+refresh+expiresAt; `walletAddress`+`authToken` set; enrollments load; no 2nd signature | critical |
| ☐ | Auth | Google embedded-wallet sign-in | Sign In → Google → OAuth | `privyUser.google` set; embedded Solana wallet provisioned (`isPrivyWallet=true`); session minted; `walletAddress` = embedded pubkey | high |
| ☐ | Auth | Challenge+signature (non-Privy) | `POST /v1/auth/challenge` → sign `message` → `POST /v1/auth/verify` | `/challenge` returns id+message; valid sig → session; expired → 401 `INVALID_CHALLENGE`; bad sig → 401 `INVALID_SIGNATURE` | medium |
| ☐ | Auth | Session restore + refresh + reuse guard | Sign in, force a 401, load `/leaderboard`; then replay a used refresh token | `fetchWithAuth` auto-refreshes + retries silently; replayed refresh → 401 `REFRESH_TOKEN_REUSED`; full expiry → "Connect your wallet…" | high |

### Faucet (fund the test wallet before locking)

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | Faucet | Devnet USDC + SOL claim | On `/onboarding/deposit?courseId=…` click "Claim Test Tokens" | `claimed:true` with `usdc.amountUsdc` + best-effort `sol.signature`; on-chain USDC ATA + SOL rise; balance strip updates; partial msg if SOL leg fails | high |
| ☐ | Faucet | Idempotency + rate limit | Claim, click again same round; then spam >5/min | 2nd same-round → 429 "Already claimed for this round."; >5/min → 429 rate-limited; no double spend | medium |

### Courses

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | Courses | Browse catalog (ready vs coming-soon) | Open `/courses` disconnected | Catalog loads; tags + lesson counts render; 0-lesson courses dimmed/non-clickable; error path shows Retry | high |
| ☐ | Courses | Enroll parked-intent → deposit redirect | Disconnected, click LOCK & START → sign in within 2 min; separately wait >2 min then sign in | Within 2 min → `/onboarding/deposit?courseId=…`; stale (>120s) park discarded → lands on `/courses`; authed enroll goes straight to deposit | high |
| ☐ | Courses | On-chain enrollment hides locked courses | Wallet with an existing lock for course X opens `/courses` | Course X under Active Courses (streak+progress), removed from Available; `syncOnChainEnrollments` derives lock PDA under `68im45…` and finds the `LockAccount` | high |

### Lock — **HIGHEST RISK, run first in the custody path**

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | Lock | `lock_funds` deposit — user-signed custody on live devnet | `/onboarding/deposit?courseId=…`: ensure USDC (claim first), pick 1 USDC + a whitelisted duration (e.g. 30d), DEPOSIT & START → approve | Tx confirms; `LockCreated` emitted; `LockAccount` PDA: owner=wallet, principal=1e6, lock_end=now+30d, status=active; `stable_vault` ATA (owner=lockAccount) holds principal; **9 accounts resolve in exact IDL order** (see Phase D); `protocol_config` (vault-protocol) matches configured USDC mint; `activateCourse` writes `lockAccountAddress`; routes to `/village` | critical |
| ☐ | Lock | `protocol_config` resolution + `UnsupportedStableMint` guard | Confirm `initialize_vault` used the same `usdc_mint` as `NEXT_PUBLIC_LOCK_VAULT_USDC_MINT`; lock once; (neg) point env at a mint not in VaultConfig | Match → lock succeeds; mismatch → tx fails **`UnsupportedStableMint` (6004)** — proves merged VaultConfig at vault-protocol is live + authoritative | critical |
| ☐ | Lock | Client min/max + duration whitelist | Try below course min (not demo), above max, bad decimals `1.2345678`, amount > balance | Below-min "requires at least N USDC"; above-max "allows at most N"; bad decimals → validation msg; duration pills only show whitelisted `[14,30,45,60,90,180,365]` clamped to policy; insufficient → "Insufficient USDC. You have X"; **no tx built when client validation fails** | high |

### Lessons (drive game state in the DB)

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | Lessons | Two-phase recall→reading→quiz + attempt persistence | Open a lesson with prior completed lessons; answer recall, page reading, Start Questions; reload mid-quiz | Recall shows only when prior questions exist; reading index persists; `/start` called once (`attemptId` minted); after reload `attemptId/startedAt/phase/answers` restore, **no duplicate `/start` (no 409)** | high |
| ☐ | Lessons | Answer validation + submit (MCQ + short_text) → fuel + XP | Remote-verified lesson (releaseId ≠ `local-mock-release`, connected): answer all, submit on last | `accepted=true` with score, `questionResults`, `xp{awarded,total,level}`, `courseRuntime.fuelAwarded=1` + updated `fuelCounter` (≤ cap); store syncs fuel/streak; result page shows score + fuel +1 + XP; streak **not** double-incremented (`serverHandled`) | critical |
| ☐ | Lessons | Local-mock scoring fallback | Lesson with releaseId `local-mock-release` or disconnected; use Check Answer | Per-question Correct/Incorrect immediately; final local score; result page `accepted=true`; **no `/submit` call** | medium |
| ☐ | Lessons | Fuel cap enforcement | Complete lessons until `fuelCounter` = `fuelCap` (7), then one more | +1/lesson until cap; at cap `fuelAwarded` never exceeds cap; dashboard shows "fuel cap reached" | medium |

### Brewery (fire timer + yield claim)

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | Brewery | Feed the fire (consume 1 fuel, +24h) | `/alchemy` with `fuelCounter>0` → Feed the Fire | `applied=true`; `fuelCounter -=1`; `fireLitUntil = max(now,prev)+24h` (additive); countdown shows "Fire burning"; routing line shows X% wallet / Y% pot from `currentYieldRedirectBps`; 0 fuel → `applied=false NO_FUEL`, button disabled | high |
| ☐ | Brewery | Claim yield — real devnet USDC transfer | After scheduler harvested while lit (`unclaimedYieldAmount>0`), Claim to Wallet | `applied=true` with `claimedAmount` + `transfer.signature`; **real USDC arrives in wallet on devnet**; explorer link; `unclaimedYieldAmount`→0; nothing pending → `applied=false NOTHING_TO_CLAIM` | critical |
| ☐ | Brewery | Fire-out routing + 7-day strip + streak | Let fire burn out; observe after subsequent harvests | "Fire out / yield routing to community pot"; new harvests while out add to `potAmount` (strip "→ pot"); lit days show "+$" user amounts; 100% pot when out | high |

### Ichor / Shop (pure off-chain — assert NO on-chain ix)

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | Ichor/Shop | Buy streak saver (off-chain ichor spend) | `/shop` with ichor≥500 & savers not full → Buy 1 Saver; then <500; then 3/3 | `applied=true`: ichor −=500, `saversBanked +1`, "Saver acquired"; dashboard updates; <500 → "Need X ichor"; full → "Inventory already full (3/3)"; **CRUCIAL: pure DB mutation, NO on-chain instruction — no `redeem_ichor` exists** | high |
| ☐ | Ichor/Shop | Earnings ledger + recent harvests | `/shop` for active course with history | Earnings card: gross, fees, redirected, ichorEarned, harvest count; Recent Trades list with gross + ichorAwarded; disconnected → "Connect wallet to view wares." | medium |

### Community Pot (the merged pot domain, `pot-protocol`)

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | CommunityPot | Scheduler records redirect (`record_redirect`) | Active lock + fire out → let runtime scheduler tick | `record_redirect` tx (pot authority) on `68im45…` succeeds; `PotWindow.total_redirected_amount` + `redirect_count` rise; `RedirectReceipt` PDA (seed `redirect`+window+receipt_key) idempotent; `RedirectRecorded` emitted; DB harvest row marked redirected | critical |
| ☐ | CommunityPot | Close window (`close_distribution_window`) | `POST /v1/internal/community-pot/windows/close` with `x-scheduler-key` for an open window | `close_distribution_window` tx (authority signer, window+distribution PDAs at pot-protocol) succeeds; `DistributionWindow` with total_weight + eligible count + closed_at + status=closed; `DistributionWindowClosed` emitted; DB window → CLOSED + snapshot | high |
| ☐ | CommunityPot | Distribute payout (`distribute_window`) — real USDC | After close, `POST /v1/internal/community-pot/windows/distribute` with `x-scheduler-key` | Per-recipient `distribute_window` succeeds: USDC moves `pot_vault`→recipient ATA; `DistributionReceipt` PDA (seed `distribution-receipt`+window+recipient_key) prevents double-pay; `distributed_amount`+`distribution_count` rise; **capped by remaining**; `DistributionPaid` emitted; DB → DISTRIBUTED with sig+amount | critical |
| ☐ | CommunityPot | Pot history UI | `/community-pot` for a previously-paid user with an open window | Current pot shows `totalRedirectedAmountUi`; per-course chips show redirect % + savers/recovery; timeline newest-first (Open/Closed/Distributed) with totals + eligible/paid/redirected; "You were paid" card with +amount + tx link when DISTRIBUTED; FAILED/PENDING/PUBLISHING badges; error → Retry | high |

### Unlock (the lock-first account layout)

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | Unlock | `unlock_funds` after lock_end — user-signed, principal returned | Matured lock (`lock_end_ts ≤ now`): build+sign+send `unlock_funds` from owner | Tx confirms; **`lock_account` accepted as FIRST account** in the 8-key order (see Phase D); principal returns to owner ATA; `LockAccount` status → closed; `LockUnlocked` emitted with `unlocked_at_ts` | critical |
| ☐ | Unlock | Unlock guards | Unlock before maturity; double-unlock a closed lock; unlock signed by non-owner | Pre-maturity → **`LockStillActive`**; double → **`LockAlreadyClosed`**; non-owner → **`InvalidLockOwner`**; vault balance mismatch → **`UnexpectedStableVaultBalance`** | high |

### Workers

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | Workers | runtimeScheduler harvest tick (DB + on-chain redirect) | Backend with `RUNTIME_SCHEDULER_ENABLED` on devnet; wait an interval for an active lock | Reads `LockAccount` snapshot, quotes yield, records harvest idempotently (keyed wallet+course+bucket), splits by fire-lit + redirect bps, publishes redirected slice via `record_redirect`; logs `runtime_scheduler.harvest_processed`; **refuses to start on non-devnet (CRITICAL log)** | high |
| ☐ | Workers | runtimeScheduler miss-day tick (saver/streak reset) | Skip a day's completion so `nextMissDay < today`; let scheduler tick | One idempotent miss event/day; consumes a saver + bumps `current_yield_redirect_bps` (10/15/20 for 1/2/3 used); all 3 used → streak resets to 0, redirect stays 20% cap, recovery flag set; logs `runtime_scheduler.miss_processed` | high |
| ☐ | Workers | unlockIndexer mirrors unlock to DB | After an on-chain `unlock_funds`, run with `UNLOCK_INDEXER_ENABLED`; wait a cycle | Scans recent program sigs, records unlock receipt idempotently (re-scan skips); logs `unlock_indexer.cycle_complete` with recorded/skipped; `GET /v1/progress/unlocks` returns it | high |
| ☐ | Workers | leaderboardSnapshot refresh | Run with `LEADERBOARD_SNAPSHOT_ENABLED`; wait a cycle; load `/leaderboard` | Fresh snapshot (logs snapshotAt/totalEntries/currentPotSizeUi); `/leaderboard` renders podium (top 3) + Pursuers by streakLength; currentUser pre-extracted; "broken" styling; "Your Standing" only when not already visible | medium |

### Cross-cutting UI render (game state from backend, not chain)

| ✅ | Area | Flow | Steps | Expected | Priority |
|---|---|---|---|---|---|
| ☐ | UI | Dashboard renders backend game state | After lessons/feed/buy-saver/scheduler ticks, open `/dashboard` | Fuel = `fuelCounter/fuelCap`; Ichor = `ichorBalance` + savers hint; flame lit iff `currentStreak>0`; savers = 3−saverCount; risk meter + `yieldRedirectPct = currentYieldRedirectBps/100`; recovery banner when `saverRecoveryMode`; XP bar from `/xp`; heatmap from lessonProgress; **all match DB, no garbled decode** | high |
| ☐ | UI | Inventory + community-pot reflect same state | Open `/inventory` and `/community-pot`; cross-check `/dashboard` | Coffers show ichor + fuel/cap; savers = 3−saverCount; achievements by longestStreak (1/7/30/100); pot chips show redirect % consistent with dashboard; **no divergence between pages** | high |
| ☐ | UI | Live APY chip + yield public endpoints | `/dashboard` APY chip; hit `/v1/yield/current-apy` + `/v1/yield/strategy-info` | `current-apy` returns apyBps/apyPct/source/live (live=true only for fresh kamino read, else fixed fallback); chip sane; endpoints rate-limited 60/min; RPC host sanitized (no key leak); `recent-harvests` → 401 `INVALID_SCHEDULER_KEY` without `x-scheduler-key` | medium |

---

## 5. Phase D — What to watch for (restructuring-specific)

The merge from three programs to one is where bugs hide. Specifically check:

**D1. `lock_funds` — exact 9-account order on a LIVE cluster.** LiteSVM/localnet can mask account-ordering bugs; devnet won't. The order must be exactly:
```
1 protocol_config            (vault-protocol PDA — must resolve & match configured USDC mint)
2 lock_account
3 stable_mint
4 owner                      (signer)
5 owner_stable_token_account
6 stable_vault
7 token_program
8 associated_token_program
9 system_program
```
If `protocol_config` doesn't resolve or its mint doesn't match, you'll see `UnsupportedStableMint` (6004) or `InvalidMintConfig` (6002) — that's the merged VaultConfig doing its job, not a client bug.

**D2. `unlock_funds` — lock-first layout (no `protocol_config` account).** `unlock_funds` reads the bound mint directly from `lock_account.stable_mint`, so it takes no `protocol_config` account. Order:
```
1 lock_account
2 stable_mint
3 owner                      (signer)
4 stable_vault
5 owner_stable_token_account
6 token_program
7 associated_token_program
8 system_program
```
Watch that the client builds this order. A stale builder shows up as a "missing account" / wrong-account error, not a clean program error.

**D3. Game state comes from the BACKEND, not the chain.** Fuel, ichor, streak, savers, redirect bps live in Postgres. The dashboard/inventory/community-pot pages must read `GET /v1/progress/...` — none of these values are decoded from on-chain accounts. If a tile is stale or garbled, suspect the DB/decoder path, not the program.

**D4. There is NO `redeem_ichor` (or any ichor) instruction.** The IDL has exactly 7 instructions and none touches ichor. Buying a streak saver MUST be a pure DB mutation. During the Shop test, confirm zero on-chain transactions fire on "Buy Saver." If you see a wallet signature prompt there, something is wrong.

**D5. Pot distribution capped correctly + double-pay protected.** `distribute_window` must (a) cap each payout by the remaining pot amount and (b) create a `DistributionReceipt` PDA (seed `distribution-receipt` + window + recipient_key) so re-running distribute never double-pays. Likewise `record_redirect` is idempotent via its `RedirectReceipt` PDA. Re-invoke the internal distribute endpoint twice and confirm the second run pays nothing new.

**D6. One program, two domains — seeds keep them apart.** Everything keys off `68im45…`. Vault things derive under `b"vault-protocol"`, pot things under `b"pot-protocol"`. If a vault op accidentally reads the pot PDA (or vice-versa), you'll get an account-mismatch — check the seed the client used.

---

## 6. Phase E — Troubleshooting

**Wrong / dead program ID in a client**
- Symptom: tx targets `41Tex…` / `BsJDn…` / `8bevd…`, or "program account not found."
- Diagnose: run the B1 grep. Confirm backend `LOCK_VAULT_PROGRAM_ID` + `COMMUNITY_POT_PROGRAM_ID` and web-app `NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID` all equal `68im45…`. Restart the dev servers after editing `.env` (env is read at boot).

**Config PDA not found / "account not initialized" on lock/redirect/distribute**
- Symptom: `lock_funds`/`record_redirect`/etc. fail referencing `protocol_config`.
- Diagnose: re-run the A5 PDA check. If `MISSING`, re-run the matching init script (A4). Confirm the script's `EXPO_PUBLIC_LOCK_VAULT_PROGRAM_ID` and RPC point at devnet + `68im45…`.

**Mint mismatch → `UnsupportedStableMint` (6004) / `InvalidMintConfig` (6002)**
- Cause: the mint the client uses ≠ the mint stored in VaultConfig.
- Diagnose: the mint passed to `initialize_vault` (A4) MUST equal both env `*_USDC_MINT` values. If you changed the env mint after init, you must re-init with a fresh authority/PDA (the existing PDA is sticky) or set env back to the initialized mint. Check the B4 invariants.

**Insufficient devnet SOL during deploy**
- Symptom: deploy aborts; a buffer account is left.
- Diagnose: `solana balance` < ~5.1 SOL. Top up (A1, web faucet). Reclaim the orphaned buffer: `solana program close --buffers`. Resume: `solana program deploy … --buffer <BUFFER_KEYPAIR>`.

**Worker won't start / refuses to run**
- Symptom: `CRITICAL` log about non-devnet cluster or incomplete lock-vault read config; worker exits.
- Diagnose: `SOLANA_RPC_URL` must contain `devnet`. Program ID + both mints must be set. The fail-closed guard also gates the dev-fallback secrets — on a non-devnet RPC, `JWT_SECRET`/`SCHEDULER_SECRET` dev fallbacks are rejected.

**Authority / `UnauthorizedWorker` on pot ops**
- Cause: `record_redirect` / `close_distribution_window` / `distribute_window` enforce `has_one = authority`. The signer must be the same key that ran `initialize_pot`.
- Diagnose: confirm `LOCK_VAULT_WORKER_PRIVATE_KEY` (or `COMMUNITY_POT_WORKER_PRIVATE_KEY`) is the init authority. If they differ, either re-init with the worker key or set the worker key to the init authority.

**Privy auth fails (modal won't sign / `privy-session` 401)**
- Diagnose: `NEXT_PUBLIC_PRIVY_APP_ID` (web-app) must equal `PRIVY_APP_ID` (backend), and `PRIVY_APP_SECRET` must be the matching server secret from the Privy dashboard. Mismatch → token verification fails. Check the network tab for the failing `/v1/auth/privy-session` response body.

**CORS errors in the browser**
- Diagnose: backend `CORS_ALLOWED_ORIGINS` must include `http://localhost:3000` and `NEXT_PUBLIC_API_URL` must be `http://localhost:3001`. Restart backend after editing.

**Internal endpoints reject (`INVALID_SCHEDULER_KEY` / 401)**
- Cause: missing/incorrect `x-scheduler-key` header.
- Diagnose: send `x-scheduler-key: <SCHEDULER_SECRET>` on `/v1/internal/...` and `/v1/yield/recent-harvests`.

**Lock/unlock "missing account" or wrong-account error (not a clean 60xx)**
- Cause: client built the OLD account order. See Phase D1/D2 for the exact account orders (`lock_funds` = 9 keys, `unlock_funds` = 8 keys). A clean program error (60xx) means the program ran; a generic "missing account" means the instruction was malformed before it reached the program.

**Faucet doesn't fund / partial**
- Diagnose: `FAUCET_ENABLED=true`, cluster is devnet (mainnet → 403 `FAUCET_MAINNET_BLOCKED`), and the worker key (faucet source) has SOL + USDC. A partial result (USDC lands, SOL fails) is expected behavior, not an error.

---

### Key files (all absolute)
- Program binary: `/Users/marcus/Projects/locked-in/target/deploy/locked_in.so`
- Program keypair (gitignored — back up!): `/Users/marcus/Projects/locked-in/target/deploy/locked_in-keypair.json`
- Authoritative IDL: `/Users/marcus/Projects/locked-in/target/idl/locked_in.json`
- `declare_id!` line: `/Users/marcus/Projects/locked-in/programs/locked_in/src/lib.rs:39`
- Anchor config (`cluster = "Localnet"` — override on `anchor deploy`): `/Users/marcus/Projects/locked-in/Anchor.toml`
- Init scripts: `/Users/marcus/Projects/locked-in/scripts/init-lock-vault-protocol.mjs`, `/Users/marcus/Projects/locked-in/scripts/init-community-pot-protocol.mjs`
- Backend: `/Users/marcus/Projects/locked-in/backend` (`npm run dev`, `npm run test:db:up`)
- Web-app: `/Users/marcus/Projects/locked-in/web-app` (`npm run dev`)

### Vault error-code reference (from the IDL)
`InvalidLockDuration` · `NumericalOverflow` · `InvalidMintConfig` · `InvalidPrincipalAmount` · `UnsupportedStableMint` · `InvalidTokenAccountOwner` · `InvalidTokenAccountMint` · `InvalidLockOwner` · `LockStillActive` · `LockAlreadyClosed` · `UnexpectedStableVaultBalance` · `InvalidMint`. Numbers are intentionally omitted — Anchor error codes shift when variants are added/removed, so check the current IDL for exact values.

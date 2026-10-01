# Locked In agent harness

## Production truth

Locked In is live on Solana mainnet. Do not infer runtime configuration from
old narrative documents. Start with `docs/launch/MAINNET_SOURCE_OF_TRUTH.md`,
then verify anything operational against the deployed app and API.

- Web: `https://www.lockedin.quest`
- API: `https://locked-in-backend-oetf.onrender.com`
- Vault v2 program: `FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6`
- Mainnet USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Production yield profile: `kamino_usdc_mainnet`

`README.md` and `HANDOFF.md` describe the current deployment. The numbered
specs under `docs/` (00 to 10), `CLAUDE.md`, and older plans contain historical
devnet material. A contradiction with the source-of-truth file is a
stale-doc bug, not evidence that production returned to devnet.

## Money-moving boundary

- Health checks and launch gates must be read-only by default.
- Never run a deposit, claim, unlock, transfer, faucet, funding, migration,
  reset, or deploy command as a smoke test.
- Never use `backend/scripts/prod-v2-smoke.mjs` as a production canary. Despite
  its name it performs funded devnet transactions.
- Run `backend/scripts/mainnet-preflight-check.mjs` only with explicitly chosen
  filled env files. It is read-only, but it connects to production systems.
- Never print, commit, or move private keys, API secrets, database URLs, or
  filled environment files.

## Working loop

1. Read this file and the closest nested `AGENTS.md` (notably
   `web-app/AGENTS.md`).
2. Search for an existing helper before adding code.
3. Make a focused branch and small coherent commits.
4. Run `powershell -File scripts/launch-check.ps1` for local checks.
5. Add `-Live` for the read-only mainnet canary.
6. For an actual release, run the gstack review/QA workflow and verify the
   deployed URLs twice after the deployment is ready.

## Required launch gates

- Web lint, TypeScript, Vitest, and production build are green.
- Backend syntax and portable unit tests are green. Database migration tests
  run in CI or against an explicitly provisioned local Postgres instance.
- Rust tests are green in CI (and locally when the toolchain is installed).
- `node scripts/live-mainnet-canary.mjs` passes without making any writes.
- Security advisories are triaged. Do not describe an unreviewed dependency
  tree as secure, and do not claim an advisory is exploitable without a repro.
- Legal pages remain visibly marked draft until counsel approves them.

## Product and copy constraints

Lead with: **Stop collecting courses. Finish one.**

The public promise is a commitment device, not an investment product. Never
say "guaranteed", "risk free", "every cent back", or "learn-to-earn". Keep the
mainnet capped-beta and unaudited-software disclosure near acquisition CTAs.

## gstack operating rules

- Complete the implementation, tests, edge cases, and error paths unless a
  shortcut is explicitly recorded.
- Search before building. Prefer, in order: an existing repo helper, the
  standard library, a native platform feature, then an installed dependency.
- Recommendations do not override user decisions.
- Communicate directly: name the file, command, and user-visible effect.

The installed gstack suite is pinned outside the repo. Regenerate this section
when gstack is upgraded rather than silently changing its operating rules.

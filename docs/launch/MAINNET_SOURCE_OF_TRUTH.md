# Mainnet source of truth

Last verified: 2026-09-20 (Asia/Kuala_Lumpur).

This is the first document to consult for the currently deployed product.
Older Markdown may describe historical devnet architecture and launch blockers.
The machine-readable companion used by launch tooling is
[`config/mainnet-production.json`](../../config/mainnet-production.json).
Its `buildRpcUrl` and `buildWsUrl` fields are non-secret build-check endpoints,
not claims about Vercel's browser-restricted production RPC provider.

## Live topology

| Surface | Current value |
| --- | --- |
| Public web app | `https://www.lockedin.quest` |
| Production API | `https://locked-in-backend-oetf.onrender.com` |
| Solana cluster | `mainnet-beta` |
| Vault v2 program | `FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6` |
| USDC mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Beta lock range | `$10-$50 USDC` |
| Aggregate live TVL cap | `$1,000 USDC` |
| Yield profile | `kamino_usdc_mainnet` |
| Main branch | `master` |

The deployed frontend bundle, the public API, the Vercel production deployment,
and on-chain reads are runtime evidence. Update this file when any value changes.

## Safe verification

Run the complete local gate:

```powershell
powershell -File scripts/launch-check.ps1
```

Include the read-only deployed canary:

```powershell
powershell -File scripts/launch-check.ps1 -Live
```

Run only the deployed canary:

```powershell
node scripts/live-mainnet-canary.mjs
```

The canary makes GET/HEAD requests only. It does not authenticate, create a
transaction, submit a signature, migrate data, or move funds.

For environment, database, and on-chain configuration checks, use the existing
read-only preflight with explicitly selected filled env files:

```powershell
node backend/scripts/mainnet-preflight-check.mjs `
  --backend-env scripts/deploy/env.mainnet.backend.filled `
  --frontend-env scripts/deploy/env.mainnet.frontend.filled
```

Filled env files are local secrets and must never be committed.

## Known constraints

- Mainnet beta copy must disclose variable yield, the aggregate cap, unaudited
  software, and smart-contract/Kamino/USDC/Solana risks.
- Founding 100 describes the first member cohort. It does not promise 100
  simultaneous deposits; joining does not reserve space under the live TVL cap.
- Legal pages are drafts pending qualified review.
- No launch check should call `backend/scripts/prod-v2-smoke.mjs`; that script
  performs funded devnet transactions despite its historical name.
- A Vercel deployment marked Ready is not proof that the intended content is
  live. Run the canary after deployment and again after a fresh request.

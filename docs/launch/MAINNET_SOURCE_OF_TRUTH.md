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

## Public launch surface

The signed-out acquisition and trust surface consists of `/village`,
`/courses`, `/arena`, `/risk`, `/terms`, `/privacy`, and `/support`. Search and
sharing metadata are served from `/robots.txt`, `/sitemap.xml`,
`/manifest.webmanifest`, and `/opengraph-image`.

`GET /api/runtime-config` exposes only non-secret build values already present
in the browser bundle: `cluster`, `vaultV2ProgramId`, `usdcMint`,
`globalTvlCapUsdc`, and `buildRevision`. The production canary uses this route
to detect a build made for the wrong cluster, program, mint, cap, or commit.
`NEXT_PUBLIC_GLOBAL_TVL_CAP_USDC` controls the displayed cap, and
`NEXT_PUBLIC_SITE_URL` controls canonical sitemap and robots URLs; the launch
gate injects both from `config/mainnet-production.json`.

Vercel Analytics records coarse page and Founding 100 CTA activity. URLs are
scrubbed of queries, fragments, invite codes, match IDs, lesson IDs, course IDs,
credentials, and malformed values before they are sent.

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

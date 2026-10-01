import { NextResponse } from 'next/server';
import { BETA_GLOBAL_TVL_CAP_USDC } from '@/lib/betaConfig';

// Public, non-secret values that are already embedded in the browser bundle.
// The production canary reads this route to verify the deployed frontend was
// built against the intended cluster, custody program, and mint.
export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json({
    cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? null,
    vaultV2ProgramId: process.env.NEXT_PUBLIC_VAULT_V2_PROGRAM_ID ?? null,
    usdcMint: process.env.NEXT_PUBLIC_LOCK_VAULT_USDC_MINT ?? null,
    globalTvlCapUsdc: BETA_GLOBAL_TVL_CAP_USDC,
    buildRevision:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.LOCKED_IN_BUILD_REVISION ??
      null,
  });
}

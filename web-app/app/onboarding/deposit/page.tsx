'use client';

import { CozyCard, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { CLUSTER } from '@/services/solana/connection';
import { hasVaultV2Config } from '@/services/solana/vaultV2';
import { DepositV2 } from './DepositV2';
import { LegacyDeposit } from './LegacyDeposit';

// Same world switch as the dashboard: a v2-configured environment can never
// build a v1 lock. Legacy tree is deleted post-launch, not edited here.
//
// Fail closed on mainnet: if the v2 config is missing/malformed there, do NOT
// silently drop to the devnet v1 LegacyDeposit — that would route real money
// through the wrong program. Show a config-error state instead (audit M6/L9).
export default function OnboardingDepositPage() {
  if (hasVaultV2Config()) return <DepositV2 />;
  if (CLUSTER === 'mainnet-beta') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <CozyCard className="max-w-md text-center" style={{ padding: 28 }}>
          <p className="font-pixel text-lg mb-2" style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}>
            Deposits temporarily unavailable
          </p>
          <p className="font-pixel-mono text-[12px]" style={{ color: COZY_TEXT, opacity: 0.8 }}>
            The vault configuration is missing. No funds have moved. Please try again shortly.
          </p>
        </CozyCard>
      </div>
    );
  }
  return <LegacyDeposit />;
}

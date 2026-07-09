'use client';

import { hasVaultV2Config } from '@/services/solana/vaultV2';
import { DepositV2 } from './DepositV2';
import { LegacyDeposit } from './LegacyDeposit';

// Same world switch as the dashboard: a v2-configured environment can never
// build a v1 lock. Legacy tree is deleted post-launch, not edited here.
export default function OnboardingDepositPage() {
  return hasVaultV2Config() ? <DepositV2 /> : <LegacyDeposit />;
}

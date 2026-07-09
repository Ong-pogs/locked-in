'use client';

import { hasVaultV2Config } from '@/services/solana/vaultV2';
import { DashboardV2 } from '@/components/v2/DashboardV2';
import { LegacyDashboard } from './LegacyDashboard';

// Deployment-level world switch (debate-ruled): when the v2 custody program is
// configured, the whole dashboard is the v2 position view; otherwise the
// legacy fuel/saver dashboard renders untouched. The legacy tree is deleted in
// the post-launch cleanup pass, not edited here.
export default function DashboardPage() {
  return hasVaultV2Config() ? <DashboardV2 /> : <LegacyDashboard />;
}

import { redirect } from 'next/navigation';

// Legacy inventory page — deleted in the v2 legacy-deletion phase 2
// (2026-07-10 ruling). Ichor/fuel/saver runtime state is gone from the
// backend, so this redirect is unconditional for all worlds — deliberately
// NOT gated on hasVaultV2Config. The route file stays so stale
// service-worker-cached clients get a redirect, not a broken page.
export default function InventoryPage() {
  redirect('/dashboard');
}

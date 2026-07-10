import { redirect } from 'next/navigation';

// Legacy shop page — deleted in the v2 legacy-deletion phase 2
// (2026-07-10 ruling). The backend no longer serves the shop/buy-saver
// endpoint in ANY environment, so this redirect is unconditional for all
// worlds — deliberately NOT gated on hasVaultV2Config. The route file stays
// so stale service-worker-cached clients get a redirect, not a broken page.
export default function ShopPage() {
  redirect('/dashboard');
}

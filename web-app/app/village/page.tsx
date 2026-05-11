import VillageScene from './VillageScene';

/**
 * /village — mask-based painted village hub (cozy variant).
 *
 * No auth guard while we iterate on the look-and-feel; the AppShell guard is
 * suppressed via PUBLIC_ROUTES. Add a lock guard here once the village
 * promotes to the post-lock landing.
 */
export default function VillagePage() {
  return <VillageScene />;
}

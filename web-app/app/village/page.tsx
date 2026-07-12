import VillageScene from './VillageScene';
import { MobileHub } from './MobileHub';

/**
 * /village — the hub.
 *
 * Desktop (≥768px): the mask-based painted village scene with building hotspots.
 * Mobile (<768px): a native vertical card menu (MobileHub) — a phone shouldn't
 * pan a 16:9 painting sideways. Both are rendered; CSS breakpoint toggles them.
 *
 * No auth guard while we iterate on the look-and-feel; the AppShell guard is
 * suppressed via PUBLIC_ROUTES.
 */
export default function VillagePage() {
  return (
    <>
      <div className="hidden md:block">
        <VillageScene />
      </div>
      <div className="md:hidden">
        <MobileHub />
      </div>
    </>
  );
}

import { preload } from 'react-dom';
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
  // The painting is the page's largest element on phone and desktop, but the
  // AppShell renders nothing until client stores hydrate, so the <img> is not
  // in the server HTML. This head hint starts the download right away instead
  // of after the JavaScript has run (Lighthouse "LCP load delay").
  preload('/images/village/village-painted.png', { as: 'image', fetchPriority: 'high' });

  return (
    <>
      <h1 className="sr-only">Stop collecting courses. Finish one.</h1>
      <div className="hidden md:block">
        <VillageScene />
      </div>
      <div className="md:hidden">
        <MobileHub />
      </div>
    </>
  );
}

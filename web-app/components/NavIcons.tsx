import { type ReactNode } from 'react';

/* Themed SVG icons — hand-crafted to match the dark fantasy aesthetic */

export function IconCourses({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8M8 11h5" />
    </svg>
  );
}

export function IconFlame({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.38-2.35 1-3.5.5.88 1.13 1.62 1.5 3z" />
    </svg>
  );
}

export function IconAlchemy({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6v5l4 9a2 2 0 0 1-1.8 2.8H6.8A2 2 0 0 1 5 17l4-9V3z" />
      <path d="M9 3h6" />
      <path d="M7 15h10" />
    </svg>
  );
}

export function IconRewards({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L9.1 8.6 2 9.3l5.3 4.6L5.8 21 12 17.3 18.2 21l-1.5-7.1L22 9.3l-7.1-.7z" />
    </svg>
  );
}

export function IconLeaderboard({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H2v12h4V9zM14 4h-4v17h4V4zM22 13h-4v8h4v-8z" />
    </svg>
  );
}

export function IconCommunity({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconStreaks({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.1 6.5H21l-5.6 4 2.1 6.5L12 15l-5.5 4 2.1-6.5L3 8.5h6.9z" />
      <path d="M12 8v4M12 15v1" />
    </svg>
  );
}

export function IconInventory({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10z" />
      <path d="M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
      <path d="M10 14h4" />
    </svg>
  );
}

export function IconProfile({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a5 5 0 0 1 5 5v1a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" />
      <path d="M19.5 22a7.5 7.5 0 0 0-15 0" />
    </svg>
  );
}

/** Navigation groups for desktop sidebar */
export type NavGroup = 'learn' | 'economy' | 'social';

/** All nav items with group (used by desktop sidebar) */
export const NAV_ITEMS: { href: string; label: string; icon: (props: { color: string; size?: number }) => ReactNode; group: NavGroup; isNew?: boolean }[] = [
  { href: '/courses', label: 'Courses', icon: IconCourses, group: 'learn' },
  { href: '/dashboard', label: 'Dashboard', icon: IconFlame, group: 'learn' },
  // Streaks folded into /dashboard. Sidebar/BottomNav are also disabled
  // app-wide (showChrome=false in AppShell) — kept here in case re-enabled.
  { href: '/alchemy', label: 'Alchemy', icon: IconAlchemy, group: 'economy' },
  { href: '/shop', label: 'Rewards', icon: IconRewards, group: 'economy' },
  { href: '/inventory', label: 'Inventory', icon: IconInventory, group: 'economy', isNew: true },
  { href: '/leaderboard', label: 'Leaderboard', icon: IconLeaderboard, group: 'social' },
  { href: '/community-pot', label: 'Community', icon: IconCommunity, group: 'social' },
  // Profile folded into /dashboard.
];

/** Primary 5 tabs for mobile bottom bar */
export const BOTTOM_NAV_ITEMS = [
  { href: '/courses', label: 'Courses', icon: IconCourses },
  { href: '/dashboard', label: 'Dashboard', icon: IconFlame },
  { href: '/alchemy', label: 'Alchemy', icon: IconAlchemy },
  { href: '/shop', label: 'Rewards', icon: IconRewards },
];

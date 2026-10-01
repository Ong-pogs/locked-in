// Public application pages must be accepted by both the edge proxy and the
// client flow guard. Keep proxy-only resources (`/`, the manifest) local to
// proxy.ts so this list represents routes that can actually render AppShell.
// Never add /menu: it is an internal design-QA index that exposes application
// routing and must remain behind the auth guard (robots.txt is not access control).
export const PUBLIC_APP_ROUTES: readonly string[] = [
  '/village',
  '/dashboard',
  '/courses',
  '/shop',
  '/alchemy',
  '/community-pot',
  '/inventory',
  '/leaderboard',
  '/terms',
  '/privacy',
  '/risk',
  '/support',
  '/arena',
];

import { NextRequest, NextResponse } from 'next/server';

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  '/',
  '/manifest.webmanifest',
  '/village',
  '/menu',
  '/lock-prototypes',
  '/dashboard',
  '/courses',
  '/shop',
  '/alchemy',
  '/community-pot',
  '/inventory',
  '/leaderboard',
];

// Auth guard — redirects unauthenticated users to landing page
// JWT is stored in localStorage (client-side), so proxy checks for
// a lightweight cookie flag set after wallet connection
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes and static assets
  if (
    PUBLIC_ROUTES.includes(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icons') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check for auth cookie (set client-side after wallet connect)
  const hasAuth = request.cookies.get('locked-in-auth');
  if (!hasAuth) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

import { NextRequest, NextResponse } from 'next/server';

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  '/',
  '/manifest.webmanifest',
  '/village',
  // '/menu' is an internal design-QA index (it links every production page
  // and documents internal routing) — deliberately NOT public.
  '/dashboard',
  '/courses',
  '/shop',
  '/alchemy',
  '/community-pot',
  '/inventory',
  '/leaderboard',
  // Legal surface must be reachable without auth — the deposit consent links to
  // it, and a user must be able to read what they agreed to after logging out.
  '/terms',
  '/privacy',
  '/risk',
];

// Auth guard — redirects unauthenticated users to landing page
// JWT is stored in localStorage (client-side), so proxy checks for
// a lightweight cookie flag set after wallet connection
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Root → village hub (handled at the edge so the / page never renders).
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/village', request.url));
  }

  // Allow public routes and static assets. The asset test matches a real file
  // EXTENSION, not merely "contains a dot": `pathname.includes('.')` let any
  // gated route be walked past the guard by appending one (/lessons/bw-1.x
  // rendered instead of redirecting), which is also how an anonymous visitor
  // could reach the lesson page's crash path.
  const isStaticAsset = /\.(?:js|mjs|css|map|json|webmanifest|txt|xml|ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|mp3|mp4|webm|wasm)$/i.test(
    pathname,
  );
  if (
    PUBLIC_ROUTES.includes(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icons') ||
    pathname.startsWith('/.well-known') ||
    isStaticAsset
  ) {
    return NextResponse.next();
  }

  // Check for auth cookie (set client-side after wallet connect)
  const hasAuth = request.cookies.get('locked-in-auth');
  if (!hasAuth) {
    return NextResponse.redirect(new URL('/village', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

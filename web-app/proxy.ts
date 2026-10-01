import { NextRequest, NextResponse } from 'next/server';
import { PUBLIC_APP_ROUTES } from '@/lib/publicRoutes';

// These resources are handled only at the edge. Rendered public pages live in
// the shared list used by the client flow guard as well.
const PROXY_PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/api/runtime-config',
  '/manifest.webmanifest',
  '/opengraph-image',
];

// Auth guard - redirects unauthenticated users to the village landing page.
// JWT is stored in localStorage (client-side), so proxy checks for a lightweight
// cookie flag set after wallet connection.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Root -> village hub (handled at the edge so the / page never renders).
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/village', request.url));
  }

  // Allow public routes and static assets. The asset test matches a real file
  // extension, not merely "contains a dot": pathname.includes('.') let any
  // gated route be walked past the guard by appending one.
  const isStaticAsset = /\.(?:js|mjs|css|map|json|webmanifest|txt|xml|ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|mp3|mp4|webm|wasm)$/i.test(
    pathname,
  );

  // An Arena invite is the growth loop: it is frequently the first page a
  // non-user opens, so it must render the challenge before asking them to sign
  // in. Use a prefix because invite routes contain a dynamic code.
  if (pathname.startsWith('/arena/join/')) {
    return NextResponse.next();
  }

  if (
    PROXY_PUBLIC_ROUTES.includes(pathname) ||
    PUBLIC_APP_ROUTES.includes(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icons') ||
    pathname.startsWith('/.well-known') ||
    isStaticAsset
  ) {
    return NextResponse.next();
  }

  const hasAuth = request.cookies.get('locked-in-auth');
  if (!hasAuth) {
    return NextResponse.redirect(new URL('/village', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Vercel Analytics posts without auth, so its ingestion routes must bypass the guard.
  matcher: ['/((?!_next/static|_next/image|_vercel|favicon.ico).*)'],
};

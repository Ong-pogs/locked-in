import { withSerwist } from '@serwist/turbopack';

export default withSerwist({
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    // Next 16.3 turned on Turbopack's file-system build cache by default, and
    // Vercel restores it between deploys. Twice (PR #11, PR #17) production
    // then shipped stale versions of rules edited in app/globals.css while
    // everything else in the same build was fresh. A cold Turbopack build is a
    // little slower but always matches the source.
    turbopackFileSystemCacheForBuild: false,
  },
  // Keep the dev-tools badge out of screenshots (visual e2e determinism).
  devIndicators: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
});

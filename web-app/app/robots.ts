import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/village', '/courses', '/arena', '/stats', '/risk', '/terms', '/privacy', '/support'],
      disallow: [
        '/api/',
        '/claim/',
        '/dashboard',
        '/lessons/',
        '/menu',
        '/onboarding/',
        '/practice',
      ],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/village', '/courses', '/arena', '/risk', '/terms', '/privacy', '/support'],
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
    sitemap: 'https://www.lockedin.quest/sitemap.xml',
    host: 'https://www.lockedin.quest',
  };
}

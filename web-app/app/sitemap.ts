import type { MetadataRoute } from 'next';

const routes = ['/village', '/courses', '/arena', '/risk', '/terms', '/privacy', '/support'];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date('2026-09-19T00:00:00.000Z');
  return routes.map((route) => ({
    url: `https://www.lockedin.quest${route}`,
    lastModified,
    changeFrequency: route === '/village' || route === '/courses' ? 'weekly' : 'monthly',
    priority: route === '/village' ? 1 : route === '/courses' ? 0.9 : 0.6,
  }));
}

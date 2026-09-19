import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/lib/site';

const routes = ['/village', '/courses', '/arena', '/risk', '/terms', '/privacy', '/support'];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${SITE_ORIGIN}${route}`,
    changeFrequency: route === '/village' || route === '/courses' ? 'weekly' : 'monthly',
    priority: route === '/village' ? 1 : route === '/courses' ? 0.9 : 0.6,
  }));
}

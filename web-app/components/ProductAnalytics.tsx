'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

const PRIVATE_PATHS: Array<[RegExp, string]> = [
  [/^\/arena\/join\/[^/]+/, '/arena/join/:code'],
  [
    /^\/arena\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/i,
    '/arena/:matchId',
  ],
  [/^\/lessons\/[^/]+/, '/lessons/:lessonId'],
  [/^\/claim\/[^/]+/, '/claim/:courseId'],
];

/**
 * Scrub identifiers from the page URL handled by Vercel's beforeSend hook.
 * Custom event properties are separate from this hook and must remain limited
 * to fixed, non-user values such as CTA placement.
 */
export function scrubAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url, 'https://www.lockedin.quest');
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    for (const [pattern, replacement] of PRIVATE_PATHS) {
      if (pattern.test(url.pathname)) {
        url.pathname = url.pathname.replace(pattern, replacement);
        break;
      }
    }
    return { ...event, url: url.toString() };
  } catch {
    // Malformed URLs are dropped rather than risking accidental disclosure.
    return null;
  }
}

export function ProductAnalytics() {
  return <Analytics beforeSend={scrubAnalyticsEvent} />;
}

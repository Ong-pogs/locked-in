'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

const PRIVATE_PATHS: Array<[RegExp, string]> = [
  [/^\/arena\/join\/[^/]+/, '/arena/join/:code'],
  [/^\/arena\/[^/]+/, '/arena/:matchId'],
  [/^\/lessons\/[^/]+/, '/lessons/:lessonId'],
  [/^\/claim\/[^/]+/, '/claim/:courseId'],
];

/**
 * Keep acquisition analytics useful without collecting app identifiers.
 * Vercel receives the route shape, never query values, invite codes, match IDs,
 * lesson IDs, course IDs, wallet addresses, or fragments.
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

import { describe, expect, it } from 'vitest';
import { scrubAnalyticsEvent } from '@/components/ProductAnalytics';

describe('scrubAnalyticsEvent', () => {
  it('removes query data and dynamic route identifiers', () => {
    expect(
      scrubAnalyticsEvent({
        type: 'pageview',
        url: 'https://www.lockedin.quest/arena/join/secret-code?wallet=abc#fragment',
      }),
    ).toEqual({
      type: 'pageview',
      url: 'https://www.lockedin.quest/arena/join/:code',
    });

    expect(
      scrubAnalyticsEvent({
        type: 'pageview',
        url: 'https://www.lockedin.quest/lessons/private-lesson-id?courseId=secret',
      }),
    ).toEqual({
      type: 'pageview',
      url: 'https://www.lockedin.quest/lessons/:lessonId',
    });
  });

  it('drops malformed URLs', () => {
    expect(scrubAnalyticsEvent({ type: 'event', url: 'https://%' })).toBeNull();
  });

  it('scrubs UUID match IDs without collapsing named Arena pages', () => {
    expect(
      scrubAnalyticsEvent({
        type: 'pageview',
        url: 'https://www.lockedin.quest/arena/123e4567-e89b-12d3-a456-426614174000',
      })?.url,
    ).toBe('https://www.lockedin.quest/arena/:matchId');
    expect(
      scrubAnalyticsEvent({
        type: 'pageview',
        url: 'https://www.lockedin.quest/arena/leaderboard',
      })?.url,
    ).toBe('https://www.lockedin.quest/arena/leaderboard');
  });
});

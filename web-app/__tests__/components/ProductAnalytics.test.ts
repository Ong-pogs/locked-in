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
});

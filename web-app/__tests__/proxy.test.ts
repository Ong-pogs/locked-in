import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { config, proxy } from '../proxy';
import { PUBLIC_APP_ROUTES } from '@/lib/publicRoutes';

describe('auth proxy matcher', () => {
  it('bypasses Vercel Analytics while keeping protected pages covered', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test('/_vercel/insights/view')).toBe(false);
    expect(matcher.test('/dashboard')).toBe(true);
  });
});

describe('auth proxy public metadata routes', () => {
  it('lets the canary read public runtime configuration without auth', () => {
    const response = proxy(
      new NextRequest('https://www.lockedin.quest/api/runtime-config'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('lets social crawlers fetch the Open Graph image without auth', () => {
    const response = proxy(
      new NextRequest('https://www.lockedin.quest/opengraph-image'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('auth proxy routing matrix', () => {
  it('redirects the root to the public village entrypoint', () => {
    const response = proxy(new NextRequest('https://www.lockedin.quest/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://www.lockedin.quest/village');
  });

  it.each(PUBLIC_APP_ROUTES)('keeps %s public without an auth cookie', (pathname) => {
    const response = proxy(new NextRequest(`https://www.lockedin.quest${pathname}`));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('allows dynamic Arena invites and real static assets without auth', () => {
    for (const pathname of ['/arena/join/ABCD2345', '/images/logo.png']) {
      const response = proxy(new NextRequest(`https://www.lockedin.quest${pathname}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    }
  });

  it('does not let a dot appended to a protected route bypass auth', () => {
    const response = proxy(
      new NextRequest('https://www.lockedin.quest/onboarding/private.fake-segment'),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://www.lockedin.quest/village');
  });

  it('allows a protected route only when the auth marker cookie is present', () => {
    const response = proxy(
      new NextRequest('https://www.lockedin.quest/onboarding/tutorial', {
        headers: { cookie: 'locked-in-auth=1' },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { proxy } from '../proxy';

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

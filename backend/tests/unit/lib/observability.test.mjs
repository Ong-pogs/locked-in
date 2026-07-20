import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureError, isErrorReportingEnabled } from '../../../src/lib/observability.mjs';

const DSN = 'https://collector.example/ingest/abc';

describe('observability', () => {
  let fetchMock;
  const originalDsn = process.env.ERROR_REPORTING_DSN;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalDsn === undefined) delete process.env.ERROR_REPORTING_DSN;
    else process.env.ERROR_REPORTING_DSN = originalDsn;
  });

  it('is inert when ERROR_REPORTING_DSN is unset', async () => {
    delete process.env.ERROR_REPORTING_DSN;

    expect(isErrorReportingEnabled()).toBe(false);
    await captureError(new Error('voucher signing failed'), { scope: 'voucher.issue' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts scope, error shape and context once a DSN is configured', async () => {
    process.env.ERROR_REPORTING_DSN = DSN;

    await captureError(new Error('voucher signing failed'), {
      scope: 'voucher.issue',
      context: { wallet: 'Wa11et', courseId: 'defi' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DSN);
    const payload = JSON.parse(init.body);
    expect(payload.service).toBe('backend');
    expect(payload.scope).toBe('voucher.issue');
    expect(payload.error.message).toBe('voucher signing failed');
    expect(payload.context).toMatchObject({ wallet: 'Wa11et', courseId: 'defi' });
  });

  it('redacts secret-looking context keys instead of shipping them', async () => {
    process.env.ERROR_REPORTING_DSN = DSN;

    await captureError(new Error('nope'), {
      scope: 'voucher.issue',
      context: { authoritySecretKey: 'base58...', courseId: 'defi' },
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.context.authoritySecretKey).toBe('[redacted]');
    expect(payload.context.courseId).toBe('defi');
  });

  it('never rethrows when the transport fails', async () => {
    process.env.ERROR_REPORTING_DSN = DSN;
    fetchMock.mockRejectedValue(new Error('collector down'));

    await expect(captureError(new Error('nope'), { scope: 'voucher.issue' })).resolves.toBeUndefined();
  });
});

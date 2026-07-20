import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureError, isErrorReportingEnabled } from '@/services/observability';

const DSN = 'https://collector.example/ingest/abc';

describe('observability reporter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('is inert when no DSN is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_ERROR_REPORTING_DSN', '');

    expect(isErrorReportingEnabled()).toBe(false);
    await captureError(new Error('claim blew up'), { scope: 'claim.submit' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts scope, error shape and context once a DSN is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_ERROR_REPORTING_DSN', DSN);

    await captureError(new Error('claim blew up'), {
      scope: 'claim.submit',
      context: { courseId: 'defi', wallet: 'Wa11et', phase: 'sending' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DSN);
    const payload = JSON.parse(String(init.body));
    expect(payload.scope).toBe('claim.submit');
    expect(payload.error.name).toBe('Error');
    expect(payload.error.message).toBe('claim blew up');
    expect(payload.context).toMatchObject({ courseId: 'defi', wallet: 'Wa11et', phase: 'sending' });
  });

  it('redacts secret-looking context keys instead of shipping them', async () => {
    vi.stubEnv('NEXT_PUBLIC_ERROR_REPORTING_DSN', DSN);

    await captureError(new Error('nope'), {
      scope: 'claim.submit',
      context: { authToken: 'ey.jwt.value', privateKey: 'deadbeef', courseId: 'defi' },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.context.authToken).toBe('[redacted]');
    expect(payload.context.privateKey).toBe('[redacted]');
    expect(payload.context.courseId).toBe('defi');
  });

  it('never rethrows when the transport fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_ERROR_REPORTING_DSN', DSN);
    fetchMock.mockRejectedValue(new Error('collector down'));

    await expect(captureError(new Error('nope'), { scope: 'claim.submit' })).resolves.toBeUndefined();
  });

  it('reports non-Error throws without losing the value', async () => {
    vi.stubEnv('NEXT_PUBLIC_ERROR_REPORTING_DSN', DSN);

    await captureError('string failure', { scope: 'claim.submit' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.error.message).toBe('string failure');
  });
});

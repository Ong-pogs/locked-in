import { describe, it, expect, vi, beforeEach } from 'vitest';

const httpRequest = vi.fn();
vi.mock('@/services/api/httpClient', () => ({
  httpRequest: (...a: unknown[]) => httpRequest(...a),
}));

import { requestGasStipend } from '@/services/onramp/gasStipend';

describe('requestGasStipend', () => {
  beforeEach(() => httpRequest.mockReset());

  it('POSTs the stipend path with the bearer token', async () => {
    httpRequest.mockResolvedValue({ status: 'dripped' });
    await expect(requestGasStipend('tok-123')).resolves.toEqual({ status: 'dripped' });
    expect(httpRequest).toHaveBeenCalledWith('/v1/wallet/gas-stipend', {
      method: 'POST',
      token: 'tok-123',
    });
  });
});

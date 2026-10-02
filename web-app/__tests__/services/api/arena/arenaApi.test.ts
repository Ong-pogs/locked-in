import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/api/httpClient', () => ({
  httpRequest: vi.fn(),
}));

import { httpRequest } from '@/services/api/httpClient';
import { getLadder } from '@/services/api/arena/arenaApi';

describe('arenaApi.getLadder', () => {
  beforeEach(() => {
    vi.mocked(httpRequest).mockReset();
  });

  it('calls the public ladder without auth when signed out', async () => {
    vi.mocked(httpRequest).mockResolvedValueOnce([]);

    await getLadder();

    expect(httpRequest).toHaveBeenCalledWith('/v1/arena/ladder?limit=100', {});
  });

  it('sends the token when signed in, so the server can flag the viewer row', async () => {
    const rows = [{ walletLabel: '7Vt9…GDL6', isMe: true, rating: 1250, games: 3, wins: 2, losses: 1, draws: 0, rank: 1 }];
    vi.mocked(httpRequest).mockResolvedValueOnce(rows);

    const result = await getLadder(100, 'auth-token');

    expect(httpRequest).toHaveBeenCalledWith('/v1/arena/ladder?limit=100', { token: 'auth-token' });
    // The server-made label passes through untouched; no full address is involved.
    expect(result).toEqual(rows);
  });
});

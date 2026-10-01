import { useEffect, useState } from 'react';
import { getLessonApiBaseUrl } from '@/services/api/config';

export interface YieldApyResponse {
  apyBps: number | null;
  apyPct: number | null;
  source: string;
  fetchedAt: string | null;
  live: boolean;
}

/**
 * Polls the backend's /v1/yield/current-apy endpoint every 60s.
 * Lifted out of LiveApyChip so one poller can feed both the chip and the
 * PositionCard yield ticker. No auth required (rate-limited per IP server-side).
 */
export function useCurrentApy(): { data: YieldApyResponse | null; hadError: boolean } {
  const [data, setData] = useState<YieldApyResponse | null>(null);
  const [hadError, setHadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchApy = async () => {
      try {
        const baseUrl = getLessonApiBaseUrl();
        if (!baseUrl) return;
        const resp = await fetch(`${baseUrl}/v1/yield/current-apy`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as YieldApyResponse;
        if (!cancelled) {
          setData(json);
          setHadError(false);
        }
      } catch {
        if (!cancelled) setHadError(true);
      }
    };

    void fetchApy();
    const interval = setInterval(fetchApy, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { data, hadError };
}

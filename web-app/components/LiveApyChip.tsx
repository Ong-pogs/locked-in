'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { CozyCard } from '@/components/cozy';
import { T } from '@/components/theme';
import { getLessonApiBaseUrl } from '@/services/api/config';

const AMBER = '#FFD580';
const TEAL = '#2AE8D4';
const TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.85)';

interface YieldApyResponse {
  apyBps: number | null;
  apyPct: number | null;
  source: string;
  fetchedAt: string | null;
  live: boolean;
}

/**
 * Polls the backend's /v1/yield/current-apy endpoint and renders a small
 * status pill. Refreshes every 60s. When the backend is running on the
 * kamino_klend_reserve_v1 strategy, "live" is true and we surface the real
 * Kamino USDC reserve APY. Otherwise we show the fixed-APY simulation tag.
 *
 * No auth required — the endpoint is rate-limited per IP server-side.
 */
export function LiveApyChip() {
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

  if (hadError && !data) return null;
  if (!data || data.apyPct == null) return null;

  const accent = data.live ? TEAL : AMBER;
  const sourceLabel =
    data.source === 'kamino_klend_usdc'
      ? 'Kamino USDC reserve · mainnet'
      : data.source === 'fixed_apy'
        ? 'Simulated APY · devnet'
        : data.source;

  return (
    <CozyCard className="flex items-center gap-3" style={{ padding: 14 }}>
      <div
        className="flex items-center justify-center rounded-full shrink-0"
        style={{
          width: 36,
          height: 36,
          backgroundColor: `${accent}22`,
          border: `1px solid ${accent}55`,
        }}
      >
        <Activity size={16} color={accent} strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className="font-pixel-mono text-[10px] uppercase tracking-[1.5px] flex items-center gap-1.5"
          style={{ color: AMBER, opacity: 0.75, textShadow: TEXT_SHADOW }}
        >
          {data.live ? (
            <>
              <span
                className="inline-block rounded-full"
                style={{
                  width: 6,
                  height: 6,
                  backgroundColor: accent,
                  boxShadow: `0 0 6px ${accent}`,
                }}
              />
              Live yield rate
            </>
          ) : (
            <>Yield rate</>
          )}
        </p>
        <p
          className="text-[22px] font-bold mt-0.5 font-pixel-mono"
          style={{ color: accent, textShadow: TEXT_SHADOW }}
        >
          {data.apyPct.toFixed(2)}%
        </p>
        <p
          className="font-pixel-mono text-[9px] mt-0.5 truncate"
          style={{ color: T.textMuted }}
        >
          {sourceLabel}
        </p>
      </div>
    </CozyCard>
  );
}

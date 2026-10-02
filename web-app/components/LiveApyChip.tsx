'use client';

import { Activity } from 'lucide-react';
import { CozyCard } from '@/components/cozy';
import { T } from '@/components/theme';
import type { YieldApyResponse } from '@/hooks/useCurrentApy';
import { CLUSTER } from '@/services/solana/connection';

const AMBER = '#FFD580';
const TEAL = '#2AE8D4';
const TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.85)';

/**
 * Renders a small status pill from the polled /v1/yield/current-apy data
 * (fetched once by useCurrentApy and passed in). When the backend is running on
 * the kamino_klend_reserve_v1 strategy, "live" is true and we surface the real
 * Kamino USDC reserve APY. Otherwise we show the fixed-APY simulation tag.
 */
export function LiveApyChip({
  data,
  hadError,
}: {
  data: YieldApyResponse | null;
  hadError: boolean;
}) {
  if (hadError && !data) return null;
  if (!data || data.apyPct == null) return null;

  const accent = data.live ? TEAL : AMBER;
  // The cluster suffix must reflect the ACTUAL cluster, not be inferred from
  // the backend source string — e.g. the devnet-demo profile reads the real
  // mainnet Kamino rate but custody is on devnet, so labelling it "· mainnet"
  // would mislead (audit M2).
  const clusterSuffix =
    CLUSTER === 'mainnet-beta' ? 'mainnet' : CLUSTER === 'testnet' ? 'testnet' : 'devnet';
  const sourceDesc =
    data.source === 'kamino_klend_usdc'
      ? 'Kamino USDC reserve'
      : data.source === 'fixed_apy'
        ? 'Simulated APY'
        : data.source;
  const sourceLabel = `${sourceDesc} · ${clusterSuffix}`;
  // Real-money product: a bare headline % reads as a promise. Kamino's rate
  // floats with market supply/demand, so both branches carry an explicit
  // qualifier without framing the displayed rate as a promise.
  const qualifier = data.live ? 'Variable rate · can change' : 'Simulated estimate · can change';

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
        {/* 9px labels on glass: textMutedStrong + shadow (0.45 alpha was unreadable). */}
        <p
          className="font-pixel-mono text-[9px] mt-0.5 truncate"
          style={{ color: T.textMutedStrong, textShadow: TEXT_SHADOW }}
        >
          {sourceLabel}
        </p>
        <p
          className="font-pixel-mono text-[9px] mt-px truncate"
          style={{ color: T.textMutedStrong, textShadow: TEXT_SHADOW }}
        >
          {qualifier}
        </p>
      </div>
    </CozyCard>
  );
}

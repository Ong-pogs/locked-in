'use client';

import { useRouter } from 'next/navigation';
import { CozyCard, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { T } from '@/components/theme';
import type { ClaimSuccessRecord } from '@/services/claim/claimReceipt';

// Claimed/closed position card (dashboard "Claimed" tab). Deliberately quiet:
// no flame, shields, streak, progress, or penalty banner — the position is
// settled, none of that state applies anymore. Shows the claim receipt when
// this session has one, and the practice affordance the course keeps forever.

const GREEN = '#3EE68A';

export function ClosedPositionCard({
  courseId,
  title,
  receipt,
}: {
  courseId: string;
  title: string;
  receipt: ClaimSuccessRecord | null;
}) {
  const router = useRouter();
  return (
    <CozyCard
      data-testid="v2-closed-card"
      data-course-id={courseId}
      className="w-full"
      style={{ padding: 16 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            className="font-pixel text-lg leading-tight truncate"
            style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
          >
            {title}
          </h3>
          {receipt?.receivedUi ? (
            <p className="font-pixel-mono text-[12px] mt-1.5" style={{ color: T.textMutedStrong }}>
              Paid out <span style={{ color: GREEN }}>${receipt.receivedUi}</span> to your wallet
              {receipt.claimedAt
                ? ` · ${new Date(receipt.claimedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}`
                : ''}
            </p>
          ) : (
            <p className="font-pixel-mono text-[12px] mt-1.5" style={{ color: T.textMutedStrong }}>
              Principal + yield returned to your wallet.
            </p>
          )}
        </div>
        <span
          data-testid="v2-claimed-chip"
          className="shrink-0 px-2.5 py-1 rounded-md border font-pixel-mono text-[10px] uppercase tracking-[1.5px] font-bold"
          style={{
            backgroundColor: 'rgba(62,230,138,0.12)',
            borderColor: 'rgba(62,230,138,0.45)',
            color: GREEN,
            textShadow: COZY_TEXT_SHADOW,
          }}
        >
          ✓ Claimed
        </span>
      </div>

      {receipt?.signature && (
        <p
          className="font-pixel-mono text-[10px] mt-2 truncate"
          style={{ color: T.textMuted }}
          title={receipt.signature}
        >
          tx: {receipt.signature}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <span
          className="flex-1 py-2 rounded-lg border text-center font-pixel-mono text-[11px] uppercase tracking-[1.5px]"
          style={{
            backgroundColor: 'rgba(153,69,255,0.10)',
            borderColor: 'rgba(153,69,255,0.4)',
            color: '#B98AFF',
          }}
        >
          Course complete
        </span>
        <button
          data-testid="v2-closed-practice-cta"
          onClick={() => router.push('/practice')}
          className="flex-1 py-2 rounded-lg border font-pixel-mono text-[11px] uppercase tracking-[1.5px] min-h-[36px] cursor-pointer"
          style={{
            backgroundColor: 'rgba(255,213,128,0.10)',
            borderColor: 'rgba(255,213,128,0.4)',
            color: COZY_TEXT,
          }}
        >
          Practice
        </button>
      </div>
    </CozyCard>
  );
}

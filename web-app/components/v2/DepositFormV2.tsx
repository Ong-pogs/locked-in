'use client';

import { useMemo, useState } from 'react';
import { CozyCard, CozySectionLabel, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { T } from '@/components/theme';
import type { V2ActionPhase } from '@/services/solana/v2Actions';

// v2 deposit (spec §5): $10–50, NO duration picker — the lock releases on
// course completion, not on a timer. Capacity meter shows the beta TVL cap.

const MIN_UI = 10;
const MAX_UI = 50;
const GLOBAL_CAP_UI = 1_000;
const PRESETS = [10, 25, 50];

interface Props {
  courseTitle: string;
  currentTvlUi: number; // for the capacity meter
  walletBalanceUi: string | null;
  phase: V2ActionPhase | 'idle';
  statusMessage: string | null;
  onSubmit: (amountUi: string) => void;
}

const PHASE_COPY: Record<V2ActionPhase, string> = {
  building: 'Building transaction…',
  'awaiting-signature': 'Waiting for wallet approval…',
  sending: 'Sending transaction…',
  confirming: 'Confirming on-chain…',
  success: 'Locked in!',
  error: 'Transaction failed',
};

export function DepositFormV2({
  courseTitle,
  currentTvlUi,
  walletBalanceUi,
  phase,
  statusMessage,
  onSubmit,
}: Props) {
  const [amount, setAmount] = useState('25');
  const busy = phase !== 'idle' && phase !== 'error' && phase !== 'success';

  const numericAmount = Number(amount);
  const validationError = useMemo(() => {
    const trimmed = amount.trim();
    if (!trimmed || !Number.isFinite(numericAmount)) return 'Enter an amount';
    // Reject what executeDeposit's parser rejects, up front (not after submit):
    // plain decimal only, at most 6 fraction digits (USDC), no scientific notation.
    if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return 'Use up to 6 decimal places';
    if (numericAmount < MIN_UI) return `Minimum is $${MIN_UI}`;
    if (numericAmount > MAX_UI) return `Maximum is $${MAX_UI} during beta`;
    if (walletBalanceUi != null && numericAmount > Number(walletBalanceUi)) {
      return `You have $${walletBalanceUi} USDC`;
    }
    return null;
  }, [amount, numericAmount, walletBalanceUi]);

  const capacityPct = Math.min(100, (currentTvlUi / GLOBAL_CAP_UI) * 100);

  return (
    <CozyCard data-testid="v2-deposit-form" className="w-full" style={{ padding: 20 }}>
      <CozySectionLabel>Lock your stake</CozySectionLabel>
      <p
        className="font-pixel-mono text-[12px] mb-2"
        style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
      >
        Lock USDC on <span style={{ color: COZY_TEXT }}>{courseTitle}</span>. It earns yield while
        you learn and returns — principal plus your yield — when you finish the course.
      </p>
      {/* Penalty disclosure BEFORE the user commits funds — the claim/dashboard
          surfaces show it too, but consent belongs at the deposit. */}
      <p className="font-pixel-mono text-[11px] mb-4" style={{ color: '#F0A878' }}>
        Your principal is always returned. But go dark after your shields are spent and you forfeit
        yield: 50% on the first lapse, 100% on the second (it goes to the community pot).
      </p>

      {/* Amount input + presets. No duration control: completion releases the lock. */}
      <div className="flex gap-2 mb-3">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            disabled={busy}
            onClick={() => setAmount(String(preset))}
            className="flex-1 py-2.5 rounded-lg border font-pixel-mono text-[13px] min-h-[44px]"
            style={{
              backgroundColor:
                amount === String(preset) ? 'rgba(255,213,128,0.18)' : 'rgba(255,255,255,0.04)',
              borderColor:
                amount === String(preset) ? 'rgba(255,213,128,0.6)' : T.borderDormant,
              color: COZY_TEXT,
              textShadow: COZY_TEXT_SHADOW,
            }}
          >
            ${preset}
          </button>
        ))}
      </div>
      <div className="relative mb-1">
        <span
          className="absolute left-3 top-1/2 -translate-y-1/2 font-pixel-mono text-sm"
          style={{ color: T.textMuted }}
        >
          $
        </span>
        <input
          data-testid="v2-deposit-amount"
          type="number"
          inputMode="decimal"
          min={MIN_UI}
          max={MAX_UI}
          value={amount}
          disabled={busy}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full py-3 pl-7 pr-3 rounded-lg border font-pixel-mono text-base min-h-[44px]"
          style={{
            backgroundColor: 'rgba(14,14,28,0.6)',
            borderColor: validationError ? 'rgba(255,68,102,0.5)' : T.borderDormant,
            color: COZY_TEXT,
            outline: 'none',
          }}
          aria-label="Deposit amount in USDC"
        />
      </div>
      <p
        className="font-pixel-mono text-[10px] mb-3"
        style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
      >
        ${MIN_UI}–${MAX_UI} during beta{walletBalanceUi != null ? ` · balance $${walletBalanceUi}` : ''}
      </p>

      {/* Capacity meter */}
      <div data-testid="v2-capacity-meter" className="mb-4">
        <div className="flex justify-between mb-1">
          <span
            className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
            style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
          >
            Beta capacity
          </span>
          <span className="font-pixel-mono text-[10px]" style={{ color: COZY_TEXT, opacity: 0.8 }}>
            ${currentTvlUi.toLocaleString()} / ${GLOBAL_CAP_UI.toLocaleString()} locked
          </span>
        </div>
        <div className="h-1.5 rounded-[3px] overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-full rounded-[3px]"
            style={{ width: `${capacityPct}%`, backgroundColor: '#2AE8D4' }}
          />
        </div>
      </div>

      {validationError && (
        <p
          data-testid="v2-deposit-error"
          className="font-pixel-mono text-[11px] mb-3"
          style={{ color: T.crimson }}
        >
          {validationError}
        </p>
      )}

      {busy && (
        <p
          data-testid="v2-deposit-status"
          className="font-pixel-mono text-[11px] mb-3"
          style={{ color: COZY_TEXT, opacity: 0.85 }}
          role="status"
        >
          {statusMessage ?? PHASE_COPY[phase as V2ActionPhase]}
        </p>
      )}
      {phase === 'error' && statusMessage && (
        <p className="font-pixel-mono text-[11px] mb-3" style={{ color: T.crimson }} role="alert">
          {statusMessage}
        </p>
      )}

      <button
        data-testid="v2-deposit-submit"
        disabled={busy || Boolean(validationError)}
        onClick={() => onSubmit(amount)}
        className="w-full py-3.5 rounded-lg border font-pixel text-sm uppercase tracking-[2px] font-bold min-h-[44px]"
        style={{
          backgroundColor: busy || validationError ? 'rgba(255,213,128,0.06)' : 'rgba(255,213,128,0.16)',
          borderColor: 'rgba(255,213,128,0.5)',
          color: COZY_TEXT,
          textShadow: COZY_TEXT_SHADOW,
          opacity: busy || validationError ? 0.5 : 1,
        }}
      >
        {busy ? 'Locking…' : `Lock $${amount || '—'} USDC`}
      </button>
    </CozyCard>
  );
}

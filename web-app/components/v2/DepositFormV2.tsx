'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { CozyCard, CozySectionLabel, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { T } from '@/components/theme';
import { fetchWithAuth } from '@/services/api';
import { httpRequest } from '@/services/api/httpClient';
import { readFundingBreadcrumb } from '@/services/onramp/fundingBreadcrumb';
import type { V2ActionPhase } from '@/services/solana/v2Actions';

// v2 deposit (spec §5): $10–50, NO duration picker — the lock releases on
// course completion, not on a timer. Capacity meter shows the beta TVL cap.

/** Bump when /terms, /privacy or /risk change materially — a stored acceptance
 *  of an older version stops counting and the user is asked again. */
export const TERMS_VERSION = '2026-07-20';
export const CONSENT_STORAGE_KEY = 'locked-in-terms-accepted';

// localStorage IS the consent state — subscribing to it rather than mirroring it
// into useState keeps the server snapshot honestly `false`, so the checkbox
// hydrates unchecked and never renders accepted on a device that never accepted.
const consentListeners = new Set<() => void>();

function subscribeToConsent(onChange: () => void): () => void {
  consentListeners.add(onChange);
  return () => {
    consentListeners.delete(onChange);
  };
}

function readConsent(): boolean {
  return localStorage.getItem(CONSENT_STORAGE_KEY) === TERMS_VERSION;
}

function writeConsent(accepted: boolean): void {
  if (accepted) localStorage.setItem(CONSENT_STORAGE_KEY, TERMS_VERSION);
  else localStorage.removeItem(CONSENT_STORAGE_KEY);
  consentListeners.forEach((listener) => listener());
}

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
  /** Fiat onramp: when provided, an "Add funds" CTA renders in the
   *  insufficient-USDC state with the computed shortfall. */
  onAddFunds?: (deficitUsdc: number) => void;
  /** True while the funding modal is open — disables the CTA. */
  fundingPending?: boolean;
  /** Post-funding status line ("funds can take a few minutes…") or a funding
   *  error, rendered under the CTA. */
  fundingNotice?: string | null;
  /** Manual re-read of the wallet balance while funds are settling. */
  onFundingRecheck?: () => void;
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
  onAddFunds,
  fundingPending = false,
  fundingNotice = null,
  onFundingRecheck,
}: Props) {
  const [amount, setAmount] = useState('25');
  // Double-charge gate: a fresh breadcrumb means a card purchase may still be
  // settling — require an explicit second tap before re-opening the modal.
  const [confirmRebuy, setConfirmRebuy] = useState(false);
  const accepted = useSyncExternalStore(subscribeToConsent, readConsent, () => false);
  const busy = phase !== 'idle' && phase !== 'error' && phase !== 'success';

  const handleAccept = (next: boolean) => {
    writeConsent(next);
    if (!next) return;
    // Fire-and-forget: the local record is what gates the button, so a failed
    // report must never stand between the user and their own deposit.
    try {
      void fetchWithAuth((token) =>
        httpRequest('/v1/locks/consent', {
          method: 'POST',
          body: { termsVersion: TERMS_VERSION, acceptedAt: new Date().toISOString() },
          token,
        }),
      ).catch(() => {});
    } catch {
      // Synchronous throw (e.g. no session yet) — same treatment.
    }
  };

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

  // Fiat-onramp shortfall. Non-null ONLY when: the amount itself is valid
  // (format + $10-50 bounds), the balance is KNOWN (null = RPC unknown —
  // never offer a card purchase off an unknown balance), and it falls short.
  const usdcDeficit = useMemo(() => {
    if (!onAddFunds) return null;
    const trimmed = amount.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
    if (!Number.isFinite(numericAmount) || numericAmount < MIN_UI || numericAmount > MAX_UI) {
      return null;
    }
    if (walletBalanceUi == null) return null;
    const balance = Number(walletBalanceUi);
    if (!Number.isFinite(balance) || numericAmount <= balance) return null;
    return numericAmount - balance;
  }, [onAddFunds, amount, numericAmount, walletBalanceUi]);

  // Never sell USDC for a lock the chain will reject on the beta TVL cap.
  const capacityShort = usdcDeficit != null && numericAmount > GLOBAL_CAP_UI - currentTvlUi;

  const handleAddFundsTap = () => {
    if (usdcDeficit == null) return;
    if (!confirmRebuy && readFundingBreadcrumb() != null) {
      setConfirmRebuy(true);
      return;
    }
    setConfirmRebuy(false);
    onAddFunds?.(usdcDeficit);
  };

  return (
    <CozyCard data-testid="v2-deposit-form" className="w-full" style={{ padding: 20 }}>
      <CozySectionLabel>Lock your stake</CozySectionLabel>
      <p
        className="font-pixel-mono text-[12px] mb-2"
        style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
      >
        Lock USDC on <span style={{ color: COZY_TEXT }}>{courseTitle}</span>. It earns yield in
        Kamino while you learn, and unlocks when you finish the course.
      </p>
      {/* Penalty disclosure BEFORE the user commits funds — the claim/dashboard
          surfaces show it too, but consent belongs at the deposit. The old copy
          here read "your principal is always returned", which settle.rs does not
          implement: on a Kamino socialized loss the owner absorbs the shortfall. */}
      <p
        data-testid="v2-deposit-risk"
        className="font-pixel-mono text-[11px] mb-4"
        style={{ color: '#F0A878' }}
      >
        Lapses cost yield, never principal. Go dark after your shields are spent and you forfeit 50%
        of your yield on the first lapse, 100% on the second — it goes to the community pot. Your
        principal is never taken as a penalty, but it is not guaranteed: it sits in Kamino, a
        third-party protocol, so a Kamino loss, a USDC depeg or a Solana failure can return you less
        than you put in. This is unaudited beta software.
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

      {/* Fiat onramp — offered only for a known shortfall on a valid amount. */}
      {usdcDeficit != null && capacityShort && (
        <p
          data-testid="v2-capacity-blocked"
          className="font-pixel-mono text-[11px] mb-3"
          style={{ color: '#F0A878' }}
        >
          Beta capacity is nearly full — locking this amount isn&apos;t possible right now.
        </p>
      )}
      {usdcDeficit != null && !capacityShort && (
        <div className="mb-3">
          {confirmRebuy && (
            <p
              data-testid="v2-funding-confirm"
              className="font-pixel-mono text-[11px] mb-2"
              style={{ color: '#F0A878' }}
            >
              A purchase may still be on its way — buying again can charge your card twice.
            </p>
          )}
          <button
            data-testid="v2-add-funds"
            type="button"
            disabled={fundingPending}
            onClick={handleAddFundsTap}
            className="w-full py-3 rounded-lg border font-pixel-mono text-[12px] uppercase tracking-[1.5px] font-bold min-h-[44px]"
            style={{
              backgroundColor: fundingPending ? 'rgba(42,232,212,0.05)' : 'rgba(42,232,212,0.12)',
              borderColor: 'rgba(42,232,212,0.45)',
              color: '#2AE8D4',
              textShadow: '0 1px 2px rgba(0,0,0,0.7)',
              opacity: fundingPending ? 0.5 : 1,
            }}
          >
            {fundingPending
              ? 'Funding in progress…'
              : confirmRebuy
                ? 'Buy anyway'
                : `Add funds — you need $${usdcDeficit.toFixed(2).replace(/\.00$/, '')} more`}
          </button>
          {fundingNotice && (
            <>
              <p
                data-testid="v2-funding-notice"
                className="font-pixel-mono text-[11px] mt-2"
                style={{ color: COZY_TEXT, opacity: 0.85 }}
                role="status"
              >
                {fundingNotice}
              </p>
              {onFundingRecheck && (
                <button
                  data-testid="v2-funding-check-again"
                  type="button"
                  onClick={onFundingRecheck}
                  className="mt-2 px-4 py-2 rounded-lg border font-pixel-mono text-[11px] uppercase tracking-[1px] min-h-[36px]"
                  style={{
                    backgroundColor: 'rgba(255,213,128,0.10)',
                    borderColor: 'rgba(255,213,128,0.35)',
                    color: COZY_TEXT,
                    textShadow: COZY_TEXT_SHADOW,
                  }}
                >
                  Check again
                </button>
              )}
            </>
          )}
        </div>
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

      {/* Consent capture. Acceptance is recorded locally (gates this button) and
          reported to the backend so there is a server-side record of it. */}
      <label
        className="flex gap-2.5 mb-3 cursor-pointer"
        style={{ alignItems: 'flex-start' }}
      >
        <input
          data-testid="v2-consent-checkbox"
          type="checkbox"
          checked={accepted}
          disabled={busy}
          onChange={(e) => handleAccept(e.target.checked)}
          className="mt-0.5 w-[18px] h-[18px] shrink-0"
          style={{ accentColor: '#FFD580' }}
        />
        <span
          className="font-pixel-mono text-[11px] leading-[1.5]"
          style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
        >
          I have read the{' '}
          <Link href="/terms" target="_blank" style={{ color: '#FFD580', textDecoration: 'underline' }}>
            Terms
          </Link>{' '}
          and the{' '}
          <Link href="/risk" target="_blank" style={{ color: '#FFD580', textDecoration: 'underline' }}>
            Risk Disclosure
          </Link>
          , and I accept that I can lose money.
        </span>
      </label>

      <button
        data-testid="v2-deposit-submit"
        disabled={busy || Boolean(validationError) || !accepted}
        onClick={() => onSubmit(amount)}
        // font-pixel-mono (not the decorative font-pixel): the dollar amount is
        // ambiguous in the pixel display font ("$25" reads as "$2S", "LOCK" as
        // "LOOK"). Mono renders numbers + the word clearly.
        className="w-full py-3.5 rounded-lg border font-pixel-mono text-sm uppercase tracking-[1.5px] font-bold min-h-[44px]"
        style={{
          backgroundColor:
            busy || validationError || !accepted
              ? 'rgba(255,213,128,0.06)'
              : 'rgba(255,213,128,0.16)',
          borderColor: 'rgba(255,213,128,0.5)',
          color: COZY_TEXT,
          textShadow: COZY_TEXT_SHADOW,
          opacity: busy || validationError || !accepted ? 0.5 : 1,
        }}
      >
        {busy ? 'Locking…' : `Lock $${amount || '—'} USDC`}
      </button>
    </CozyCard>
  );
}

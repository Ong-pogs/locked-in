'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { Minus, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { T } from '@/components/theme';
import { CozyCard, CozySectionLabel } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

/* ──────────────────────────────────────────────────────────────────────
   Constants — match the established cozy palette
   ────────────────────────────────────────────────────────────────────── */

const AMBER = '#FFD580';
const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';
const COZY_TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.85)';

/* ──────────────────────────────────────────────────────────────────────
   Mock data — stand-in for the real course + wallet state
   ────────────────────────────────────────────────────────────────────── */

const MOCK = {
  courseId: 'wallets',
  courseTitle: 'Blockchain & Wallets',
  courseDifficulty: 'beginner' as const,
  courseCategory: 'solana' as const,
  courseTagline: 'Create the on-chain lock to start learning.',
  totalLessons: 8,
  policy: {
    minDeposit: 5,
    maxDeposit: 100,
    minDurationDays: 10,
    maxDurationDays: 30,
    presetDurations: [14, 30],
  },
  wallet: {
    usdc: 8,
    skr: 0,
    sol: 0.0873,
  },
  isDevnet: true,
};

const PRESETS = [1, 5, 10, 25, 50, 100] as const;

const DIFFICULTY_COLORS = {
  beginner: T.green,
  intermediate: T.teal,
  advanced: T.crimson,
} as const;

const CATEGORY_COLORS: Record<string, string> = {
  solana: T.violet,
  web3: T.teal,
  defi: T.teal,
  security: T.crimson,
  rust: T.rust,
};

/* ──────────────────────────────────────────────────────────────────────
   Variant switcher
   ────────────────────────────────────────────────────────────────────── */

type Variant = 'ledger' | 'stepper' | 'sheet' | 'pact';
const STORAGE_KEY = 'locked-in:lock-variant';

const VARIANTS: { id: Variant; label: string }[] = [
  { id: 'ledger', label: 'Ledger' },
  { id: 'stepper', label: 'Stepper' },
  { id: 'sheet', label: 'Sheet' },
  { id: 'pact', label: 'Pact' },
];

function VariantSwitcher({
  variant,
  setVariant,
}: {
  variant: Variant;
  setVariant: (v: Variant) => void;
}) {
  return (
    <div
      className="fixed bottom-4 left-4 z-40 flex items-center gap-1 p-1 rounded-full"
      style={{
        backgroundColor: 'rgba(14, 14, 28, 0.85)',
        border: `1px solid ${COZY_BORDER}`,
        boxShadow:
          '0 6px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,213,128,0.12)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      {VARIANTS.map((v) => {
        const active = variant === v.id;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => setVariant(v.id)}
            className="px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-[1.5px] transition-colors cursor-pointer"
            style={{
              fontFamily: 'var(--font-pixel-mono), monospace',
              color: active ? '#0e0e1c' : AMBER,
              backgroundColor: active ? AMBER : 'transparent',
              textShadow: active ? 'none' : COZY_TEXT_SHADOW,
            }}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Shared sub-bits
   ────────────────────────────────────────────────────────────────────── */

function CourseHeader() {
  const diffColor = DIFFICULTY_COLORS[MOCK.courseDifficulty];
  const catColor = CATEGORY_COLORS[MOCK.courseCategory] ?? T.teal;
  return (
    <div className="mb-6">
      <h1
        className="font-pixel text-3xl md:text-4xl font-bold tracking-wide mb-3"
        style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
      >
        {MOCK.courseTitle}
      </h1>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="font-pixel-mono text-[10px] font-bold uppercase tracking-[1.5px] px-2 py-[3px] rounded"
          style={{
            color: diffColor,
            backgroundColor: `${diffColor}15`,
            border: `1px solid ${diffColor}30`,
          }}
        >
          {MOCK.courseDifficulty}
        </span>
        <span
          className="font-pixel-mono text-[10px] font-bold uppercase tracking-[1.5px] px-2 py-[3px] rounded"
          style={{
            color: catColor,
            backgroundColor: `${catColor}15`,
            border: `1px solid ${catColor}30`,
          }}
        >
          {MOCK.courseCategory}
        </span>
        <span
          className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
          style={{ color: T.textMuted }}
        >
          {MOCK.totalLessons} lessons
        </span>
      </div>
    </div>
  );
}

function WalletRow({ inline = false }: { inline?: boolean }) {
  const items = [
    { label: 'USDC', value: MOCK.wallet.usdc.toFixed(2) },
    { label: 'SKR', value: MOCK.wallet.skr.toFixed(2) },
    { label: 'SOL', value: MOCK.wallet.sol.toFixed(4) },
  ];
  if (inline) {
    return (
      <div
        className="flex items-center gap-3 px-3 py-2 rounded-lg"
        style={{
          backgroundColor: 'rgba(0,0,0,0.32)',
          border: `1px solid ${COZY_BORDER}`,
        }}
      >
        {items.map((it, i) => (
          <div key={it.label} className="flex items-center gap-1.5">
            <span
              className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
              style={{ color: T.textMuted }}
            >
              {it.label}
            </span>
            <span
              className="font-pixel-mono text-[12px] font-bold"
              style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
            >
              {it.value}
            </span>
            {i < items.length - 1 && (
              <span style={{ color: T.borderDormant }}> · </span>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        backgroundColor: 'rgba(0,0,0,0.32)',
        border: `1px solid ${COZY_BORDER}`,
      }}
    >
      {items.map((it, i) => (
        <div
          key={it.label}
          className="flex justify-between items-center px-3.5 py-2"
          style={{
            borderTop:
              i === 0 ? 'none' : `1px solid rgba(58, 143, 168, 0.18)`,
          }}
        >
          <span
            className="font-pixel-mono text-[11px] uppercase tracking-[1.5px]"
            style={{ color: T.textSecondary }}
          >
            {it.label}
          </span>
          <span
            className="font-pixel-mono text-[13px] font-bold"
            style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
          >
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function ClaimTokensLink({ small = false }: { small?: boolean }) {
  if (!MOCK.isDevnet) return null;
  return (
    <button
      type="button"
      onClick={() => alert('Prototype: claim test tokens')}
      className={`${small ? 'text-[11px]' : 'text-[12px]'} underline-offset-2 hover:underline transition-opacity hover:opacity-80 cursor-pointer`}
      style={{
        fontFamily: 'var(--font-pixel-mono), monospace',
        color: T.teal,
        letterSpacing: '0.5px',
      }}
    >
      Need test tokens? Claim from devnet faucet →
    </button>
  );
}

function CoursePolicy() {
  return (
    <div
      className="rounded-lg px-3.5 py-3"
      style={{
        backgroundColor: 'rgba(0,0,0,0.32)',
        border: `1px solid ${COZY_BORDER}`,
      }}
    >
      <PolicyLine label="Min deposit" value={`${MOCK.policy.minDeposit} USDC`} />
      <PolicyLine label="Max deposit" value={`${MOCK.policy.maxDeposit} USDC`} />
      <PolicyLine
        label="Duration"
        value={`${MOCK.policy.minDurationDays}–${MOCK.policy.maxDurationDays} days`}
      />
      <PolicyLine
        label="Presets"
        value={MOCK.policy.presetDurations.map((d) => `${d}d`).join(' / ')}
        muted
      />
    </div>
  );
}

function PolicyLine({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-[3px]">
      <span
        className="font-pixel-mono text-[11px] uppercase tracking-[1.5px]"
        style={{ color: T.textSecondary }}
      >
        {label}
      </span>
      <span
        className="font-pixel-mono text-[12px] font-bold"
        style={{
          color: muted ? T.textMuted : AMBER,
          textShadow: muted ? undefined : COZY_TEXT_SHADOW,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function AmberCTA({
  onClick,
  children,
  full = true,
}: {
  onClick: () => void;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${full ? 'w-full' : ''} py-3.5 rounded-lg font-bold text-sm transition-all hover:brightness-110 cursor-pointer`}
      style={{
        fontFamily: 'var(--font-pixel), Georgia, serif',
        background: `linear-gradient(135deg, ${AMBER}, #d4a04a)`,
        color: '#1a1408',
        letterSpacing: '1.5px',
        boxShadow:
          '0 4px 16px rgba(255,213,128,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
      }}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Variant A — "Ledger"
   Open-book layout with two pages.
   ────────────────────────────────────────────────────────────────────── */

function LedgerVariant({
  amount,
  setAmount,
  duration,
  setDuration,
  skrBoost,
  setSkrBoost,
  onDeposit,
}: {
  amount: number;
  setAmount: (n: number) => void;
  duration: number;
  setDuration: (n: number) => void;
  skrBoost: number;
  setSkrBoost: (n: number) => void;
  onDeposit: () => void;
}) {
  return (
    <div>
      <CozyCard
        style={{
          padding: 0,
          // Spine illusion via vertical center divider
          backgroundImage:
            'linear-gradient(90deg, transparent 49.6%, rgba(58, 143, 168, 0.35) 50%, transparent 50.4%)',
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Left page — Amount + SKR */}
          <div className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-3">
              <span
                className="font-pixel-mono text-[10px] uppercase tracking-[2px]"
                style={{ color: T.textMuted }}
              >
                folio I
              </span>
              <div
                className="flex-1 h-px"
                style={{ backgroundColor: 'rgba(58, 143, 168, 0.25)' }}
              />
            </div>

            <CozySectionLabel>Principal</CozySectionLabel>
            <div className="flex items-baseline gap-2 mb-4">
              <input
                type="number"
                value={amount}
                onChange={(e) =>
                  setAmount(Math.max(0, Number(e.target.value) || 0))
                }
                className="font-pixel-mono bg-transparent border-none outline-none w-full text-5xl font-bold"
                style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
              />
              <span
                className="font-pixel-mono text-[14px] font-bold"
                style={{ color: T.textSecondary }}
              >
                USDC
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-5">
              {PRESETS.map((p) => {
                const sel = amount === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setAmount(p)}
                    className="px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors cursor-pointer"
                    style={{
                      fontFamily: 'var(--font-pixel-mono), monospace',
                      border: `1px solid ${sel ? AMBER : COZY_BORDER}`,
                      backgroundColor: sel
                        ? `${AMBER}22`
                        : 'rgba(0,0,0,0.25)',
                      color: sel ? AMBER : T.textSecondary,
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            <CozySectionLabel>SKR Boost (optional)</CozySectionLabel>
            <input
              type="number"
              value={skrBoost}
              onChange={(e) =>
                setSkrBoost(Math.max(0, Number(e.target.value) || 0))
              }
              className="font-pixel-mono w-full px-3 py-2.5 rounded-lg outline-none text-[14px]"
              style={{
                color: T.textPrimary,
                backgroundColor: 'rgba(0,0,0,0.32)',
                border: `1px solid ${COZY_BORDER}`,
              }}
            />
          </div>

          {/* Right page — Policy + Duration */}
          <div className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="flex-1 h-px"
                style={{ backgroundColor: 'rgba(58, 143, 168, 0.25)' }}
              />
              <span
                className="font-pixel-mono text-[10px] uppercase tracking-[2px]"
                style={{ color: T.textMuted }}
              >
                folio II
              </span>
            </div>

            <CozySectionLabel>Pact Terms</CozySectionLabel>
            <div className="mb-5">
              <CoursePolicy />
            </div>

            <CozySectionLabel>Lock Duration</CozySectionLabel>
            <div className="grid grid-cols-2 gap-2.5 mt-1">
              {MOCK.policy.presetDurations.map((d) => {
                const sel = duration === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className="py-5 rounded-lg transition-all cursor-pointer"
                    style={{
                      fontFamily: 'var(--font-pixel-mono), monospace',
                      border: `1px solid ${sel ? AMBER : COZY_BORDER}`,
                      backgroundColor: sel
                        ? `${AMBER}1c`
                        : 'rgba(0,0,0,0.32)',
                      color: sel ? AMBER : T.textPrimary,
                      boxShadow: sel
                        ? `0 0 18px ${AMBER}40, inset 0 1px 0 rgba(255,213,128,0.15)`
                        : 'none',
                      textShadow: sel ? COZY_TEXT_SHADOW : undefined,
                    }}
                  >
                    <div className="text-2xl font-bold">{d}</div>
                    <div className="text-[10px] uppercase tracking-[1.5px] mt-0.5 opacity-80">
                      days
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CozyCard>

      <div className="mt-5">
        <AmberCTA onClick={onDeposit}>SIGN THE PACT</AmberCTA>
      </div>

      <div className="mt-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <WalletRow inline />
        <ClaimTokensLink small />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Variant B — "Stepper"
   3-step wizard.
   ────────────────────────────────────────────────────────────────────── */

function StepperVariant({
  amount,
  setAmount,
  duration,
  setDuration,
  skrBoost,
  onDeposit,
}: {
  amount: number;
  setAmount: (n: number) => void;
  duration: number;
  setDuration: (n: number) => void;
  skrBoost: number;
  onDeposit: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  return (
    <div>
      <CozyCard>
        {/* Step indicator */}
        <div className="flex items-center justify-between mb-5">
          <span
            className="font-pixel-mono text-[11px] uppercase tracking-[2px]"
            style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
          >
            Step {step} of 3
          </span>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className="rounded-full transition-all"
                style={{
                  width: n === step ? 22 : 8,
                  height: 8,
                  backgroundColor:
                    n <= step ? AMBER : 'rgba(58, 143, 168, 0.35)',
                  boxShadow: n === step ? `0 0 10px ${AMBER}80` : 'none',
                }}
              />
            ))}
          </div>
        </div>

        {step === 1 && (
          <div>
            <h2
              className="font-pixel text-2xl font-bold mb-1"
              style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
            >
              How much?
            </h2>
            <p
              className="font-pixel-mono text-[12px] mb-5"
              style={{ color: T.textSecondary }}
            >
              Pick the principal you&apos;ll lock for this course.
            </p>

            <input
              type="number"
              value={amount}
              onChange={(e) =>
                setAmount(Math.max(0, Number(e.target.value) || 0))
              }
              className="font-pixel-mono w-full px-4 py-5 rounded-lg outline-none text-4xl font-bold mb-3"
              style={{
                color: AMBER,
                backgroundColor: 'rgba(0,0,0,0.32)',
                border: `1px solid ${COZY_BORDER}`,
                textShadow: COZY_TEXT_SHADOW,
              }}
            />

            <div className="flex flex-wrap gap-1.5 mb-6">
              {PRESETS.map((p) => {
                const sel = amount === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setAmount(p)}
                    className="px-4 py-2 rounded-full text-[12px] font-bold transition-colors cursor-pointer"
                    style={{
                      fontFamily: 'var(--font-pixel-mono), monospace',
                      border: `1px solid ${sel ? AMBER : COZY_BORDER}`,
                      backgroundColor: sel
                        ? `${AMBER}22`
                        : 'rgba(0,0,0,0.25)',
                      color: sel ? AMBER : T.textSecondary,
                    }}
                  >
                    {p} USDC
                  </button>
                );
              })}
            </div>

            <div className="flex justify-end">
              <StepNav
                onNext={() => setStep(2)}
                nextLabel="Next"
                disablePrev
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2
              className="font-pixel text-2xl font-bold mb-1"
              style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
            >
              How long?
            </h2>
            <p
              className="font-pixel-mono text-[12px] mb-5"
              style={{ color: T.textSecondary }}
            >
              Longer locks earn more. You can break early but you&apos;ll
              forfeit yield.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              {MOCK.policy.presetDurations.map((d) => {
                const sel = duration === d;
                const blurb =
                  d === 14
                    ? 'Short stretch. Lower stakes.'
                    : 'Full pact. Maximum yield.';
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className="text-left p-5 rounded-lg transition-all cursor-pointer"
                    style={{
                      border: `1px solid ${sel ? AMBER : COZY_BORDER}`,
                      backgroundColor: sel
                        ? `${AMBER}1c`
                        : 'rgba(0,0,0,0.32)',
                      boxShadow: sel
                        ? `0 0 18px ${AMBER}40, inset 0 1px 0 rgba(255,213,128,0.15)`
                        : 'none',
                    }}
                  >
                    <div
                      className="font-pixel-mono text-3xl font-bold"
                      style={{
                        color: sel ? AMBER : T.textPrimary,
                        textShadow: sel ? COZY_TEXT_SHADOW : undefined,
                      }}
                    >
                      {d}
                      <span className="text-base ml-1 opacity-80">days</span>
                    </div>
                    <p
                      className="font-pixel-mono text-[11px] mt-2"
                      style={{ color: T.textSecondary }}
                    >
                      {blurb}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-between">
              <StepNav
                onPrev={() => setStep(1)}
                onNext={() => setStep(3)}
                nextLabel="Next"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2
              className="font-pixel text-2xl font-bold mb-1"
              style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
            >
              Review & sign
            </h2>
            <p
              className="font-pixel-mono text-[12px] mb-4"
              style={{ color: T.textSecondary }}
            >
              Check the details before you stamp the pact.
            </p>

            <div
              className="rounded-lg overflow-hidden mb-5"
              style={{
                backgroundColor: 'rgba(0,0,0,0.32)',
                border: `1px solid ${COZY_BORDER}`,
              }}
            >
              <SummaryRow label="Course" value={MOCK.courseTitle} />
              <SummaryRow label="Amount" value={`${amount} USDC`} accent />
              <SummaryRow label="Duration" value={`${duration} days`} accent />
              <SummaryRow
                label="SKR boost"
                value={skrBoost > 0 ? `${skrBoost} SKR` : 'None'}
              />
            </div>

            <div className="mb-5">
              <CozySectionLabel>Wallet</CozySectionLabel>
              <WalletRow />
            </div>

            <div className="mb-4">
              <AmberCTA onClick={onDeposit}>
                ◆ SIGN THE PACT ◆
              </AmberCTA>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="font-pixel-mono text-[12px] flex items-center gap-1 hover:opacity-80 cursor-pointer"
                style={{ color: T.textSecondary }}
              >
                <ChevronLeft size={14} /> Back
              </button>
              <ClaimTokensLink small />
            </div>
          </div>
        )}
      </CozyCard>
    </div>
  );
}

function StepNav({
  onPrev,
  onNext,
  nextLabel,
  disablePrev = false,
}: {
  onPrev?: () => void;
  onNext: () => void;
  nextLabel: string;
  disablePrev?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 w-full justify-between">
      <button
        type="button"
        onClick={onPrev}
        disabled={disablePrev}
        className="font-pixel-mono text-[12px] flex items-center gap-1 transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        style={{ color: T.textSecondary }}
      >
        <ChevronLeft size={14} /> Back
      </button>
      <button
        type="button"
        onClick={onNext}
        className="px-5 py-2.5 rounded-lg font-bold text-[12px] flex items-center gap-1.5 transition-all hover:brightness-110 cursor-pointer"
        style={{
          fontFamily: 'var(--font-pixel-mono), monospace',
          background: `linear-gradient(135deg, ${AMBER}, #d4a04a)`,
          color: '#1a1408',
          letterSpacing: '1.5px',
          boxShadow: `0 4px 12px ${AMBER}30`,
        }}
      >
        {nextLabel} <ChevronRight size={14} />
      </button>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className="flex justify-between items-center px-4 py-2.5"
      style={{
        borderTop: `1px solid rgba(58, 143, 168, 0.18)`,
      }}
    >
      <span
        className="font-pixel-mono text-[11px] uppercase tracking-[1.5px]"
        style={{ color: T.textSecondary }}
      >
        {label}
      </span>
      <span
        className="font-pixel-mono text-[13px] font-bold"
        style={{
          color: accent ? AMBER : T.textPrimary,
          textShadow: accent ? COZY_TEXT_SHADOW : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Variant C — "Sheet"
   Modern compact, all visible at once.
   ────────────────────────────────────────────────────────────────────── */

function SheetVariant({
  amount,
  setAmount,
  duration,
  setDuration,
  skrBoost,
  setSkrBoost,
  onDeposit,
}: {
  amount: number;
  setAmount: (n: number) => void;
  duration: number;
  setDuration: (n: number) => void;
  skrBoost: number;
  setSkrBoost: (n: number) => void;
  onDeposit: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Find nearest preset index for slider
  const sliderIdx = useMemo(() => {
    const idx = PRESETS.findIndex((p) => p === amount);
    if (idx >= 0) return idx;
    // map to nearest
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < PRESETS.length; i++) {
      const d = Math.abs(PRESETS[i] - amount);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    return nearest;
  }, [amount]);

  return (
    <div>
      <CozyCard>
        <div className="mb-5">
          <span
            className="font-pixel-mono text-[10px] uppercase tracking-[2px]"
            style={{ color: T.textMuted }}
          >
            Locking for
          </span>
          <p
            className="font-pixel text-[14px] font-bold mt-0.5"
            style={{ color: T.textPrimary }}
          >
            {MOCK.courseTitle}
          </p>
        </div>

        {/* Amount with +/- and slider */}
        <CozySectionLabel>Amount (USDC)</CozySectionLabel>
        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() => setAmount(Math.max(0, amount - 1))}
            className="w-11 h-11 rounded-lg flex items-center justify-center transition-colors hover:brightness-125 cursor-pointer"
            style={{
              backgroundColor: 'rgba(0,0,0,0.35)',
              border: `1px solid ${COZY_BORDER}`,
              color: AMBER,
            }}
            aria-label="Decrease amount"
          >
            <Minus size={18} />
          </button>
          <input
            type="number"
            value={amount}
            onChange={(e) =>
              setAmount(Math.max(0, Number(e.target.value) || 0))
            }
            className="font-pixel-mono flex-1 text-center text-2xl font-bold py-2.5 rounded-lg outline-none"
            style={{
              color: AMBER,
              backgroundColor: 'rgba(0,0,0,0.35)',
              border: `1px solid ${COZY_BORDER}`,
              textShadow: COZY_TEXT_SHADOW,
            }}
          />
          <button
            type="button"
            onClick={() => setAmount(amount + 1)}
            className="w-11 h-11 rounded-lg flex items-center justify-center transition-colors hover:brightness-125 cursor-pointer"
            style={{
              backgroundColor: 'rgba(0,0,0,0.35)',
              border: `1px solid ${COZY_BORDER}`,
              color: AMBER,
            }}
            aria-label="Increase amount"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="mb-1">
          <input
            type="range"
            min={0}
            max={PRESETS.length - 1}
            value={sliderIdx}
            onChange={(e) => setAmount(PRESETS[Number(e.target.value)])}
            aria-label="Quick amount slider"
            className="w-full accent-amber-300"
            style={{ accentColor: AMBER }}
          />
          <div className="flex justify-between mt-1 px-0.5">
            {PRESETS.map((p) => (
              <span
                key={p}
                className="font-pixel-mono text-[10px]"
                style={{
                  color: amount === p ? AMBER : T.textMuted,
                  textShadow: amount === p ? COZY_TEXT_SHADOW : undefined,
                }}
              >
                {p}
              </span>
            ))}
          </div>
        </div>

        {/* Duration pill toggle */}
        <div className="mt-5">
          <CozySectionLabel>Duration</CozySectionLabel>
          <div
            className="grid grid-cols-2 gap-1 p-1 rounded-lg"
            style={{
              backgroundColor: 'rgba(0,0,0,0.35)',
              border: `1px solid ${COZY_BORDER}`,
            }}
          >
            {MOCK.policy.presetDurations.map((d) => {
              const sel = duration === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className="py-2.5 rounded-md transition-all cursor-pointer"
                  style={{
                    fontFamily: 'var(--font-pixel-mono), monospace',
                    backgroundColor: sel ? AMBER : 'transparent',
                    color: sel ? '#1a1408' : T.textPrimary,
                    fontWeight: 700,
                    fontSize: 13,
                    letterSpacing: '1.5px',
                    boxShadow: sel
                      ? `0 0 14px ${AMBER}55, inset 0 1px 0 rgba(255,255,255,0.25)`
                      : 'none',
                  }}
                >
                  {d}d
                </button>
              );
            })}
          </div>
        </div>

        {/* Advanced collapsible */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="font-pixel-mono w-full flex items-center justify-between text-[11px] uppercase tracking-[1.5px] py-2 hover:opacity-80 cursor-pointer"
            style={{ color: T.textSecondary }}
          >
            <span>Advanced · SKR boost</span>
            <span style={{ color: AMBER }}>{advancedOpen ? '−' : '+'}</span>
          </button>
          {advancedOpen && (
            <input
              type="number"
              value={skrBoost}
              onChange={(e) =>
                setSkrBoost(Math.max(0, Number(e.target.value) || 0))
              }
              placeholder="0"
              className="font-pixel-mono w-full px-3 py-2.5 rounded-lg outline-none text-[14px] mt-1"
              style={{
                color: T.textPrimary,
                backgroundColor: 'rgba(0,0,0,0.32)',
                border: `1px solid ${COZY_BORDER}`,
              }}
            />
          )}
        </div>

        {/* Wallet inline strip */}
        <div className="mt-5 mb-5">
          <WalletRow inline />
        </div>

        {/* CTA */}
        <AmberCTA onClick={onDeposit}>DEPOSIT &amp; START LEARNING</AmberCTA>

        <div className="mt-3 text-center">
          <ClaimTokensLink small />
        </div>
      </CozyCard>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Variant D — "Pact"
   Dramatic hero card with wax seal motif.
   ────────────────────────────────────────────────────────────────────── */

function WaxSeal() {
  return (
    <div
      className="relative"
      style={{
        width: 96,
        height: 96,
        animation: 'pactSealPulse 2.6s ease-in-out infinite',
      }}
      aria-hidden
    >
      <svg viewBox="0 0 100 100" width="96" height="96">
        <defs>
          <radialGradient id="seal-fill" cx="50%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#a8243a" />
            <stop offset="60%" stopColor="#7a1626" />
            <stop offset="100%" stopColor="#3d0a13" />
          </radialGradient>
          <filter id="seal-glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* outer amber ring */}
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={AMBER}
          strokeWidth="2"
          opacity="0.6"
        />
        {/* wax body */}
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="url(#seal-fill)"
          stroke={AMBER}
          strokeWidth="1.5"
          filter="url(#seal-glow)"
        />
        {/* inner stamped ring */}
        <circle
          cx="50"
          cy="50"
          r="32"
          fill="none"
          stroke={AMBER}
          strokeWidth="0.8"
          opacity="0.5"
        />
        {/* flame insignia — simplified */}
        <path
          d="M50 32 C44 40, 42 46, 44 52 C46 58, 50 60, 50 64 C50 60, 54 58, 56 52 C58 46, 56 40, 50 32 Z"
          fill={AMBER}
          opacity="0.85"
          filter="url(#seal-glow)"
        />
        <path
          d="M50 42 C48 46, 47 49, 48 52 C49 55, 50 56, 50 58 C50 56, 51 55, 52 52 C53 49, 52 46, 50 42 Z"
          fill="#fff7e0"
          opacity="0.75"
        />
      </svg>
      <style>{`
        @keyframes pactSealPulse {
          0%, 100% { filter: drop-shadow(0 0 10px ${AMBER}55); }
          50% { filter: drop-shadow(0 0 22px ${AMBER}aa); }
        }
      `}</style>
    </div>
  );
}

function PactVariant({
  amount,
  setAmount,
  duration,
  setDuration,
  onDeposit,
}: {
  amount: number;
  setAmount: (n: number) => void;
  duration: number;
  setDuration: (n: number) => void;
  onDeposit: () => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-5">
      {/* Hero card */}
      <CozyCard
        className="relative overflow-hidden"
        style={{
          padding: 28,
          backgroundColor: 'rgba(14, 14, 28, 0.42)',
          boxShadow:
            '0 8px 28px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,213,128,0.18), 0 0 80px rgba(255,213,128,0.12)',
        }}
      >
        {/* Faint amber halo behind hero number */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center top, rgba(255,213,128,0.22) 0%, transparent 60%)',
          }}
        />

        <div className="relative">
          <p
            className="font-pixel-mono text-center text-[11px] uppercase tracking-[3px] mb-3"
            style={{ color: AMBER, opacity: 0.7 }}
          >
            Principal
          </p>

          {/* Hero number + minus/plus */}
          <div className="flex items-center justify-center gap-4 mb-4">
            <button
              type="button"
              onClick={() => setAmount(Math.max(0, amount - 1))}
              className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:brightness-125 cursor-pointer"
              style={{
                backgroundColor: 'rgba(0,0,0,0.4)',
                border: `1px solid ${COZY_BORDER}`,
                color: AMBER,
              }}
              aria-label="Decrease"
            >
              <Minus size={20} />
            </button>

            <input
              type="number"
              value={amount}
              onChange={(e) =>
                setAmount(Math.max(0, Number(e.target.value) || 0))
              }
              className="font-pixel-mono bg-transparent border-none outline-none text-center font-bold"
              style={{
                color: AMBER,
                fontSize: '5rem',
                lineHeight: 1,
                width: '4ch',
                textShadow: `0 0 24px ${AMBER}66, ${COZY_TEXT_SHADOW}`,
              }}
            />

            <button
              type="button"
              onClick={() => setAmount(amount + 1)}
              className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:brightness-125 cursor-pointer"
              style={{
                backgroundColor: 'rgba(0,0,0,0.4)',
                border: `1px solid ${COZY_BORDER}`,
                color: AMBER,
              }}
              aria-label="Increase"
            >
              <Plus size={20} />
            </button>
          </div>

          <p
            className="font-pixel-mono text-center text-[11px] uppercase tracking-[2px] mb-5"
            style={{ color: T.textMuted }}
          >
            USDC
          </p>

          {/* Quick-pick chips */}
          <div className="flex items-center justify-center gap-2 mb-7">
            {[
              { label: '1', value: 1 },
              { label: 'Half', value: Math.max(1, Math.floor(MOCK.wallet.usdc / 2)) },
              { label: 'All', value: Math.max(1, Math.floor(MOCK.wallet.usdc)) },
            ].map((c) => {
              const sel = amount === c.value;
              return (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setAmount(c.value)}
                  className="px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-[1.5px] transition-colors cursor-pointer"
                  style={{
                    fontFamily: 'var(--font-pixel-mono), monospace',
                    border: `1px solid ${sel ? AMBER : COZY_BORDER}`,
                    backgroundColor: sel
                      ? `${AMBER}22`
                      : 'rgba(0,0,0,0.32)',
                    color: sel ? AMBER : T.textSecondary,
                    textShadow: sel ? COZY_TEXT_SHADOW : undefined,
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          {/* Duration as wooden lever + wax seal */}
          <div className="flex items-center justify-center gap-5 mb-7">
            <div
              className="grid grid-cols-2 p-1.5 rounded-md"
              style={{
                background:
                  'linear-gradient(180deg, #4a2f1c 0%, #2d1c10 100%)',
                border: '2px solid #b8862f',
                boxShadow:
                  '0 4px 12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,213,128,0.18)',
              }}
            >
              {MOCK.policy.presetDurations.map((d) => {
                const sel = duration === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className="px-7 py-2.5 rounded-sm transition-all cursor-pointer"
                    style={{
                      fontFamily: 'var(--font-pixel-mono), monospace',
                      backgroundColor: sel
                        ? '#1a0e08'
                        : 'rgba(255,255,255,0.04)',
                      color: sel ? AMBER : '#c9a87a',
                      fontWeight: 700,
                      fontSize: 14,
                      letterSpacing: '1.5px',
                      transform: sel ? 'translateY(2px)' : 'translateY(0)',
                      boxShadow: sel
                        ? 'inset 0 3px 8px rgba(0,0,0,0.7)'
                        : 'inset 0 -2px 0 rgba(0,0,0,0.4)',
                      textShadow: sel ? COZY_TEXT_SHADOW : undefined,
                    }}
                  >
                    {d}d
                  </button>
                );
              })}
            </div>

            <WaxSeal />
          </div>

          {/* Stamp CTA */}
          <button
            type="button"
            onClick={onDeposit}
            className="w-full py-4 rounded-lg font-bold transition-all hover:brightness-110 cursor-pointer"
            style={{
              fontFamily: 'var(--font-pixel), Georgia, serif',
              background: `linear-gradient(135deg, ${AMBER}, #d4a04a)`,
              color: '#1a1408',
              fontSize: 16,
              letterSpacing: '2px',
              boxShadow:
                '0 6px 20px rgba(255,213,128,0.45), inset 0 1px 0 rgba(255,255,255,0.3)',
            }}
          >
            ◆ STAMP YOUR PACT ◆
          </button>
        </div>
      </CozyCard>

      {/* Sidebar */}
      <div className="flex flex-col gap-4">
        <CozyCard>
          <CozySectionLabel>Pact Terms</CozySectionLabel>
          <CoursePolicy />
        </CozyCard>

        <CozyCard>
          <CozySectionLabel>Wallet</CozySectionLabel>
          <WalletRow />
        </CozyCard>

        <div className="flex justify-center">
          <ClaimTokensLink />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Main scene
   ────────────────────────────────────────────────────────────────────── */

// useSyncExternalStore wiring — returns true once we're past the SSR pass
// and on the client, false during SSR. This is React's recommended way to
// detect "are we hydrated yet?" without violating set-state-in-effect.
function subscribeNoop() {
  return () => {};
}
function getClientSnapshot() {
  return true;
}
function getServerSnapshot() {
  return false;
}

export function PrototypesScene() {
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    getClientSnapshot,
    getServerSnapshot,
  );

  // Lazy initializer reads localStorage on first client render only. SSR
  // path returns 'ledger', client path checks storage. The `hydrated` gate
  // below ensures the variant content only renders post-mount, so any
  // SSR/CSR mismatch is avoided.
  const [variant, setVariantState] = useState<Variant>(() => {
    if (typeof window === 'undefined') return 'ledger';
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw && VARIANTS.some((v) => v.id === raw)) {
        return raw as Variant;
      }
    } catch {
      // ignore
    }
    return 'ledger';
  });

  const setVariant = (v: Variant) => {
    setVariantState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      // ignore
    }
  };

  // Shared form state
  const [amount, setAmount] = useState<number>(1);
  const [duration, setDuration] = useState<number>(30);
  const [skrBoost, setSkrBoost] = useState<number>(0);

  const handleDeposit = () => {
    alert(
      `Prototype: Sign the pact\n\n` +
        `Variant: ${variant}\n` +
        `Course:  ${MOCK.courseTitle}\n` +
        `Amount:  ${amount} USDC\n` +
        `Duration: ${duration} days\n` +
        `SKR boost: ${skrBoost}`,
    );
  };

  return (
    <div
      className="min-h-screen relative"
      style={{ backgroundColor: T.bg }}
    >
      {/* Bg layer — vault.png with onError fallback + 3-stop indigo gradient */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/vault/vault.png"
          alt=""
          draggable={false}
          className="w-full h-full object-cover select-none"
          style={{ imageRendering: 'pixelated' }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(14,14,28,0.35) 0%, rgba(14,14,28,0.62) 60%, rgba(14,14,28,0.82) 100%)',
          }}
        />
      </div>

      <HubButton />
      <VariantSwitcher variant={variant} setVariant={setVariant} />

      <div className="relative z-10 max-w-[1100px] mx-auto px-[18px] pb-24">
        <div className="pt-20" />
        <CourseHeader />

        {hydrated && variant === 'ledger' && (
          <LedgerVariant
            amount={amount}
            setAmount={setAmount}
            duration={duration}
            setDuration={setDuration}
            skrBoost={skrBoost}
            setSkrBoost={setSkrBoost}
            onDeposit={handleDeposit}
          />
        )}
        {hydrated && variant === 'stepper' && (
          <StepperVariant
            amount={amount}
            setAmount={setAmount}
            duration={duration}
            setDuration={setDuration}
            skrBoost={skrBoost}
            onDeposit={handleDeposit}
          />
        )}
        {hydrated && variant === 'sheet' && (
          <SheetVariant
            amount={amount}
            setAmount={setAmount}
            duration={duration}
            setDuration={setDuration}
            skrBoost={skrBoost}
            setSkrBoost={setSkrBoost}
            onDeposit={handleDeposit}
          />
        )}
        {hydrated && variant === 'pact' && (
          <PactVariant
            amount={amount}
            setAmount={setAmount}
            duration={duration}
            setDuration={setDuration}
            onDeposit={handleDeposit}
          />
        )}
      </div>
    </div>
  );
}


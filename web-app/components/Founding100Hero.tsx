'use client';

import Link from 'next/link';
import { track } from '@vercel/analytics';
import { ArrowRight, ShieldCheck } from 'lucide-react';

type Variant = 'desktop' | 'mobile';

const trustLine =
  'Mainnet capped beta · Variable yield · $1,000 TVL cap · Unaudited software';

export function Founding100Hero({ variant }: { variant: Variant }) {
  const desktop = variant === 'desktop';
  const secondaryLinkClass =
    'flex min-h-11 items-center px-2 underline underline-offset-4';

  return (
    <section
      aria-labelledby={`founding-100-${variant}`}
      data-testid={`founding-100-${variant}`}
      className={desktop
        ? 'fixed bottom-5 left-1/2 z-20 w-[min(720px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border px-6 py-5'
        : 'relative overflow-hidden rounded-2xl border px-5 py-5'}
      style={{
        background:
          'linear-gradient(135deg, rgba(10,18,29,0.96), rgba(26,17,38,0.94) 58%, rgba(44,25,25,0.94))',
        borderColor: 'rgba(255,213,128,0.52)',
        boxShadow:
          '0 18px 55px rgba(0,0,0,0.58), inset 0 1px 0 rgba(255,213,128,0.16)',
        backdropFilter: 'blur(18px) saturate(1.25)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.25)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full"
        style={{ background: 'rgba(153,69,255,0.18)', filter: 'blur(28px)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 left-16 h-32 w-40 rounded-full"
        style={{ background: 'rgba(62,230,138,0.10)', filter: 'blur(24px)' }}
      />

      <div className={desktop ? 'relative grid grid-cols-[1fr_auto] items-end gap-6' : 'relative'}>
        <div>
          <p
            className="font-pixel-mono text-[10px] uppercase tracking-[2px]"
            style={{ color: '#2AE8D4' }}
          >
            Founding 100 · Mainnet beta
          </p>
          <h1
            id={`founding-100-${variant}`}
            className="mt-2 font-pixel text-[clamp(22px,3vw,34px)] font-bold leading-[1.05]"
            style={{ color: '#FFD580', textShadow: '0 2px 12px rgba(0,0,0,0.72)' }}
          >
            Stop collecting courses. Finish one.
          </h1>
          <p
            className="mt-2 max-w-[560px] text-[13px] leading-[1.55]"
            style={{ color: 'rgba(255,255,255,0.76)' }}
          >
            Lock $10-$50 USDC behind a course. Complete the work to unlock your
            position. If you fall off after your shields are gone, part of the
            yield rewards learners who stayed consistent.
          </p>

          <div
            className="mt-3 flex items-start gap-2 font-pixel-mono text-xs leading-[1.55]"
            style={{ color: 'rgba(255,255,255,0.74)' }}
          >
            <ShieldCheck className="mt-0.5 shrink-0" size={13} color="#F0A878" aria-hidden />
            <span>
              {trustLine}. Funds remain exposed to smart-contract, Kamino,
              USDC, and Solana risks.
            </span>
          </div>
        </div>

        <div className={desktop ? 'flex min-w-[190px] flex-col gap-2' : 'mt-4 flex flex-col gap-2'}>
          <Link
            href="/courses"
            onClick={() => track('founding_100_cta', { placement: variant })}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border px-5 py-3 font-pixel text-[13px] font-bold uppercase tracking-[1px] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            style={{
              color: '#1A1000',
              background: '#FFD580',
              borderColor: '#FFE6AD',
              boxShadow: '0 0 20px rgba(255,213,128,0.26)',
            }}
          >
            Join the Founding 100
            <ArrowRight size={15} aria-hidden />
          </Link>
          <div className="flex items-center justify-center gap-3 font-pixel-mono text-[11px] uppercase tracking-[1px]">
            <Link className={secondaryLinkClass} style={{ color: '#F0A878' }} href="/risk">
              Read the risks
            </Link>
            <span aria-hidden style={{ color: 'rgba(255,255,255,0.22)' }}>·</span>
            <Link className={secondaryLinkClass} style={{ color: '#F0A878' }} href="/support">
              Get help
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

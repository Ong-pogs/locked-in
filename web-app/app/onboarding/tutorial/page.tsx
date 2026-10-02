'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/stores';
import { T, ParchmentCard } from '@/components/theme';

const QUESTS = [
  {
    icon: '\u{1F511}',
    iconBg: `${T.amber}18`,
    title: 'Wallet Ready',
    tag: '\u2713 Auto-created',
    tagColor: T.green,
    body: (
      <>
        A secure Solana wallet was created when you signed in. No seed phrases,
        no extensions.{' '}
        <span style={{ color: T.amber, fontWeight: 600 }}>It just works.</span>
      </>
    ),
  },
  {
    icon: '\u{1F4B5}',
    iconBg: `${T.green}18`,
    title: 'Digital Dollars',
    tag: 'USDC Stablecoin',
    tagColor: T.teal,
    body: (
      <>
        We use USDC &mdash; not Bitcoin, not memecoins.{' '}
        <span style={{ color: T.amber, fontWeight: 600 }}>
          1 USDC = $1, always.
        </span>{' '}
        Backed by real dollars. Stable and predictable.
      </>
    ),
  },
  {
    icon: '\u{1F525}',
    iconBg: `${T.rust}18`,
    title: 'Lock & Learn',
    tag: 'The Core Loop',
    tagColor: T.rust,
    body: (
      <>
        Lock USDC for a set time. Learn daily to keep the flame lit. Stay
        consistent &rarr;{' '}
        <span style={{ color: T.amber, fontWeight: 600 }}>
          earn yield rewards
        </span>
        . Slack off &rarr; rewards shrink.
      </>
    ),
    callout: 'Like a gym membership, reversed \u2014 show up and earn.',
  },
];

export default function OnboardingTutorialPage() {
  const router = useRouter();
  const completeTutorial = useUserStore((s) => s.completeTutorial);

  // Bounce returning users — tutorial is for NEW users only
  useEffect(() => {
    try {
      if (
        localStorage.getItem('locked-in-tutorial-done') === '1' ||
        document.cookie.includes('locked-in-tutorial-done=1')
      ) {
        router.replace('/courses');
      }
    } catch {}
  }, [router]);

  const handleContinue = () => {
    completeTutorial();
    router.replace('/courses');
  };

  return (
    <div
      className="min-h-screen relative"
      style={{
        backgroundColor: T.bg,
        backgroundImage: "url('/images/wood.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      <div
        className="fixed inset-0"
        style={{ backgroundColor: 'rgba(6,6,12,0.55)' }}
      />

      <div className="relative max-w-[1100px] mx-auto px-5 min-h-screen flex flex-col items-center justify-center py-10">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div
            className="w-[30px] h-px"
            style={{ backgroundColor: `${T.amber}30` }}
          />
          <span className="text-[7px]" style={{ color: `${T.amber}50` }}>
            ◆
          </span>
          <div
            className="w-[30px] h-px"
            style={{ backgroundColor: `${T.amber}30` }}
          />
        </div>
        {/* Pixel type system: Pixelify (font-pixel) for headings and titles,
            Silkscreen (font-pixel-mono) for short caps labels and buttons,
            default Geist sans for the multi-sentence card body copy. */}
        <h1
          className="font-pixel text-2xl font-bold tracking-wide mb-1 text-center"
          style={{ color: T.textPrimary }}
        >
          Before You <span style={{ color: T.amber }}>Begin</span>
        </h1>
        <p
          className="font-pixel-mono text-[10px] uppercase tracking-[2px] mt-2 mb-8"
          style={{ color: T.textMutedStrong }}
        >
          Three things to know
        </p>

        {/* Quest cards — stacked on mobile, 3-col on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-[820px]">
          {QUESTS.map((q) => (
            <ParchmentCard key={q.title} opacity={0.25}>
              {/* Icon + title row */}
              <div className="flex items-center gap-3 mb-2.5">
                <div
                  className="w-10 h-10 rounded-[10px] flex items-center justify-center text-[20px] flex-shrink-0"
                  style={{ backgroundColor: q.iconBg }}
                >
                  {q.icon}
                </div>
                <div>
                  <p
                    className="font-pixel text-[16px] font-bold"
                    style={{ color: T.textPrimary }}
                  >
                    {q.title}
                  </p>
                  <p
                    className="font-pixel-mono text-[9px] uppercase tracking-[1.5px] mt-0.5"
                    style={{ color: q.tagColor }}
                  >
                    {q.tag}
                  </p>
                </div>
              </div>

              {/* Body */}
              <p
                className="text-[13px] leading-[20px]"
                style={{ color: T.textMutedStrong }}
              >
                {q.body}
              </p>

              {/* Optional callout */}
              {q.callout && (
                <div
                  className="mt-3 py-2.5 px-3.5 rounded-md border text-center"
                  style={{
                    backgroundColor: `${T.green}08`,
                    borderColor: `${T.green}18`,
                  }}
                >
                  <span
                    className="text-[12px]"
                    style={{ color: T.green }}
                  >
                    {q.callout}
                  </span>
                </div>
              )}
            </ParchmentCard>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-8 w-full max-w-sm">
          <button
            onClick={handleContinue}
            className="w-full py-4 rounded-[10px] text-center"
            style={{
              backgroundColor: T.amber,
              border: `1px solid ${T.amber}50`,
              boxShadow: '0 0 16px rgba(212,160,74,0.2)',
            }}
          >
            <span
              className="font-pixel-mono text-[13px] font-bold uppercase tracking-[3px]"
              style={{ color: T.bg }}
            >
              ◆ BEGIN YOUR JOURNEY ◆
            </span>
          </button>
          <button
            onClick={handleContinue}
            className="w-full mt-3 py-2 text-center"
          >
            <span
              className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
              style={{ color: T.textMutedStrong }}
            >
              I already know this
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

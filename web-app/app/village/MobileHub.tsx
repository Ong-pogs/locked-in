'use client';

import { useRouter } from 'next/navigation';
import { useLogin } from '@privy-io/react-auth';
import { BookOpen, Coins, Trophy, LayoutDashboard, ChevronRight, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { CozyCard, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { T } from '@/components/theme';

// Mobile-native hub — a phone shouldn't pan a 16:9 painting sideways. The art
// becomes a header banner; the destinations become big tappable cards. Desktop
// keeps the full painted VillageScene (page.tsx toggles by breakpoint).

type Dest = {
  id: string;
  route: string;
  label: string;
  desc: string;
  icon: typeof BookOpen;
  color: string;
  gated: boolean; // requires auth
};

const DESTS: Dest[] = [
  { id: 'academy', route: '/courses', label: 'Courses', desc: 'Lock USDC on a course and start learning', icon: BookOpen, color: '#3EE68A', gated: false },
  { id: 'dashboard', route: '/dashboard', label: 'Dashboard', desc: 'Your positions, yield, streak and XP', icon: LayoutDashboard, color: '#FFD580', gated: true },
  { id: 'tavern', route: '/community-pot', label: 'Community Pot', desc: 'Forfeited yield shared among active learners', icon: Coins, color: '#9945FF', gated: true },
  { id: 'notice', route: '/leaderboard', label: 'Leaderboard', desc: 'Top learners by streak and XP', icon: Trophy, color: '#2AE8D4', gated: true },
];

export function MobileHub() {
  const router = useRouter();
  const { isAuthenticated, ensureFreshSession, markFreshLogin } = useAuth();
  const { login } = useLogin();

  const promptConnect = async () => {
    await ensureFreshSession();
    markFreshLogin();
    login({ loginMethods: ['google', 'wallet'] });
  };

  const go = (d: Dest) => {
    if (d.gated && !isAuthenticated) {
      void promptConnect();
      return;
    }
    router.push(d.route);
  };

  return (
    <div className="min-h-[100dvh]" style={{ backgroundColor: T.bg }}>
      {/* Banner — the painting, cropped short, with a fade into the page. */}
      <div className="relative h-44 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/village/village-painted.png"
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full select-none pointer-events-none"
          style={{ objectFit: 'cover', imageRendering: 'pixelated' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(180deg, rgba(6,6,12,0.15) 0%, rgba(6,6,12,0.55) 55%, ${T.bg} 100%)` }}
        />
        <div className="absolute bottom-3 left-5 right-5 flex items-end justify-between">
          <h1
            className="font-pixel text-2xl tracking-wide"
            style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
          >
            The Village
          </h1>
          {!isAuthenticated && (
            <button
              onClick={promptConnect}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border font-pixel-mono text-[11px] uppercase tracking-[1px] min-h-[40px]"
              style={{ borderColor: 'rgba(255,213,128,0.5)', backgroundColor: 'rgba(255,213,128,0.14)', color: COZY_TEXT }}
            >
              <Wallet size={13} /> Connect
            </button>
          )}
        </div>
      </div>

      {/* Destination cards */}
      <div className="px-4 pb-10 -mt-2 flex flex-col gap-3">
        {DESTS.map((d) => {
          const locked = d.gated && !isAuthenticated;
          const Icon = d.icon;
          return (
            <button key={d.id} onClick={() => go(d)} className="w-full text-left" aria-label={d.label}>
              <CozyCard className="w-full" style={{ padding: 16 }}>
                <div className="flex items-center gap-3.5">
                  <div
                    className="flex items-center justify-center rounded-xl shrink-0"
                    style={{ width: 44, height: 44, backgroundColor: `${d.color}1F`, border: `1px solid ${d.color}55` }}
                  >
                    <Icon size={20} color={d.color} strokeWidth={2.4} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-pixel text-[15px]" style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}>
                      {d.label}
                    </p>
                    <p className="font-pixel-mono text-[11px] mt-0.5 truncate" style={{ color: T.textMutedStrong }}>
                      {locked ? 'Connect your wallet to open' : d.desc}
                    </p>
                  </div>
                  <ChevronRight size={20} color={T.textMuted} />
                </div>
              </CozyCard>
            </button>
          );
        })}
      </div>
    </div>
  );
}

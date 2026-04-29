'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { NAV_ITEMS, type NavGroup } from './NavIcons';
import { useCourseStore } from '@/stores/courseStore';

const GROUP_LABELS: Record<NavGroup, string> = {
  learn: 'Learn',
  economy: 'Economy',
  social: 'Social',
};

const GROUP_ORDER: NavGroup[] = ['learn', 'economy', 'social'];

export function Sidebar() {
  const pathname = usePathname();
  const { isAuthenticated, walletAddress } = useAuth();
  const currentStreak = useCourseStore((s) => s.getStreak());

  if (!isAuthenticated) return null;

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : '';

  // Group items
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    items: NAV_ITEMS.filter((item) => item.group === group),
  }));

  return (
    <nav
      className="fixed left-0 top-0 bottom-0 w-[240px] hidden md:flex flex-col z-20"
      style={{
        background: 'linear-gradient(180deg, #09090f 0%, #0c0c16 100%)',
        borderRight: '1px solid rgba(212,160,74,0.08)',
      }}
    >
      {/* Logo area */}
      <div
        className="flex flex-col items-center px-5 pt-5 pb-4"
        style={{ borderBottom: '1px solid rgba(212,160,74,0.06)' }}
      >
        <Link
          href="/village"
          className="text-[14px] font-bold tracking-[5px] uppercase"
          style={{
            background: 'linear-gradient(180deg, #D4A04A, #8B6914)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          LOCKED-IN
        </Link>

        {/* SVG diamond ornament */}
        <svg width={120} height={12} viewBox="0 0 120 12" className="mt-2">
          <line x1="0" y1="6" x2="50" y2="6" stroke="rgba(212,160,74,0.2)" strokeWidth="1" />
          <polygon points="60,2 64,6 60,10 56,6" fill="rgba(212,160,74,0.3)" />
          <line x1="70" y1="6" x2="120" y2="6" stroke="rgba(212,160,74,0.2)" strokeWidth="1" />
        </svg>

        {/* Streak badge */}
        {currentStreak > 0 && (
          <div
            className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-xl"
            style={{
              background: 'rgba(212,160,74,0.10)',
              border: '1px solid rgba(212,160,74,0.15)',
            }}
          >
            <span className="text-xs">🔥</span>
            <span
              className="font-mono text-[10px]"
              style={{ color: '#D4A04A' }}
            >
              {currentStreak} day streak
            </span>
          </div>
        )}
      </div>

      {/* Grouped navigation */}
      <div className="flex-1 py-1 overflow-y-auto">
        {grouped.map((section, sectionIdx) => (
          <div key={section.group}>
            {/* Group label */}
            <p
              className="font-mono text-[8px] font-bold uppercase tracking-[3px] px-5 pt-4 pb-1.5"
              style={{ color: 'rgba(212,160,74,0.15)' }}
            >
              {section.label}
            </p>

            {/* Items */}
            {section.items.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + '/');

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className="group flex items-center gap-3 px-5 py-2.5 text-[13px] relative transition-colors duration-150"
                  style={{
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    color: isActive ? '#D4A04A' : 'rgba(255,255,255,0.35)',
                  }}
                >
                  {/* Active: vertical amber light bar */}
                  {isActive && (
                    <span
                      className="absolute left-0 top-0 bottom-0 w-[2px]"
                      style={{
                        background: 'linear-gradient(180deg, transparent, #D4A04A, transparent)',
                      }}
                    />
                  )}
                  {/* Active: background wash */}
                  {isActive && (
                    <span
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: 'linear-gradient(90deg, rgba(212,160,74,0.06) 0%, transparent 60%)',
                      }}
                    />
                  )}
                  <span className="relative z-[1]">
                    <item.icon
                      color={isActive ? '#D4A04A' : 'rgba(255,255,255,0.25)'}
                      size={20}
                    />
                  </span>
                  <span className="relative z-[1] group-hover:text-[rgba(255,255,255,0.55)] transition-colors duration-150">
                    {item.label}
                  </span>
                  {item.isNew && (
                    <span className="font-mono text-[7px] uppercase tracking-[1px] relative z-[1]" style={{ color: '#3EE68A' }}>
                      new
                    </span>
                  )}
                </Link>
              );
            })}

            {/* Divider between groups (not after last) */}
            {sectionIdx < grouped.length - 1 && (
              <div
                className="h-px mx-5 my-1.5"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(212,160,74,0.08), transparent)',
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Wallet address footer */}
      <div
        className="px-5 py-3.5 text-center font-mono text-[10px] tracking-[1px]"
        style={{
          borderTop: '1px solid rgba(212,160,74,0.06)',
          color: 'rgba(212,160,74,0.18)',
        }}
      >
        {shortAddress}
      </div>
    </nav>
  );
}

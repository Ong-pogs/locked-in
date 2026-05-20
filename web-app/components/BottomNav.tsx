'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BOTTOM_NAV_ITEMS } from './NavIcons';
import { T } from './theme';

/** Mobile bottom tab bar — visible only on <768px, hidden on desktop where sidebar shows */
export function BottomNav() {
  const pathname = usePathname();

  // Hide on immersive/focused routes
  if (
    pathname.startsWith('/village') ||
    pathname.startsWith('/lessons/')
  ) {
    return null;
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 md:hidden border-t"
      style={{
        backgroundColor: T.bg,
        borderColor: T.borderDormant,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="flex justify-around items-center">
        {BOTTOM_NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className="flex flex-col items-center gap-0.5 py-3 px-1 flex-1 transition-colors"
              style={{
                backgroundColor: isActive ? `${T.amber}15` : 'transparent',
                color: isActive ? T.amber : T.textSecondary,
              }}
            >
              <item.icon
                color={isActive ? T.amber : 'rgba(255,255,255,0.35)'}
                size={20}
              />
              <span className="font-mono text-[10px]">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

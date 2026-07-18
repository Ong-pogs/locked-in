'use client';

import { COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';

// Shield pips: 3 slots, filled = savers banked. Each pip is a hand-drawn
// pixel-art shield on a 12×14 grid — lighter gold rim, darker amber field,
// tiny top-left glint. A spent saver renders as a dark empty socket (dim
// outline only) so the loss reads instantly on the dark card.

const SHIELD_CAP = 3;

// 12×14 pixel map. R = rim, F = field, H = highlight, . = transparent.
const SHIELD_ROWS = [
  '..RRRRRRRR..',
  '.RFFFFFFFFR.',
  'RFHHFFFFFFFR',
  'RFHFFFFFFFFR',
  'RFFFFFFFFFFR',
  'RFFFFFFFFFFR',
  'RFFFFFFFFFFR',
  'RFFFFFFFFFFR',
  '.RFFFFFFFFR.',
  '.RFFFFFFFFR.',
  '..RFFFFFFR..',
  '...RFFFFR...',
  '....RFFR....',
  '.....RR.....',
] as const;

// Collapse the pixel map into one SVG path per layer (each grid cell becomes a
// 1×1 square subpath) so a shield is 2-3 <path> nodes instead of ~130 <rect>s.
function pixelPath(kinds: string): string {
  let d = '';
  SHIELD_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (kinds.includes(row.charAt(x))) d += `M${x} ${y}h1v1h-1z`;
    }
  });
  return d;
}

const RIM_PATH = pixelPath('R');
const FIELD_PATH = pixelPath('F');
const HIGHLIGHT_PATH = pixelPath('H');
const SOCKET_PATH = pixelPath('FH'); // empty slot: interior is one dark socket

const PIP_GLOW = 'drop-shadow(0 0 3px rgba(255, 213, 128, 0.55))';

function PixelShield({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 12 14"
      width={14}
      height={16}
      shapeRendering="crispEdges"
      aria-hidden
      className="shrink-0 select-none"
      style={filled ? { filter: PIP_GLOW } : undefined}
    >
      {filled ? (
        <>
          <path d={FIELD_PATH} fill="#B07A2E" />
          <path d={HIGHLIGHT_PATH} fill="#FFF1C4" />
          <path d={RIM_PATH} fill="#FFD580" />
        </>
      ) : (
        <>
          <path d={SOCKET_PATH} fill="rgba(8, 10, 22, 0.5)" />
          <path d={RIM_PATH} fill="rgba(255, 213, 128, 0.28)" />
        </>
      )}
    </svg>
  );
}

export function ShieldPips({ shields, className = '' }: { shields: number; className?: string }) {
  const banked = Math.max(0, Math.min(SHIELD_CAP, Number(shields) || 0));
  const label = `Savers: ${banked} of ${SHIELD_CAP}`;
  return (
    <div
      data-testid="v2-shield-pips"
      data-shields={banked}
      className={`flex items-center gap-1 ${className}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {Array.from({ length: SHIELD_CAP }, (_, i) => (
        <PixelShield key={i} filled={i < banked} />
      ))}
      <span
        aria-hidden
        className="font-pixel-mono text-[10px] ml-1"
        style={{ color: COZY_TEXT, opacity: 0.75, textShadow: COZY_TEXT_SHADOW }}
      >
        ×{banked}
      </span>
    </div>
  );
}

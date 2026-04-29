'use client';

import { useRouter } from 'next/navigation';

export type Bounds = {
  /** Normalized 0-1 from left edge */
  x: number;
  /** Normalized 0-1 from top edge */
  y: number;
  /** Normalized 0-1 width */
  w: number;
  /** Normalized 0-1 height */
  h: number;
};

export type BuildingHotspotProps = {
  id: string;
  route: string;
  label: string;
  bounds: Bounds;
  /** Optional override invoked instead of router.push (e.g. Academy → BookModal) */
  onPeek?: () => void;
};

/**
 * Single absolutely-positioned hotspot button on the village scene.
 *
 * Slice 1: Renders a visible debug rectangle so we can validate placement
 * before the painterly art lands in Slice 2.
 */
export function BuildingHotspot({
  id,
  route,
  label,
  bounds,
  onPeek,
}: BuildingHotspotProps) {
  const router = useRouter();

  const handleClick = () => {
    if (onPeek) {
      onPeek();
      return;
    }
    router.push(route);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      data-hotspot-id={id}
      className="absolute flex items-center justify-center rounded-md transition-colors duration-150 bg-[rgba(212,160,74,0.30)] hover:bg-[rgba(212,160,74,0.50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      style={{
        left: `${bounds.x * 100}%`,
        top: `${bounds.y * 100}%`,
        width: `${bounds.w * 100}%`,
        height: `${bounds.h * 100}%`,
        border: '1px solid rgba(212,160,74,0.6)',
      }}
    >
      <span
        className="text-sm font-bold uppercase tracking-[2px] text-center px-2"
        style={{
          fontFamily: 'Georgia, serif',
          color: '#1A1000',
          textShadow: '0 1px 0 rgba(212,160,74,0.5)',
        }}
      >
        {label}
      </span>
    </button>
  );
}

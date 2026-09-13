'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { T } from '../../components/theme';

export interface StakeableCourse {
  id: string;
  title: string;
  /** Yield this course keeps today, as a percentage (100, 50 or 0). */
  keptPct: number;
}

/**
 * Course picker for the stake panel.
 *
 * A native <select> renders its options with the OS, so on this dark pixel
 * theme it dropped a white list with a blue Windows highlight into the middle
 * of the page — and it could only show the course id, which is what the user
 * saw ("blockchain-wallets"). This is a listbox instead: themed, showing real
 * titles, and showing what each course currently stands to lose.
 */
export function CourseSelect({
  courses,
  value,
  onChange,
  disabled = false,
}: {
  courses: StakeableCourse[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const selected = courses.find((c) => c.id === value) ?? null;

  // Close on an outside click or Escape — a listbox left open over the page is
  // worse than a native select, not better.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = useCallback((id: string) => {
    onChange(id);
    setOpen(false);
  }, [onChange]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || courses.length === 0) return;
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setOpen(true);
      setActive(Math.max(0, courses.findIndex((c) => c.id === value)));
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, courses.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(courses[active].id); }
  };

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        data-testid="arena-stake-course"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || courses.length === 0}
        onClick={() => { setOpen((o) => !o); setActive(Math.max(0, courses.findIndex((c) => c.id === value))); }}
        onKeyDown={onKeyDown}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-40"
        style={{
          background: T.bgCardActive,
          border: `1px solid ${selected ? T.borderAlive : T.borderDormant}`,
          color: selected ? T.textPrimary : T.textMuted,
        }}
      >
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {selected ? selected.title : 'Choose a locked course…'}
        </span>
        {selected && (
          <span
            className="shrink-0 font-pixel-mono text-[10px]"
            style={{ color: selected.keptPct === 100 ? T.green : T.rust }}
          >
            {selected.keptPct}% yield
          </span>
        )}
        <ChevronDown size={15} style={{ color: T.textMuted }} aria-hidden />
      </button>

      {open && courses.length > 0 && (
        <ul
          role="listbox"
          data-testid="arena-stake-course-list"
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg py-1"
          style={{
            background: '#0E0E1C',
            border: `1px solid ${T.borderAlive}`,
            boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
          }}
        >
          {courses.map((c, i) => {
            const isSel = c.id === value;
            return (
              <li key={c.id} role="option" aria-selected={isSel}>
                <button
                  type="button"
                  onClick={() => pick(c.id)}
                  onMouseEnter={() => setActive(i)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
                  style={{
                    background: i === active ? 'rgba(212,160,74,0.12)' : 'transparent',
                    color: T.textPrimary,
                  }}
                >
                  <Check
                    size={13}
                    aria-hidden
                    style={{ color: T.amber, opacity: isSel ? 1 : 0 }}
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
                  <span
                    className="shrink-0 font-pixel-mono text-[10px]"
                    style={{ color: c.keptPct === 100 ? T.green : T.rust }}
                  >
                    {c.keptPct}% yield
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

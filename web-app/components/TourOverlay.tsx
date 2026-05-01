'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T } from './theme';

// ---------------------------------------------------------------------------
// Tour step definitions
// ---------------------------------------------------------------------------
interface TourStep {
  objectId: string;
  icon: string;
  title: string;
  description: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    objectId: 'bookshelf',
    icon: '\u{1F4DA}',
    title: 'The Bookshelf',
    description:
      'Your course library. Tap to browse courses, track progress, and start your next lesson.',
  },
  {
    objectId: 'oil_lamp_center',
    icon: '\u{1F525}',
    title: 'The Oil Lamps',
    description:
      'Your streak savers. Complete one lesson and all three light up \u2014 miss a day and you lose one. Run out, and your streak resets.',
  },
  {
    objectId: 'old_chest',
    icon: '\u{1F4E6}',
    title: 'The Chest',
    description:
      'Your inventory. Check fuel balance, Ichor reserves, and saver count at a glance.',
  },
  {
    objectId: 'alchemy_table',
    icon: '\u2697',
    title: 'The Alchemy Table',
    description:
      'Brew fuel into Ichor here. Ichor can be claimed as USDC once your lock period ends. Fuel is earned from lessons.',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface TourOverlayProps {
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
  onMessage: (handler: (data: Record<string, unknown>) => void) => () => void;
  onComplete: () => void;
}

export function TourOverlay({ sendMessage, onMessage, onComplete }: TourOverlayProps) {
  const [step, setStep] = useState(0);
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  // Listen for tourScreenPos messages from the dungeon engine
  useEffect(() => {
    return onMessage((data) => {
      if (data.type === 'tourScreenPos') {
        const payload = data.payload as { x: number; y: number } | undefined;
        if (payload) {
          setScreenPos({ x: payload.x, y: payload.y });
        }
      }
    });
  }, [onMessage]);

  // Init highlight layer + highlight first object
  useEffect(() => {
    sendMessage('tourInit', {});
    // Small delay to let HighlightLayer initialise
    const t = setTimeout(() => {
      sendMessage('tourHighlight', { objectId: TOUR_STEPS[0].objectId });
      setReady(true);
    }, 200);
    return () => {
      clearTimeout(t);
      // If the user closes the tour without finishing (e.g. via the back button),
      // the dungeon scene would otherwise keep the highlight + pulse running.
      sendMessage('tourClearHighlight', {});
    };
  }, [sendMessage]);

  // Highlight the current step's object whenever step changes
  useEffect(() => {
    if (!ready) return;
    sendMessage('tourClearHighlight', {});
    // Brief pause so clear renders before new highlight
    const t = setTimeout(() => {
      sendMessage('tourHighlight', { objectId: current.objectId });
    }, 80);
    return () => clearTimeout(t);
  }, [step, ready, current.objectId, sendMessage]);

  const handleNext = useCallback(() => {
    if (isLast) {
      sendMessage('tourClearHighlight', {});
      onComplete();
    } else {
      setScreenPos(null); // reset so bubble doesn't flash at old position
      setStep((s) => s + 1);
    }
  }, [isLast, sendMessage, onComplete]);

  const handleSkip = useCallback(() => {
    sendMessage('tourClearHighlight', {});
    onComplete();
  }, [sendMessage, onComplete]);

  // Compute bubble position from normalised screen coords
  const bubbleStyle = computeBubbleStyle(screenPos);
  const arrowSide = screenPos && screenPos.x > 0.5 ? 'right' : 'left';

  return (
    <div className="fixed inset-0 z-50">
      {/* Dim backdrop */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={handleNext}
      />

      {/* Tooltip bubble */}
      <AnimatePresence mode="wait">
        {screenPos && (
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="fixed z-50"
            style={bubbleStyle}
          >
            <div
              className="relative w-[310px] rounded-[14px] border p-5"
              style={{
                background: 'rgba(14,14,28,0.96)',
                borderColor: `${T.amber}59`,
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,160,74,0.1)',
              }}
            >
              {/* Arrow */}
              <div
                className="absolute w-2.5 h-2.5 rotate-45"
                style={{
                  background: 'rgba(14,14,28,0.96)',
                  borderColor: `${T.amber}59`,
                  top: 28,
                  ...(arrowSide === 'left'
                    ? { left: -6, borderLeft: '1px solid', borderBottom: '1px solid' }
                    : { right: -6, borderRight: '1px solid', borderTop: '1px solid' }),
                }}
              />

              {/* Step dots */}
              <div className="flex gap-[5px] mb-3">
                {TOUR_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className="h-1.5 rounded-[3px] transition-all duration-300"
                    style={{
                      width: i === step ? 20 : 6,
                      background:
                        i === step
                          ? T.amber
                          : i < step
                            ? `${T.amber}59`
                            : 'rgba(255,255,255,0.1)',
                    }}
                  />
                ))}
              </div>

              {/* Header */}
              <div className="flex items-center gap-2.5 mb-2.5">
                <div
                  className="w-[38px] h-[38px] rounded-[10px] border flex items-center justify-center text-[22px]"
                  style={{
                    background: `${T.amber}1a`,
                    borderColor: `${T.amber}2e`,
                  }}
                >
                  {current.icon}
                </div>
                <div>
                  <p
                    className="font-mono text-[9.5px] font-semibold uppercase tracking-[1.2px]"
                    style={{ color: `${T.amber}8c` }}
                  >
                    Step {step + 1} of {TOUR_STEPS.length}
                  </p>
                  <p
                    className="text-[16px] font-bold"
                    style={{ fontFamily: 'Georgia, serif', color: '#F0E6D3' }}
                  >
                    {current.title}
                  </p>
                </div>
              </div>

              {/* Description */}
              <p
                className="text-[13px] leading-[1.55] mb-4"
                style={{ color: 'rgba(240,230,211,0.65)' }}
              >
                {current.description}
              </p>

              {/* Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleSkip}
                  className="px-3.5 py-2 rounded-[7px] border font-mono text-[10.5px] font-semibold tracking-[0.5px] transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: 'rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.35)',
                  }}
                >
                  Skip
                </button>
                <button
                  onClick={handleNext}
                  className="flex-1 py-2 rounded-[7px] border text-center transition-colors hover:bg-[#E8B860]"
                  style={{
                    background: T.amber,
                    borderColor: '#E8B860',
                    fontFamily: 'Georgia, serif',
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: '#1A1000',
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  {isLast ? 'Get Started' : 'Next'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert normalised (0–1) screen coords to CSS position for the tooltip. */
function computeBubbleStyle(pos: { x: number; y: number } | null): React.CSSProperties {
  if (!pos) return { display: 'none' };

  const BUBBLE_W = 310;
  const GAP = 24; // px gap between object and bubble edge

  // Object is on the right half → place bubble to the left
  // Object is on the left half → place bubble to the right
  const objPxX = pos.x * window.innerWidth;
  const objPxY = pos.y * window.innerHeight;

  let left: number;
  if (pos.x > 0.5) {
    // Bubble to the left of the object
    left = objPxX - BUBBLE_W - GAP;
  } else {
    // Bubble to the right of the object
    left = objPxX + GAP;
  }

  // Vertically: align bubble's arrow (28px from top) with object center
  let top = objPxY - 28;

  // Clamp to viewport
  left = Math.max(12, Math.min(left, window.innerWidth - BUBBLE_W - 12));
  top = Math.max(12, Math.min(top, window.innerHeight - 280));

  return { left, top };
}

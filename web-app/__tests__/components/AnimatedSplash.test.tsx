import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedSplash } from '@/components/AnimatedSplash';

function stubReducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderSplash() {
  return render(
    <AnimatedSplash>
      <main data-testid="splash-children">App content</main>
    </AnimatedSplash>,
  );
}

describe('AnimatedSplash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    stubReducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the overlay on a first visit and records the session', () => {
    renderSplash();

    expect(screen.getByTestId('animated-splash')).toBeInTheDocument();
    expect(sessionStorage.getItem('splash-shown')).toBe('1');
    expect(screen.getByTestId('splash-children')).toBeInTheDocument();
  });

  it('skips the overlay when it has already shown this session', () => {
    sessionStorage.setItem('splash-shown', '1');

    renderSplash();

    expect(screen.queryByTestId('animated-splash')).not.toBeInTheDocument();
    expect(screen.getByTestId('splash-children')).toBeInTheDocument();
  });

  it('skips the overlay when reduced motion is preferred', () => {
    stubReducedMotion(true);

    renderSplash();

    expect(screen.queryByTestId('animated-splash')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('splash-shown')).toBeNull();
    expect(screen.getByTestId('splash-children')).toBeInTheDocument();
  });

  it('removes the overlay by the hard animation deadline', () => {
    renderSplash();

    act(() => {
      vi.advanceTimersByTime(3200);
    });

    expect(screen.queryByTestId('animated-splash')).not.toBeInTheDocument();
  });

  it('never lets the overlay intercept pointer input', () => {
    renderSplash();

    expect(screen.getByTestId('animated-splash')).toHaveStyle({ pointerEvents: 'none' });
  });

  it('keeps children rendered before and after the overlay is removed', () => {
    renderSplash();

    expect(screen.getByTestId('splash-children')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3200);
    });

    expect(screen.getByTestId('splash-children')).toBeInTheDocument();
  });
});

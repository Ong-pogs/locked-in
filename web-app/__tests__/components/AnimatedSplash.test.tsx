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

// Off-main-thread path: the canvas goes to a worker, which draws and reports back.
describe('AnimatedSplash worker path', () => {
  class FakeWorker {
    static last: FakeWorker | null = null;
    messages: Array<{ type: string; canvas?: unknown }> = [];
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    constructor() {
      FakeWorker.last = this;
    }
    postMessage(message: { type: string }) {
      this.messages.push(message);
    }
    terminate() {
      this.terminated = true;
    }
    // Lets a test answer as if it were the worker.
    reply(data: unknown) {
      act(() => this.onmessage?.({ data } as MessageEvent));
    }
  }
  const offscreen = { fake: 'offscreen' };

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    stubReducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal('Worker', FakeWorker);
    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      configurable: true,
      value: vi.fn(() => offscreen),
    });
    FakeWorker.last = null;
  });

  afterEach(() => {
    delete (HTMLCanvasElement.prototype as { transferControlToOffscreen?: unknown }).transferControlToOffscreen;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hands the canvas to a worker instead of drawing on the main thread', () => {
    renderSplash();

    const worker = FakeWorker.last;
    expect(worker).not.toBeNull();
    expect(worker?.messages[0]).toMatchObject({ type: 'start', canvas: offscreen });
  });

  it('removes the overlay when the worker reports the animation is done', () => {
    const { unmount } = renderSplash();
    const worker = FakeWorker.last!;

    worker.reply({ type: 'ready' });
    expect(screen.getByTestId('animated-splash')).toHaveStyle({ background: 'transparent' });

    worker.reply({ type: 'done' });
    expect(screen.queryByTestId('animated-splash')).not.toBeInTheDocument();
    expect(worker.terminated).toBe(true);
    unmount();
  });

  it('falls back to the main thread if the worker fails to start', () => {
    renderSplash();
    const worker = FakeWorker.last!;

    act(() => worker.onerror?.());
    expect(worker.terminated).toBe(true);
    expect(screen.getByTestId('animated-splash')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(screen.queryByTestId('animated-splash')).not.toBeInTheDocument();
  });
});

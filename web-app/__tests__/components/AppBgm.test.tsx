import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AppBgm } from '@/components/AppBgm';
import {
  APP_BGM_DEFAULT_VOLUME,
  APP_BGM_SRC,
  APP_BGM_VOLUME_EVENT,
  APP_BGM_VOLUME_STORAGE_KEY,
} from '@/components/appBgmSettings';

const { pathnameState } = vi.hoisted(() => ({
  pathnameState: { value: '/dashboard' },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameState.value,
}));

const audioInstances: MockAudio[] = [];

class MockAudio {
  src: string;
  loop = false;
  volume = 1;
  currentTime = 0;
  play = vi.fn<() => Promise<void>>(() => Promise.resolve());
  pause = vi.fn();

  constructor(src: string) {
    this.src = src;
    audioInstances.push(this);
  }
}

describe('AppBgm', () => {
  beforeEach(() => {
    audioInstances.length = 0;
    pathnameState.value = '/dashboard';
    localStorage.clear();
    vi.stubGlobal('Audio', MockAudio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts looping app music when mounted', () => {
    render(<AppBgm />);

    const audio = audioInstances[0];
    expect(audio.src).toBe(APP_BGM_SRC);
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBe(APP_BGM_DEFAULT_VOLUME);
    expect(audio.volume).toBe(0.0875);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('uses a stored music volume on mount', () => {
    localStorage.setItem(APP_BGM_VOLUME_STORAGE_KEY, '0.42');

    render(<AppBgm />);

    expect(audioInstances[0].volume).toBe(0.42);
  });

  it('uses lesson music at half the stored base volume on lesson routes', () => {
    pathnameState.value = '/lessons/sf-2';
    localStorage.setItem(APP_BGM_VOLUME_STORAGE_KEY, '0.08');

    render(<AppBgm />);

    expect(audioInstances[0].src).toBe('/bgm/Peak_Resistance.mp3');
    expect(audioInstances[0].volume).toBe(0.04);
  });

  it('keeps app music at full stored volume outside lesson routes', () => {
    pathnameState.value = '/dashboard';
    localStorage.setItem(APP_BGM_VOLUME_STORAGE_KEY, '0.08');

    render(<AppBgm />);

    expect(audioInstances[0].src).toBe(APP_BGM_SRC);
    expect(audioInstances[0].volume).toBe(0.08);
  });

  it('updates the active audio volume when the dashboard dispatches a volume event', () => {
    render(<AppBgm />);

    window.dispatchEvent(
      new CustomEvent(APP_BGM_VOLUME_EVENT, {
        detail: { volume: 0.23 },
      }),
    );

    expect(audioInstances[0].volume).toBe(0.23);
  });

  it('applies lesson volume scaling to live dashboard volume changes', () => {
    pathnameState.value = '/lessons/sf-2';
    render(<AppBgm />);

    window.dispatchEvent(
      new CustomEvent(APP_BGM_VOLUME_EVENT, {
        detail: { volume: 0.42 },
      }),
    );

    expect(audioInstances[0].volume).toBe(0.21);
  });

  it('switches from app music to lesson music when the route changes', () => {
    const { rerender } = render(<AppBgm />);
    const appAudio = audioInstances[0];

    pathnameState.value = '/lessons/sf-2';
    rerender(<AppBgm />);

    expect(appAudio.pause).toHaveBeenCalledTimes(1);
    expect(appAudio.currentTime).toBe(0);
    expect(audioInstances[1].src).toBe('/bgm/Peak_Resistance.mp3');
    expect(audioInstances[1].volume).toBe(APP_BGM_DEFAULT_VOLUME * 0.5);
  });

  it('falls back to the first user gesture when autoplay is blocked', async () => {
    const blockedAudio = new MockAudio('/blocked.mp3');
    blockedAudio.play.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'));
    vi.stubGlobal(
      'Audio',
      vi.fn(function Audio() {
        return blockedAudio;
      }),
    );

    render(<AppBgm />);
    await Promise.resolve();

    expect(blockedAudio.play).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();

    expect(blockedAudio.play).toHaveBeenCalledTimes(2);
  });

  it('pauses music and removes gesture listeners on unmount', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<AppBgm />);

    const audio = audioInstances[0];
    unmount();

    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(0);
    expect(removeListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(removeListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});

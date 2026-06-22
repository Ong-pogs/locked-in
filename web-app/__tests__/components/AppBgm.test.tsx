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

  it('updates the active audio volume when the dashboard dispatches a volume event', () => {
    render(<AppBgm />);

    window.dispatchEvent(
      new CustomEvent(APP_BGM_VOLUME_EVENT, {
        detail: { volume: 0.23 },
      }),
    );

    expect(audioInstances[0].volume).toBe(0.23);
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

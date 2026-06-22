'use client';

import { useEffect } from 'react';
import {
  APP_BGM_SRC,
  APP_BGM_VOLUME_EVENT,
  clampAppBgmVolume,
  readStoredAppBgmVolume,
  type AppBgmVolumeChangeDetail,
} from './appBgmSettings';

/**
 * App-wide background music.
 *
 * Browsers usually block audible autoplay until the first user gesture, so
 * this tries immediately and then falls back to the first pointer/key event.
 */
export function AppBgm() {
  useEffect(() => {
    const bgm = new Audio(APP_BGM_SRC);
    bgm.loop = true;
    bgm.volume = readStoredAppBgmVolume();

    let disposed = false;

    const applyVolume = (event?: Event) => {
      const eventVolume = (event as CustomEvent<AppBgmVolumeChangeDetail> | undefined)?.detail
        ?.volume;
      bgm.volume =
        typeof eventVolume === 'number'
          ? clampAppBgmVolume(eventVolume)
          : readStoredAppBgmVolume();
    };

    const removeGestureFallback = () => {
      window.removeEventListener('pointerdown', playAfterGesture);
      window.removeEventListener('keydown', playAfterGesture);
    };

    const tryPlay = async () => {
      try {
        await bgm.play();
        removeGestureFallback();
      } catch {
        if (!disposed) {
          window.addEventListener('pointerdown', playAfterGesture, { once: true });
          window.addEventListener('keydown', playAfterGesture, { once: true });
        }
      }
    };

    const playAfterGesture = () => {
      void tryPlay();
    };

    void tryPlay();
    window.addEventListener(APP_BGM_VOLUME_EVENT, applyVolume);

    return () => {
      disposed = true;
      window.removeEventListener(APP_BGM_VOLUME_EVENT, applyVolume);
      removeGestureFallback();
      bgm.pause();
      bgm.currentTime = 0;
    };
  }, []);

  return null;
}

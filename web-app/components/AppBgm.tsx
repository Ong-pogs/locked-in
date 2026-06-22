'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  APP_BGM_VOLUME_EVENT,
  clampAppBgmVolume,
  getAppBgmTrack,
  getScaledAppBgmVolume,
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
  const pathname = usePathname();
  const { src, volumeScale } = getAppBgmTrack(pathname);

  useEffect(() => {
    const bgm = new Audio(src);
    bgm.loop = true;
    bgm.volume = getScaledAppBgmVolume(readStoredAppBgmVolume(), volumeScale);

    let disposed = false;

    const applyVolume = (event?: Event) => {
      const eventVolume = (event as CustomEvent<AppBgmVolumeChangeDetail> | undefined)?.detail
        ?.volume;
      const baseVolume =
        typeof eventVolume === 'number'
          ? clampAppBgmVolume(eventVolume)
          : readStoredAppBgmVolume();
      bgm.volume = getScaledAppBgmVolume(baseVolume, volumeScale);
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
  }, [src, volumeScale]);

  return null;
}

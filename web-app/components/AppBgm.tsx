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
 *
 * The track (3-4 MB) is not preloaded: it only downloads once playback is
 * actually allowed, and never while the player has music muted (volume 0).
 */
export function AppBgm() {
  const pathname = usePathname();
  const { src, volumeScale } = getAppBgmTrack(pathname);

  useEffect(() => {
    // preload is set before src so the browser never starts a speculative
    // download; play() fetches the track when it is really needed.
    const bgm = new Audio();
    bgm.preload = 'none';
    bgm.src = src;
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
      // Unmuting a never-started player starts it (it was skipped while muted).
      if (bgm.volume > 0 && bgm.paused) void tryPlay();
    };

    const removeGestureFallback = () => {
      window.removeEventListener('pointerdown', playAfterGesture);
      window.removeEventListener('keydown', playAfterGesture);
    };

    const tryPlay = async () => {
      // Muted: do not play, so the track is not downloaded at all.
      if (bgm.volume === 0) return;
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

export const APP_BGM_SRC = '/bgm/Midnight_in_the_Scriptorium.mp3';
export const APP_BGM_DEFAULT_VOLUME = 0.0875;
export const APP_BGM_VOLUME_STORAGE_KEY = 'locked-in:bgm-volume';
export const APP_BGM_PREVIOUS_VOLUME_STORAGE_KEY = 'locked-in:bgm-previous-volume';
export const APP_BGM_VOLUME_EVENT = 'locked-in:bgm-volume-change';

export type AppBgmVolumeChangeDetail = {
  volume: number;
};

export function clampAppBgmVolume(volume: number): number {
  if (!Number.isFinite(volume)) return APP_BGM_DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, volume));
}

export function readStoredAppBgmVolume(): number {
  if (typeof window === 'undefined') return APP_BGM_DEFAULT_VOLUME;

  try {
    const stored = window.localStorage.getItem(APP_BGM_VOLUME_STORAGE_KEY);
    if (stored === null) return APP_BGM_DEFAULT_VOLUME;
    return clampAppBgmVolume(Number(stored));
  } catch {
    return APP_BGM_DEFAULT_VOLUME;
  }
}

export function readStoredPreviousAppBgmVolume(): number {
  if (typeof window === 'undefined') return APP_BGM_DEFAULT_VOLUME;

  try {
    const stored = window.localStorage.getItem(APP_BGM_PREVIOUS_VOLUME_STORAGE_KEY);
    const volume = stored === null ? APP_BGM_DEFAULT_VOLUME : clampAppBgmVolume(Number(stored));
    return volume > 0 ? volume : APP_BGM_DEFAULT_VOLUME;
  } catch {
    return APP_BGM_DEFAULT_VOLUME;
  }
}

function writeStoredPreviousAppBgmVolume(volume: number) {
  if (typeof window === 'undefined') return;
  const previousVolume = clampAppBgmVolume(volume);
  if (previousVolume <= 0) return;

  try {
    window.localStorage.setItem(APP_BGM_PREVIOUS_VOLUME_STORAGE_KEY, String(previousVolume));
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
  }
}

export function writeStoredAppBgmVolume(volume: number): number {
  const nextVolume = clampAppBgmVolume(volume);

  if (typeof window === 'undefined') return nextVolume;

  try {
    window.localStorage.setItem(APP_BGM_VOLUME_STORAGE_KEY, String(nextVolume));
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
  }

  if (nextVolume > 0) {
    writeStoredPreviousAppBgmVolume(nextVolume);
  }

  window.dispatchEvent(
    new CustomEvent<AppBgmVolumeChangeDetail>(APP_BGM_VOLUME_EVENT, {
      detail: { volume: nextVolume },
    }),
  );

  return nextVolume;
}

export function muteStoredAppBgmVolume(currentVolume: number): number {
  writeStoredPreviousAppBgmVolume(currentVolume);
  return writeStoredAppBgmVolume(0);
}

export function unmuteStoredAppBgmVolume(): number {
  return writeStoredAppBgmVolume(readStoredPreviousAppBgmVolume());
}

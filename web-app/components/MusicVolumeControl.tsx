'use client';

import { useSyncExternalStore } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { CozyCard } from './cozy';
import { T } from './theme';
import {
  APP_BGM_DEFAULT_VOLUME,
  APP_BGM_VOLUME_EVENT,
  muteStoredAppBgmVolume,
  readStoredAppBgmVolume,
  unmuteStoredAppBgmVolume,
  writeStoredAppBgmVolume,
} from './appBgmSettings';

const AMBER = '#FFD580';

function toPercent(volume: number): number {
  return Math.round(volume * 100);
}

function subscribeToVolumeChanges(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {};

  window.addEventListener(APP_BGM_VOLUME_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);

  return () => {
    window.removeEventListener(APP_BGM_VOLUME_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

export function MusicVolumeControl() {
  const volume = useSyncExternalStore(
    subscribeToVolumeChanges,
    readStoredAppBgmVolume,
    () => APP_BGM_DEFAULT_VOLUME,
  );
  const percent = toPercent(volume);
  const Icon = percent === 0 ? VolumeX : Volume2;
  const isMuted = percent === 0;

  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextVolume = Number(event.target.value) / 100;
    writeStoredAppBgmVolume(nextVolume);
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      unmuteStoredAppBgmVolume();
    } else {
      muteStoredAppBgmVolume(volume);
    }
  };

  return (
    <CozyCard className="mb-5" style={{ padding: 18 }}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={handleMuteToggle}
            aria-label={isMuted ? 'Unmute music' : 'Mute music'}
            className="flex items-center justify-center rounded-xl shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            style={{
              width: 36,
              height: 36,
              backgroundColor: 'rgba(255,213,128,0.10)',
              border: `1px solid ${AMBER}40`,
            }}
          >
            <Icon size={18} color={AMBER} strokeWidth={2.4} />
          </button>
          <p
            className="font-pixel-mono text-[10px] font-bold uppercase tracking-[2px]"
            style={{ color: AMBER, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
          >
            Music Volume
          </p>
        </div>
        <span
          className="font-pixel-mono text-[12px] font-bold"
          style={{ color: T.textSecondary }}
        >
          {percent}%
        </span>
      </div>

      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={percent}
        onChange={handleVolumeChange}
        aria-label="Music volume"
        className="block w-full cursor-pointer"
        style={{ accentColor: AMBER }}
      />
    </CozyCard>
  );
}

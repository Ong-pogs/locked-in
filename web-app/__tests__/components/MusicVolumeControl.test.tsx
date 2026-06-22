import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicVolumeControl } from '@/components/MusicVolumeControl';
import {
  APP_BGM_DEFAULT_VOLUME,
  APP_BGM_PREVIOUS_VOLUME_STORAGE_KEY,
  APP_BGM_VOLUME_EVENT,
  APP_BGM_VOLUME_STORAGE_KEY,
} from '@/components/appBgmSettings';

describe('MusicVolumeControl', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the default music volume as a percent', () => {
    render(<MusicVolumeControl />);

    expect(screen.getByRole('slider', { name: /music volume/i })).toHaveValue(
      String(Math.round(APP_BGM_DEFAULT_VOLUME * 100)),
    );
    expect(screen.getByText('9%')).toBeInTheDocument();
  });

  it('initializes from localStorage when a saved volume exists', () => {
    localStorage.setItem(APP_BGM_VOLUME_STORAGE_KEY, '0.25');

    render(<MusicVolumeControl />);

    expect(screen.getByRole('slider', { name: /music volume/i })).toHaveValue('25');
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('writes volume changes to localStorage and broadcasts them', () => {
    const listener = vi.fn();
    window.addEventListener(APP_BGM_VOLUME_EVENT, listener);

    render(<MusicVolumeControl />);
    fireEvent.change(screen.getByRole('slider', { name: /music volume/i }), {
      target: { value: '42' },
    });

    expect(localStorage.getItem(APP_BGM_VOLUME_STORAGE_KEY)).toBe('0.42');
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent<{ volume: number }>).detail.volume).toBe(
      0.42,
    );

    window.removeEventListener(APP_BGM_VOLUME_EVENT, listener);
  });

  it('mutes when the volume icon is clicked', () => {
    localStorage.setItem(APP_BGM_VOLUME_STORAGE_KEY, '0.42');
    const listener = vi.fn();
    window.addEventListener(APP_BGM_VOLUME_EVENT, listener);

    render(<MusicVolumeControl />);
    fireEvent.click(screen.getByRole('button', { name: /mute music/i }));

    expect(screen.getByRole('slider', { name: /music volume/i })).toHaveValue('0');
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(localStorage.getItem(APP_BGM_VOLUME_STORAGE_KEY)).toBe('0');
    expect(localStorage.getItem(APP_BGM_PREVIOUS_VOLUME_STORAGE_KEY)).toBe('0.42');
    expect((listener.mock.calls[0][0] as CustomEvent<{ volume: number }>).detail.volume).toBe(0);

    window.removeEventListener(APP_BGM_VOLUME_EVENT, listener);
  });

  it('unmutes to the last non-zero volume when the muted icon is clicked', () => {
    localStorage.setItem(APP_BGM_VOLUME_STORAGE_KEY, '0');
    localStorage.setItem(APP_BGM_PREVIOUS_VOLUME_STORAGE_KEY, '0.42');
    const listener = vi.fn();
    window.addEventListener(APP_BGM_VOLUME_EVENT, listener);

    render(<MusicVolumeControl />);
    fireEvent.click(screen.getByRole('button', { name: /unmute music/i }));

    expect(screen.getByRole('slider', { name: /music volume/i })).toHaveValue('42');
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(localStorage.getItem(APP_BGM_VOLUME_STORAGE_KEY)).toBe('0.42');
    expect((listener.mock.calls[0][0] as CustomEvent<{ volume: number }>).detail.volume).toBe(
      0.42,
    );

    window.removeEventListener(APP_BGM_VOLUME_EVENT, listener);
  });
});

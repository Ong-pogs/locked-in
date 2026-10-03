'use client';

import { useSyncExternalStore } from 'react';

let now: number | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      now = null;
    }
  };
}

// Cache the snapshot between ticks and share one clock across all timestamps.
const getSnapshot = () => now;
const getServerSnapshot = () => null;
const utcDate = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export default function ActivityTime({ at }: { at: string }) {
  const clock = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const absolute = `${utcDate.format(new Date(at))} UTC`;
  let label = absolute;

  if (clock !== null) {
    const minutes = Math.max(0, Math.floor((clock - Date.parse(at)) / 60_000));
    if (minutes < 1) label = 'just now';
    else if (minutes < 60) label = `${minutes} min ago`;
    else if (minutes < 1_440) label = `${Math.floor(minutes / 60)} h ago`;
    else label = `${Math.floor(minutes / 1_440)} d ago`;
  }

  return <time dateTime={at} title={absolute}>{label}</time>;
}

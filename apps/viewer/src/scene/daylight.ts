import { useEffect, useState } from 'react';

/** Real-time day/night cycle: sky palette + light levels per dagdeel. */

export interface Daylight {
  period: 'night' | 'dawn' | 'day' | 'dusk';
  /** Gradient stops zenith → horizon. */
  stops: [string, string, string, string];
  ambient: number;
  directional: number;
  lightColor: string;
  fogColor: string;
}

const PALETTES: Record<Daylight['period'], Omit<Daylight, 'period'>> = {
  night: {
    stops: ['#0b1026', '#18224a', '#2c3a5c', '#3b4a6b'],
    ambient: 0.3,
    directional: 0.5,
    lightColor: '#9db8ff',
    fogColor: '#2c3a5c',
  },
  dawn: {
    stops: ['#2b3a67', '#7a6a9e', '#e8927c', '#f6c89f'],
    ambient: 0.5,
    directional: 1.1,
    lightColor: '#ffe8cf',
    fogColor: '#e8b9a0',
  },
  day: {
    stops: ['#2f6fca', '#6fa8dc', '#a8cbe8', '#e6f2fb'],
    ambient: 0.6,
    directional: 1.3,
    lightColor: '#fff6e8',
    fogColor: '#c9dcee',
  },
  dusk: {
    stops: ['#232b52', '#5d4a7e', '#d97b5f', '#e8b56b'],
    ambient: 0.45,
    directional: 0.9,
    lightColor: '#ffd9b0',
    fogColor: '#c99a86',
  },
};

export function periodForHour(hour: number): Daylight['period'] {
  if (hour >= 22 || hour < 6) return 'night';
  if (hour < 9) return 'dawn';
  if (hour < 17) return 'day';
  return 'dusk';
}

/** ?time=day|night|dawn|dusk forceert het palet (demo's, screenshots). */
const FORCED: Daylight['period'] | null = (() => {
  try {
    const value = new URLSearchParams(location.search).get('time');
    return value === 'day' || value === 'night' || value === 'dawn' || value === 'dusk'
      ? value
      : null;
  } catch {
    return null;
  }
})();

export function useDaylight(): Daylight {
  const [period, setPeriod] = useState<Daylight['period']>(
    () => FORCED ?? periodForHour(new Date().getHours()),
  );
  useEffect(() => {
    if (FORCED) return;
    const timer = setInterval(
      () => setPeriod(periodForHour(new Date().getHours())),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);
  return { period, ...PALETTES[period] };
}

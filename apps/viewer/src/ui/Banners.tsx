import { useEffect, useRef, useState } from 'react';
import { useAra } from '../store.ts';

export function ReconnectBanner(): JSX.Element | null {
  const connected = useAra((s) => s.connected);
  if (connected) return null;
  return <div className="banner">Reconnecting to collector…</div>;
}

/** Amber screen pulse + optional beep when a session needs the human. */
export function NudgePulse(): JSX.Element | null {
  const effects = useAra((s) => s.effects);
  const soundOn = useAra((s) => s.soundOn);
  const [pulse, setPulse] = useState(false);
  const lastNudge = useRef<string | null>(null);

  useEffect(() => {
    const nudge = effects.find((e) => e.type === 'nudge');
    if (!nudge || nudge.id === lastNudge.current) return;
    lastNudge.current = nudge.id;
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 700);
    if (soundOn) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 660;
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
        osc.onended = () => void ctx.close();
      } catch {
        /* autoplay blocked */
      }
    }
    return () => clearTimeout(timer);
  }, [effects, soundOn]);

  return pulse ? <div className="pulse" /> : null;
}

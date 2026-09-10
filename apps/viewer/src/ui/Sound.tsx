import { useEffect, useRef } from 'react';
import { useAra } from '../store.ts';

/**
 * Geluidsontwerp (alles achter de bestaande 🔔-toggle):
 *  - taak/sessie afgerond → warme twee-noten chime
 *  - tool-fout → zachte lage plof
 *  - needsHuman-toon zit al in Banners (NudgePulse)
 * Efficiënt: één gedeelde AudioContext, geen samples, alleen oscillators.
 */

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, gainPeak: number, type: OscillatorType = 'sine'): void {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, a.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(gainPeak, a.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + duration);
  osc.connect(gain).connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + duration + 0.05);
}

export function playChime(): void {
  tone(523.25, 0, 0.35, 0.08); // C5
  tone(783.99, 0.12, 0.5, 0.07); // G5
}

export function playError(): void {
  tone(140, 0, 0.22, 0.06, 'triangle');
  tone(110, 0.05, 0.25, 0.05, 'triangle');
}

/** Luistert naar effects en speelt de bijbehorende klank (max 1 per 400ms). */
export function SoundPlayer(): null {
  const effects = useAra((s) => s.effects);
  const soundOn = useAra((s) => s.soundOn);
  const played = useRef(new Set<string>());
  const lastAt = useRef(0);

  useEffect(() => {
    if (!soundOn) return;
    const now = Date.now();
    for (const effect of effects) {
      if (played.current.has(effect.id) || now - effect.ts > 1000) continue;
      played.current.add(effect.id);
      if (now - lastAt.current < 400) continue; // niet ratelen
      if (effect.type === 'flag' || effect.type === 'confetti') {
        playChime();
        lastAt.current = now;
      } else if (effect.type === 'smoke') {
        playError();
        lastAt.current = now;
      }
    }
    if (played.current.size > 200) played.current.clear();
  }, [effects, soundOn]);

  return null;
}

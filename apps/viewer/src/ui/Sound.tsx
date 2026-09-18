import { useEffect, useRef } from 'react';
import { useAra, type EffectType } from '../store.ts';

/**
 * Hoorbare statuslaag.
 *
 * Waarom dit bestaat: de wereld draait 24/7 op een Mac en de eigenaar kijkt er
 * niet constant naar. Geluid is dan het enige kanaal dat werkt terwijl je iets
 * anders doet — mits het informatie draagt. Daarom vier herkenbare stemmen en
 * verder stilte; een klank voor elke gebeurtenis is geen informatie maar ruis.
 *
 *   vraag  (alert)  stijgend, helder, tweemaal  → er wacht iemand op jou
 *   fout   (fault)  dalend, donker, gefilterd   → er ging iets stuk
 *   klaar  (done)   korte warme twee-noot       → werk af
 *   herstel(relief) één zacht opwaarts blipje   → het loopt weer
 *
 * Stijgend vraagt, dalend meldt schade: dat verschil is het hele punt — je moet
 * zonder kijken weten of je nú moet opstaan.
 *
 * Alles synthetisch (oscillatoren + envelopes): dit project haalt geen assets
 * op, ook geen samples. Eén mp3 zou die regel breken.
 */

type Voice = 'alert' | 'fault' | 'done' | 'relief';

/**
 * Welke wereld-effecten hoorbaar zijn. Bewust kort: sparkle/paper/bolt/morph/
 * storm zijn het normale geroezemoes van een werkende sessie — die voeden de
 * omgevingslaag hieronder in plaats van een eigen toon te krijgen.
 */
const VOICE_BY_EFFECT: Partial<Record<EffectType, Voice>> = {
  nudge: 'alert', // notification: de sessie vraagt om een mens
  gate: 'alert', // permission.ask: wacht op akkoord
  smoke: 'fault', // tool-fout
  deny: 'fault', // permissie geweigerd
  flag: 'done', // taak af
  confetti: 'done', // taak/sessie af
  repair: 'relief', // eerste geslaagde tool na een fout
};

/** Prioriteit binnen één tick: een vraag verdringt een afgeronde taak. */
const RANK: Record<Voice, number> = { alert: 3, fault: 2, done: 1, relief: 0 };

/**
 * Minimale rust per stem. Dit is de eerste rem tegen ratelen: tien voltooide
 * taken in één seconde blijven één bevestiging.
 */
const COOLDOWN_MS: Record<Voice, number> = {
  alert: 6_000,
  fault: 2_500,
  done: 1_400,
  relief: 2_500,
};

/** Tweede rem: hooguit 5 tonen per 8 seconden. 'alert' telt mee maar mag erdoor. */
const BUDGET_WINDOW_MS = 8_000;
const BUDGET_MAX = 5;

/** Herinnering zolang er iemand wacht — anders mist een escalatie die je net niet hoorde. */
const REMINDER_MS = 5 * 60_000;

/** Effecten ouder dan dit zijn geschiedenis; die halen we niet alsnog op. */
const FRESH_MS = 1_500;

/** Nacht: 23:00–07:00 lokaal. Alleen urgent, en zachter. */
function isNight(): boolean {
  const h = new Date().getHours();
  return h >= 23 || h < 7;
}

/** 's Nachts mag je wakker worden van een storing, niet van een afgevinkte taak. */
function nightAllows(voice: Voice): boolean {
  return voice === 'alert' || voice === 'fault';
}

interface Engine {
  ctx: AudioContext;
  master: GainNode;
  ambient: { gain: GainNode; stop: () => void } | null;
}

let engine: Engine | null = null;

/**
 * De AudioContext ontstaat pas bij de eerste klik van de gebruiker. Een context
 * die vóór die tijd wordt aangemaakt komt 'suspended' uit de fabriek en logt bij
 * elke resume een autoplay-waarschuwing; erger nog, alles wat je er intussen in
 * plant klinkt alsnog zodra hij losgaat — precies het opgespaarde salvo dat je
 * niet wilt.
 */
function ensureEngine(): Engine | null {
  if (engine) return engine;
  try {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    // Compressor omdat tonen kunnen overlappen; zonder deze wordt een dubbele
    // melding hard in plaats van luid.
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    engine = { ctx, master, ambient: null };
    return engine;
  } catch {
    return null; // geen WebAudio: de wereld werkt verder gewoon door
  }
}

interface PingOpts {
  freq: number;
  to?: number;
  at: number;
  dur: number;
  peak: number;
  type?: OscillatorType;
  cutoff?: number;
}

function ping(e: Engine, o: PingOpts): void {
  const t0 = e.ctx.currentTime + o.at;
  const osc = e.ctx.createOscillator();
  const gain = e.ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
  // Exponentieel naar ~0: setValueAtTime(0) mag niet in een exponentiële ramp,
  // en een lineaire uitdoving klinkt als een klik.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(o.peak, 0.0002), t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  let tail: AudioNode = gain;
  if (o.cutoff) {
    const filter = e.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = o.cutoff;
    gain.connect(filter);
    tail = filter;
  }
  osc.connect(gain);
  tail.connect(e.master);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.06);
  osc.onended = () => {
    // Opruimen is hier geen nettigheid maar noodzaak: dit draait maanden achter
    // elkaar, en losgekoppelde nodes stapelen anders op.
    try {
      osc.disconnect();
      gain.disconnect();
      tail.disconnect();
    } catch {
      /* al opgeruimd */
    }
  };
}

function speak(voice: Voice, loud: number): void {
  const e = ensureEngine();
  if (!e) return;
  switch (voice) {
    case 'alert':
      // Stijgende kwart, tweemaal: de vorm van een vraag, en herhaling maakt 'm
      // herkenbaar door een gesprek of muziek heen.
      ping(e, { freq: 784, to: 1046, at: 0, dur: 0.16, peak: 0.075 * loud, type: 'triangle' });
      ping(e, { freq: 784, to: 1175, at: 0.26, dur: 0.26, peak: 0.08 * loud, type: 'triangle' });
      break;
    case 'fault':
      // Dalend en donker, met een lowpass erover: zelfs zacht hoor je dat dit
      // geen vraag is.
      ping(e, { freq: 320, to: 150, at: 0, dur: 0.3, peak: 0.07 * loud, type: 'sawtooth', cutoff: 900 });
      ping(e, { freq: 96, at: 0.04, dur: 0.34, peak: 0.055 * loud, type: 'sine' });
      break;
    case 'done':
      // Kort en warm; dit hoor je vaak, dus het mag nooit om aandacht vragen.
      ping(e, { freq: 784, at: 0, dur: 0.22, peak: 0.045 * loud });
      ping(e, { freq: 1175, at: 0.1, dur: 0.34, peak: 0.035 * loud });
      break;
    case 'relief':
      ping(e, { freq: 620, to: 880, at: 0, dur: 0.18, peak: 0.03 * loud });
      break;
  }
}

/**
 * Omgevingslaag: een zachte drone die met de drukte meeschaalt. Nut zit in het
 * omgekeerde — als er niets draait is het écht stil, en dat hoor je aan de
 * afwezigheid zonder ergens naar te kijken.
 */
function startAmbient(e: Engine): void {
  if (e.ambient) return;
  const gain = e.ctx.createGain();
  gain.gain.value = 0.0001;
  const filter = e.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 340;
  const base = e.ctx.createOscillator();
  base.type = 'sine';
  base.frequency.value = 110;
  const fifth = e.ctx.createOscillator();
  fifth.type = 'sine';
  fifth.frequency.value = 164.8;
  fifth.detune.value = 6; // lichte zweving: een exacte kwint klinkt als een pieptoon
  // Trage LFO op de filter, anders wordt een uren durende drone vermoeiend.
  const lfo = e.ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = e.ctx.createGain();
  lfoGain.gain.value = 90;
  lfo.connect(lfoGain).connect(filter.frequency);
  base.connect(filter);
  fifth.connect(filter);
  filter.connect(gain).connect(e.master);
  base.start();
  fifth.start();
  lfo.start();
  e.ambient = {
    gain,
    stop: () => {
      try {
        base.stop();
        fifth.stop();
        lfo.stop();
        base.disconnect();
        fifth.disconnect();
        lfo.disconnect();
        lfoGain.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        /* al gestopt */
      }
    },
  };
}

function stopAmbient(e: Engine): void {
  if (!e.ambient) return;
  e.ambient.stop();
  e.ambient = null;
}

function shutdown(): void {
  if (!engine) return;
  stopAmbient(engine);
  // Suspend en niet close: de gebruiker kan de knop zo weer aanzetten, en een
  // nieuwe context per klik vreet handles. Dit draait 24/7.
  void engine.ctx.suspend().catch(() => {});
}

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/** Luistert naar de wereld en vertaalt die naar de vier stemmen. */
export function SoundPlayer(): null {
  const effects = useAra((s) => s.effects);
  const soundOn = useAra((s) => s.soundOn);
  const snapshot = useAra((s) => s.snapshot);

  const unlocked = useRef(false);
  const seen = useRef(new Set<string>());
  const primed = useRef(false);
  const lastVoiceAt = useRef<Record<Voice, number>>({ alert: 0, fault: 0, done: 0, relief: 0 });
  const budget = useRef<number[]>([]);
  const prevNeedsHuman = useRef<number | null>(null);
  const lastReminderAt = useRef(0);
  const recentActivity = useRef<number[]>([]);
  const soundOnRef = useRef(soundOn);
  const snapshotRef = useRef(snapshot);
  soundOnRef.current = soundOn;
  snapshotRef.current = snapshot;

  /** Eén poort voor alle geluid: uit staat uit, en de rem zit hier. */
  const emit = useRef((voice: Voice) => {
    if (!soundOnRef.current || !unlocked.current) return;
    const night = isNight();
    if (night && !nightAllows(voice)) return;
    const now = Date.now();
    if (now - lastVoiceAt.current[voice] < COOLDOWN_MS[voice]) return;
    budget.current = budget.current.filter((t) => now - t < BUDGET_WINDOW_MS);
    // Een vraag mag door het budget heen: liever één toon te veel dan een
    // escalatie die je niet hoort omdat er net veel gebeurde.
    if (voice !== 'alert' && budget.current.length >= BUDGET_MAX) return;
    budget.current.push(now);
    lastVoiceAt.current[voice] = now;
    speak(voice, night ? 0.45 : 1);
  });

  // Ontgrendelen op de eerste echte interactie. De ⇅-knop in de balk is zelf al
  // zo'n klik, dus wie geluid aanzet hoort meteen het eerstvolgende event.
  useEffect(() => {
    if (!soundOn || unlocked.current) return;
    const unlock = (): void => {
      if (unlocked.current) return;
      unlocked.current = true;
      const e = ensureEngine();
      if (e) void e.ctx.resume().catch(() => {});
    };
    // Heeft de gebruiker deze pagina al aangeraakt (bv. toggle vóór mount), dan
    // is er niets te wachten.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } })
      .userActivation;
    if (activation?.hasBeenActive) unlock();
    for (const type of UNLOCK_EVENTS) {
      window.addEventListener(type, unlock, { passive: true, capture: true });
    }
    return () => {
      for (const type of UNLOCK_EVENTS) {
        window.removeEventListener(type, unlock, { capture: true } as EventListenerOptions);
      }
    };
  }, [soundOn]);

  // Aan/uit. Uit betekent ook echt stil: drone weg, context geparkeerd.
  useEffect(() => {
    if (!soundOn) {
      primed.current = false;
      shutdown();
      return;
    }
    const e = ensureEngine();
    if (e && unlocked.current) void e.ctx.resume().catch(() => {});
  }, [soundOn]);

  // Effecten → stemmen. Per tick klinkt alleen de zwaarste: twintig events in
  // één seconde zijn één mededeling, geen machinegeweer.
  useEffect(() => {
    const now = Date.now();
    let best: Voice | null = null;
    for (const effect of effects) {
      if (seen.current.has(effect.id)) continue;
      seen.current.add(effect.id);
      recentActivity.current.push(effect.ts);
      // Alles wat al in de store stond toen het geluid aanging is verleden tijd
      // (primed): anders barst er bij het aanzetten een backlog los.
      if (!primed.current || now - effect.ts > FRESH_MS) continue;
      const voice = VOICE_BY_EFFECT[effect.type];
      if (voice && (!best || RANK[voice] > RANK[best])) best = voice;
    }
    if (seen.current.size > 400) seen.current.clear();
    primed.current = primed.current || soundOn;
    if (best) emit.current(best);
  }, [effects, soundOn]);

  // De teller uit de snapshot is de tweede bron voor een vraag: een escalatie
  // die via een herstelde verbinding of hydrate binnenkomt heeft geen effect-rij,
  // maar wacht wél op een mens.
  useEffect(() => {
    const count = snapshot.counters.needsHuman;
    const prev = prevNeedsHuman.current;
    prevNeedsHuman.current = count;
    if (prev === null) return; // eerste meting is de nulstand, geen nieuws
    if (count > prev) emit.current('alert');
  }, [snapshot]);

  // Trage lus: drone bijregelen en blijven herinneren zolang er iemand wacht.
  useEffect(() => {
    if (!soundOn) return;
    const tick = (): void => {
      const now = Date.now();
      recentActivity.current = recentActivity.current.filter((t) => now - t < 20_000);
      const e = engine;
      if (e && unlocked.current) {
        const running = Object.values(snapshotRef.current.sessions).filter(
          (s) => s.status === 'working',
        ).length;
        const drukte = Math.max(
          Math.min(1, running / 5),
          Math.min(1, recentActivity.current.length / 14),
        );
        // 's Nachts geen sfeerlaag: dan hoort alleen het urgente geluid te klinken.
        const target = isNight() || drukte <= 0 ? 0 : 0.006 + 0.016 * drukte;
        if (target > 0) startAmbient(e);
        if (e.ambient) {
          // setTargetAtTime i.p.v. een harde sprong: de drukte schommelt, en een
          // springende drone leidt meer af dan hij vertelt.
          e.ambient.gain.gain.setTargetAtTime(Math.max(target, 0.00001), e.ctx.currentTime, 2.5);
          if (target === 0 && e.ambient.gain.gain.value < 0.0005) stopAmbient(e);
        }
      }
      if (
        snapshotRef.current.counters.needsHuman > 0 &&
        now - lastReminderAt.current > REMINDER_MS
      ) {
        lastReminderAt.current = now;
        emit.current('alert');
      }
    };
    const id = window.setInterval(tick, 2_000);
    return () => window.clearInterval(id);
  }, [soundOn]);

  // Tab weg? Niets stoppen — juist dán is geluid het enige kanaal. Wel opruimen
  // bij unmount, zodat een hot reload geen tweede drone achterlaat.
  useEffect(() => () => shutdown(), []);

  return null;
}

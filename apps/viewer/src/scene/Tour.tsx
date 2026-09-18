import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, type WorldConfig } from '@ara/shared';
import { useAra } from '../store.ts';
import { HEX_SPACING } from '../placements.ts';

/**
 * De regisseur: één klein postvakje tussen Tour en CameraRig.
 *
 * De rondleiding weet wélk district aan de beurt is, maar niets over de
 * camera (ortho-zoom, kantelhoek, dempingsconstanten) — dat hoort op één plek
 * te staan, in CameraRig, anders bewegen twee bestanden dezelfde camera en
 * lopen ze onvermijdelijk uit elkaar. Tour schrijft dus alleen een wéns op;
 * CameraRig beslist of en hoe hij die inwilligt.
 *
 * Bewust een gewoon object en geen store: dit wordt elke frame gelezen en
 * geschreven, en een state-update per frame zou de hele React-boom opnieuw
 * laten renderen voor iets dat niemand op het scherm als tekst ziet.
 */
export interface CameraDirective {
  /** Waar de camera naartoe wil kijken, of null wanneer de automaat niets wil. */
  target: THREE.Vector3 | null;
  /** Dempingstijd in seconden: groter = trager en filmischer. */
  smoothing: number;
  /** Zoomdoel als factor van de rustzoom (null = zoom niet aanraken). */
  zoomScale: number | null;
  /** Radialen per seconde om het doel heen (0 = stilstaan). */
  orbit: number;
  /**
   * Laatste échte invoer op de wereld zelf (slepen/scrollen in de 3D-canvas).
   * CameraRig schrijft, Tour leest. Klikken in de UI telt niet mee: een
   * paneel openen is geen camerabesturing.
   */
  lastUserInput: number;
}

export const director: CameraDirective = {
  target: null,
  smoothing: 0.9,
  zoomScale: null,
  orbit: 0,
  lastUserInput: 0,
};

/** Alles losmaken zodat CameraRig meteen weer op zichzelf staat. */
function release(): void {
  director.target = null;
  director.zoomScale = null;
  director.orbit = 0;
}

export interface TourProps {
  /** Wereldindeling; zonder prop pakt Tour hem zelf uit de store. */
  world?: WorldConfig | null;
  /** Forceert aan/uit; zonder prop beslist `?tour=` in de URL. */
  enabled?: boolean;
  /** Hoe lang de camera bij een district blijft hangen (ms). */
  holdMs?: number;
  /** Hoe lang de reis naar het volgende district duurt (ms). */
  travelMs?: number;
  /**
   * Na hoeveel rust de rondleiding zichzelf weer oppakt (ms; 0 = nooit).
   * Standaard nooit: wie de muis pakt wil zelf kijken, en een camera die na
   * een halve minuut alsnog wegloopt is precies de camera die tegenwerkt.
   * `?tour=kiosk` is de uitzondering — een scherm aan de muur waar niemand
   * bij staat mag wél weer gaan lopen.
   */
  resumeAfterMs?: number;
}

const HUB = new THREE.Vector3(0, 0, 0);
const KIOSK_RESUME_MS = 90_000;

/**
 * Automatische rondleiding: van hub naar district naar district, met een pauze
 * (en een trage draai) bij elke halte.
 *
 * Aanzetten met `?tour=1`, of `?tour=kiosk` voor een muurscherm. Stopt bij de
 * eerste muisbeweging die iets doet — pointerdown of scrollwiel, waar dan ook
 * op de pagina. Dat is ruimer dan alleen de canvas met opzet: wie een paneel
 * opendoet is aan het werk, en dan hoort de camera niet verder te wandelen.
 */
export function Tour({
  world: worldProp,
  enabled,
  holdMs = 7000,
  travelMs = 4500,
  resumeAfterMs,
}: TourProps = {}): null {
  const worldFromStore = useAra((s) => s.world);
  const world = worldProp ?? worldFromStore;

  const mode = useMemo(() => new URLSearchParams(location.search).get('tour'), []);
  const wanted = enabled ?? (mode === '1' || mode === 'on' || mode === 'kiosk');
  const resumeMs = resumeAfterMs ?? (mode === 'kiosk' ? KIOSK_RESUME_MS : 0);

  /**
   * De haltes. De hub voorop als openingsshot, daarna de districten in de
   * volgorde waarin de wereld ze aanlegt — die is deterministisch, dus twee
   * schermen naast elkaar lopen dezelfde route.
   */
  const stops = useMemo(() => {
    const list = [HUB.clone()];
    if (!world) return list;
    // Districten zonder projecten zijn lege grond; die overslaan zolang er
    // iets bewoonds te zien is.
    const districts = world.districts.filter((d) => d.projects.length > 0);
    for (const district of districts.length ? districts : world.districts) {
      const { x, z } = axialToWorld(district.center);
      list.push(new THREE.Vector3(x * HEX_SPACING, 0, z * HEX_SPACING));
    }
    return list;
  }, [world]);

  const index = useRef(0);
  const elapsed = useRef(0);
  const holding = useRef(false);
  const stoppedAt = useRef<number | null>(null);

  // Gebruikersinvoer stopt de rondleiding. Losse listener op window in plaats
  // van de camera-controls: de gebruiker kan ook met de UI bezig zijn.
  useEffect(() => {
    if (!wanted) return undefined;
    const stop = (): void => {
      stoppedAt.current = Date.now();
      release();
    };
    window.addEventListener('pointerdown', stop, { passive: true });
    window.addEventListener('wheel', stop, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', stop);
      window.removeEventListener('wheel', stop);
      release();
    };
  }, [wanted]);

  useFrame((_, delta) => {
    if (!wanted || stops.length === 0) {
      if (director.target) release();
      return;
    }

    // Ook slepen in de wereld zelf telt als "ik kijk zelf wel": CameraRig
    // stempelt dat hier af, zodat er maar één definitie van invoer is.
    if (director.lastUserInput > (stoppedAt.current ?? 0)) stoppedAt.current = director.lastUserInput;

    if (stoppedAt.current !== null) {
      if (resumeMs <= 0 || Date.now() - stoppedAt.current < resumeMs) {
        if (director.target) release();
        return;
      }
      // Weer opgepakt: vanaf de hub, anders val je midden in een halte.
      stoppedAt.current = null;
      index.current = 0;
      elapsed.current = 0;
      holding.current = false;
    }

    // Tijd tellen met delta i.p.v. de wandklok: staat de scene stil (kantoor
    // open, tabblad op de achtergrond), dan staat de rondleiding ook stil.
    elapsed.current += delta * 1000;
    const limit = holding.current ? holdMs : travelMs;
    if (elapsed.current >= limit) {
      elapsed.current = 0;
      if (holding.current) index.current = (index.current + 1) % stops.length;
      holding.current = !holding.current;
    }

    director.target = stops[index.current % stops.length] ?? HUB;
    if (holding.current) {
      // Blijven hangen: iets dichterbij en een trage draai om de halte heen,
      // zodat een stilstaand beeld toch leeft.
      director.smoothing = 0.8;
      director.zoomScale = 1.3;
      director.orbit = 0.07;
    } else {
      // Onderweg juist wat uitzoomen: je ziet waar je vandaan komt en waar je
      // heen gaat, in plaats van een reeks losse close-ups.
      director.smoothing = 1.1;
      director.zoomScale = 0.95;
      director.orbit = 0;
    }
  });

  return null;
}

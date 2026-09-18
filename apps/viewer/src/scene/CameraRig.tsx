import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import { damp, damp3 } from 'maath/easing';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { useAra, type CameraView, type GroundPoint } from '../store.ts';
import { HEX_SPACING, projectPlacement, sessionPosition } from '../placements.ts';
import { WORLD_HEX_RADIUS, axialToWorld, type WorldConfig, type WorldSnapshot } from '@ara/shared';
import { director } from './Tour.tsx';

const ISO_OFFSET = new THREE.Vector3(14, 16, 14); // ~30° isometric tilt
const IDLE_DRIFT_AFTER_MS = 8000;

/**
 * Hoeveel wereld er in beeld hoort te passen. Onder een ortho-camera is
 * zoom = pixels per wereldeenheid, dus een vaste zoom betekent: op een groot
 * scherm zie je meer wereld, op een klein scherm een postzegel. De wereld is
 * een schijf van WORLD_HEX_RADIUS hexen. 2,6× die straal in beeld
 * zet je in de wereld in plaats van erboven: de districten zijn leesbaar en je
 * ziet nog steeds waar ze ten opzichte van elkaar liggen. Uitzoomen kan altijd
 * met de muis; het startbeeld hoort het beeld te zijn waar je iets aan hebt.
 */
// 2,6× was te strak: de buitenste districten vielen buiten beeld. De schijf
// meet ongeveer 1,85 wereldeenheid per hex in de breedte, dus 3,4× straal laat
// de hele wereld zien met de districten nog steeds leesbaar groot.
//
// Dit blijft het *rustbeeld* — het eerste dat je ziet hoort de hele wereld te
// zijn. Het zoombereik eromheen is een andere vraag en staat hieronder.
const WORLD_UNITS_IN_VIEW = WORLD_HEX_RADIUS * 3.4;
const MIN_ZOOM = 13;
const MAX_ZOOM = 56;

/**
 * Het plafond van de handmatige zoom: ooghoogte tussen de gebouwen.
 *
 * 140 hield je op dakhoogte hangen — je kon inzoomen op een district maar
 * nooit de straat ín. Bij ~220 past er nog een handvol hexen op het scherm en
 * sta je dus tussen de bebouwing. Dat werkt alleen samen met de kanteling
 * hieronder: recht van boven op een straat kijken toont daken, geen straat.
 */
const STREET_ZOOM = 220;

/** Rigide ophanging: de camera hangt altijd op deze afstand van zijn doelpunt. */
const RIG_RADIUS = ISO_OFFSET.length();
const ISO_PHI = Math.acos(ISO_OFFSET.y / RIG_RADIUS);
/** Laagste blik; net binnen de maxPolarAngle van de controls, anders klemt die 'm terug. */
const STREET_PHI = Math.PI / 2.62;
/** Vanaf deze zoom begint de camera te kantelen (factor van de rustzoom). */
const TILT_FROM = 1.35;
/** Bij deze zoom (factor van STREET_ZOOM) is de blik volledig op ooghoogte. */
const TILT_FULL = 0.8;

/** Zwenk naar een escalatie: eerst een korte terugtrek, dan de duw naar binnen. */
const SHOT_PULL_SEC = 0.55;
const SHOT_PUSH_SEC = 2.8;
const SHOT_PULL_ZOOM = 0.78;
const SHOT_PUSH_ZOOM = 2.2;
/** Rondje om het district na een afgeronde taak. */
const CIRCLE_SEC = 7;
const CIRCLE_SPEED = 0.22; // rad/s — een kwartslag in zeven tellen
const CIRCLE_ZOOM = 1.25;
/**
 * Hoe vaak een shot hoogstens mag beginnen. Op een drukke dag komen er tien
 * meldingen per minuut, en een camera die bij elke melding opnieuw wegzwenkt
 * is geen film maar een zwabber — dan kun je niks meer volgen. Een afgeronde
 * taak mag langer wachten dan een mens die klaarstaat.
 */
const SHOT_COOLDOWN_MS = { push: 8000, circle: 20_000 };
/** Tijdlapse: het terugkijken draait langzaam om het midden van de wereld. */
const REPLAY_SPEED = 0.07;
/** De tijdlapse pakt de camera pas terug na deze rust — zie de reden hieronder. */
const REPLAY_IDLE_MS = 6000;

/**
 * Hoe lang de gebruiker met rust gelaten moet zijn voordat de automaat weer
 * mag sturen. Een zwenk die begint terwijl iemand nog aan het kijken is voelt
 * als tegenwerken; twee en een halve seconde is lang genoeg om te merken dat
 * de hand van de muis is.
 */
const AUTO_IDLE_MS = 2500;

const ORIGIN = new THREE.Vector3(0, 0, 0);
// Kladvectoren op moduleniveau: dit draait 60× per seconde, en een nieuwe
// Vector3 per frame is werk voor de garbage collector, niet voor de camera.
const _offset = new THREE.Vector3();
const _right = new THREE.Vector3();
const _goalOffset = new THREE.Vector3();
const _spherical = new THREE.Spherical();

function fitZoom(width: number, height: number): number {
  const base = Math.min(width, height) / WORLD_UNITS_IN_VIEW;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base));
}

/**
 * Kantelhoek bij een gegeven zoom. Van boven af zie je de wereld als kaart;
 * hoe dichter je erin zit, hoe meer je tussen de gebouwen door wilt kijken.
 * smoothstep zodat het scrollwiel geen knik in de beweging zet.
 */
function tiltForZoom(zoom: number, restZoom: number): number {
  const from = restZoom * TILT_FROM;
  const to = Math.max(from + 1, STREET_ZOOM * TILT_FULL);
  return ISO_PHI + (STREET_PHI - ISO_PHI) * THREE.MathUtils.smoothstep(zoom, from, to);
}

/** Waar de pod van een sessie staat (zelfde rekensom als de wereld zelf gebruikt). */
function sessionWorldPos(
  world: WorldConfig | null,
  snapshot: WorldSnapshot,
  sessionId: string,
): THREE.Vector3 | null {
  const session = world ? snapshot.sessions[sessionId] : undefined;
  if (!world || !session) return null;
  const siblings = Object.values(snapshot.sessions)
    .filter((s) => s.project === session.project)
    .sort((a, b) => a.startedAt - b.startedAt);
  const index = Math.max(0, siblings.findIndex((s) => s.sessionId === session.sessionId));
  const { x, z } = sessionPosition(world, session, index);
  return new THREE.Vector3(x, 0, z);
}

/** Het hart van het district waar een sessie bij hoort — het middelpunt van een rondje. */
function districtWorldPos(
  world: WorldConfig | null,
  snapshot: WorldSnapshot,
  sessionId: string,
): THREE.Vector3 | null {
  const session = world ? snapshot.sessions[sessionId] : undefined;
  if (!world || !session) return null;
  const { x, z } = axialToWorld(projectPlacement(world, session.project).center);
  return new THREE.Vector3(x * HEX_SPACING, 0, z * HEX_SPACING);
}

/** Een lopend camerashot: een zwenk naar iets, of een rondje eromheen. */
interface Shot {
  kind: 'push' | 'circle';
  center: THREE.Vector3;
  t: number;
}

/**
 * De voetafdruk van de camera op de grond: de vier schermhoeken en het
 * middelpunt, geprojecteerd op het nulvlak. De minimap tekent daarmee welk
 * stuk wereld je ziet — en dus ook welk stuk je niet ziet.
 *
 * Hier, niet in de minimap: de camera hoort bij dit bestand. De kaart haalde
 * hem eerst uit `_roots` van react-three-fiber, en dat is een interne API.
 */
const _viewDir = new THREE.Vector3();
const _viewCorner = new THREE.Vector3();

function groundFootprint(camera: THREE.Camera): CameraView | null {
  _viewDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  // Kijkt de camera langs de grond, dan snijdt hij het nulvlak niet (of pas in
  // de oneindigheid): dan is er geen uitsnede om te tekenen.
  if (Math.abs(_viewDir.y) < 1e-4) return null;
  const hit = (nx: number, ny: number): GroundPoint => {
    _viewCorner.set(nx, ny, -1).unproject(camera);
    const t = -_viewCorner.y / _viewDir.y;
    return [_viewCorner.x + _viewDir.x * t, _viewCorner.z + _viewDir.z * t];
  };
  return {
    corners: [hit(-1, 1), hit(1, 1), hit(1, -1), hit(-1, -1)],
    target: hit(0, 0),
  };
}

export function CameraRig(): JSX.Element {
  const controlsRef = useRef<MapControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const restZoom = fitZoom(size.width, size.height);
  // Het zijpaneel dekt de rechterkant af, maar de camera centreert op het hele
  // canvas — dus verdwijnt het rechtse district erachter. De wereld schuift
  // daarom naar links, langs de rechtervector van de camera zelf. Dat is
  // voorspelbaar; setViewOffset leek eerst goed maar schaalt het beeld mee, en
  // dan is de wereld wél verschoven maar ook ingezoomd.
  //
  // Alleen op een breed scherm: op een telefoon ligt het paneel als bottom
  // sheet over de wereld en is er niets om voor uit te wijken.
  const sideOpen = useAra((s) => s.panelOpen || s.boardOpen || s.actionsOpen);
  const panelCover = sideOpen && size.width > 860 ? 364 : 0;
  const panelOffset = useRef(new THREE.Vector3());
  const flyTarget = useAra((s) => s.flyTarget);
  // Alleen de omslag null ↔ niet-null interesseert ons; op elke scrub-stap
  // opnieuw renderen zou de hele scene-boom onnodig aanraken.
  const replaying = useAra((s) => s.replayTs !== null);
  const goal = useRef<THREE.Vector3 | null>(null);
  const focusZoom = useRef<number | null>(null);
  // Trauma-based shake: amount = trauma², offset uit gladde sin-ruis — leest
  // als een klap i.p.v. de tril van per-frame Math.random().
  const trauma = useRef(0);
  const shakeOffset = useRef(new THREE.Vector3());
  // Idle-drift: na 8s zonder input zweeft de camera een traag achtje.
  const lastInteraction = useRef(Date.now());
  const dragging = useRef(false);
  const driftOffset = useRef(new THREE.Vector3());
  const driftAmp = useRef(0);
  const intro = useRef(0); // 0..1 fly-in bij laden
  // Filmische shots (zwenk/rondje) en het effect dat ze startte.
  const shot = useRef<Shot | null>(null);
  const lastShotEffect = useRef<string | null>(null);
  const lastShotAt = useRef(0);
  // Kanteling: tiltPhi is de hoek die wij sturen, userTilted onthoudt of de
  // gebruiker zelf heeft gedraaid — daarna blijven we van de hoek af.
  const tiltPhi = useRef(ISO_PHI);
  const userTilted = useRef(false);
  // Draaisnelheid om het doelpunt (rondje, rondleiding, tijdlapse).
  const orbitSpeed = useRef(0);
  const orbitTheta = useRef(Math.PI / 4);
  // Wanneer de minimap voor het laatst een verse cameravoetafdruk kreeg.
  const lastViewPublish = useRef(0);

  useEffect(() => {
    const { world, snapshot } = useAra.getState();
    if (!flyTarget) return;
    const position = sessionWorldPos(world, snapshot, flyTarget.sessionId);
    if (!position) return;
    goal.current = position;
    shot.current = null; // een gerichte sprong verslaat een lopend shot
    lastInteraction.current = Date.now();
    // Focus-pull: onder ortho is "scherpstellen" een zoom-duw richting de pod.
    // Scherpstellen is onder ortho een zoom-duw richting de pod. Relatief aan
    // de rustzoom, want die hangt nu van het venster af: een vaste 48 zou op
    // een klein scherm een sprong zijn en op een groot scherm niets doen.
    const zoom = (camera as THREE.OrthographicCamera).zoom;
    const target = restZoom * 1.35;
    if (zoom < target) focusZoom.current = target;
  }, [flyTarget, camera, restZoom]);

  // Camera nudge on needs-human effects.
  const effects = useAra((s) => s.effects);
  useEffect(() => {
    const now = Date.now();
    if (effects.some((e) => e.type === 'nudge' && now - e.ts < 300))
      trauma.current = Math.min(1, trauma.current + 0.55);
    // Taak af = kleine vreugde-schok; subtieler dan een needs-human nudge.
    if (effects.some((e) => e.type === 'flag' && now - e.ts < 300))
      trauma.current = Math.min(1, trauma.current + 0.3);

    // Filmische zwenk. Alleen als niemand zelf aan het kijken is: de camera
    // overnemen terwijl iemand de muis vasthoudt is de ergste vorm van
    // tegenwerken. En niet tijdens replay — daar loopt de tijdlapse.
    if (dragging.current || now - lastInteraction.current < AUTO_IDLE_MS) return;
    if (useAra.getState().replayTs !== null) return;
    const fresh = effects.filter((e) => now - e.ts < 400);
    // Escalatie wint van vreugde: een mens die wacht is dringender dan een
    // afgeronde taak.
    const pick =
      [...fresh].reverse().find((e) => e.type === 'nudge') ??
      [...fresh].reverse().find((e) => e.type === 'flag');
    if (!pick || pick.id === lastShotEffect.current) return;
    const kind = pick.type === 'nudge' ? 'push' : 'circle';
    if (now - lastShotAt.current < SHOT_COOLDOWN_MS[kind]) return;
    const { world, snapshot } = useAra.getState();
    const center =
      pick.type === 'nudge'
        ? sessionWorldPos(world, snapshot, pick.sessionId)
        : districtWorldPos(world, snapshot, pick.sessionId);
    if (!center) return;
    lastShotEffect.current = pick.id;
    lastShotAt.current = now;
    shot.current = { kind, center, t: 0 };
  }, [effects]);

  useFrame(({ clock }, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cam = camera as THREE.OrthographicCamera;
    const now = Date.now();

    // Vorige frame-offsets terugdraaien zodat controls een schone basis ziet
    // (anders accumuleert de shake/drift en vecht hij met gebruikersinput).
    camera.position.sub(shakeOffset.current);
    controls.target.sub(driftOffset.current);
    camera.position.sub(driftOffset.current);
    controls.target.sub(panelOffset.current);
    camera.position.sub(panelOffset.current);

    // Wie stuurt? Slepen/scrollen in de wereld zet alle automaten uit; een
    // gerichte sprong (klik op een sessie) is wél een opdracht van de gebruiker
    // en hoeft niet op de rustperiode te wachten.
    const userIdle = !dragging.current && now - lastInteraction.current > AUTO_IDLE_MS;
    const tourWants = director.target !== null && now - director.lastUserInput > 400;

    let autoTarget: THREE.Vector3 | null = null;
    let smoothing = 0.35;
    let wantedOrbit = 0;
    let zoomGoal: number | null = focusZoom.current;

    if (dragging.current) {
      // Handen aan het stuur: alles wat vanzelf bewoog, valt stil.
      goal.current = null;
      shot.current = null;
      focusZoom.current = null;
      zoomGoal = null;
    } else if (goal.current) {
      autoTarget = goal.current;
    } else if (shot.current && userIdle) {
      const s = shot.current;
      s.t += delta;
      autoTarget = s.center;
      if (s.kind === 'push') {
        // De terugtrek geeft de duw erna zijn snelheid: zonder die halve
        // seconde lucht is inzoomen alleen maar groter worden.
        smoothing = 0.5;
        zoomGoal = restZoom * (s.t < SHOT_PULL_SEC ? SHOT_PULL_ZOOM : SHOT_PUSH_ZOOM);
        if (s.t > SHOT_PULL_SEC + SHOT_PUSH_SEC) shot.current = null;
      } else {
        smoothing = 0.7;
        zoomGoal = restZoom * CIRCLE_ZOOM;
        wantedOrbit = CIRCLE_SPEED;
        if (s.t > CIRCLE_SEC) shot.current = null;
      }
    } else if (replaying && now - lastInteraction.current > REPLAY_IDLE_MS && !dragging.current) {
      // Tijdlapse: terugkijken hoort een filmpje te zijn, dus draait de camera
      // traag om het midden van de wereld in plaats van stil te staan.
      //
      // Bewust een langere rustperiode dan de rest én géén zoomdoel: wie tijdens
      // het terugkijken zelf inzoomt op een district wil dáár het filmpje zien,
      // niet teruggesleept worden naar het overzicht.
      shot.current = null;
      autoTarget = ORIGIN;
      smoothing = 1.2;
      wantedOrbit = REPLAY_SPEED;
    } else if (tourWants && userIdle) {
      autoTarget = director.target;
      smoothing = director.smoothing;
      wantedOrbit = director.orbit;
      if (director.zoomScale !== null) zoomGoal = restZoom * director.zoomScale;
    }

    // Intro: van ver uitgezoomd zachtjes de wereld in (~2s).
    if (intro.current < 1) {
      intro.current = Math.min(1, intro.current + delta / 2);
      const ease = 1 - Math.pow(1 - intro.current, 3);
      cam.zoom = MIN_ZOOM + (restZoom - MIN_ZOOM) * ease;
      cam.updateProjectionMatrix();
    } else if (zoomGoal !== null) {
      const settled = !damp(cam, 'zoom', zoomGoal, 0.4, delta);
      cam.updateProjectionMatrix();
      if (settled) focusZoom.current = null;
    }

    // LOD-schakelaar: ver uitgezoomd → icons/bubbles uit (goedkope frames).
    const far = cam.zoom < 26;
    if (far !== useAra.getState().lodFar) useAra.getState().setLodFar(far);

    if (autoTarget) {
      // maath-damping: echte traagheid i.p.v. framerate-afhankelijke lerp.
      const moving = damp3(controls.target, autoTarget, smoothing, delta);
      if (!moving && goal.current === autoTarget) goal.current = null;
    }

    // Idle-drift (alleen zonder automatisch doel): traag achtje over de wereld.
    const idle = now - lastInteraction.current > IDLE_DRIFT_AFTER_MS && !autoTarget;
    damp(driftAmp, 'current', idle ? 1 : 0, 0.8, delta);
    if (driftAmp.current > 0.001) {
      const t = clock.elapsedTime;
      driftOffset.current.set(
        Math.sin(t * 0.13) * 0.55 * driftAmp.current,
        0,
        Math.sin(t * 0.09 * 2) * 0.35 * driftAmp.current,
      );
    } else {
      driftOffset.current.set(0, 0, 0);
    }

    // Paneelverschuiving: een halve paneelbreedte in wereldeenheden, langs de
    // rechtervector van de camera. Gedempt, zodat openen en sluiten een
    // beweging is en geen sprong.
    const wanted = panelCover / 2 / cam.zoom;
    _right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    _goalOffset.copy(_right).multiplyScalar(wanted);
    damp3(panelOffset.current, _goalOffset, 0.25, delta);

    // Hoek vóór en ná controls.update() vergelijken: alleen een echte
    // draaibeweging van de gebruiker verandert de polaire hoek (pannen en
    // zoomen niet). Merken we dat, dan is de hoek vanaf nu van de gebruiker.
    _offset.copy(camera.position).sub(controls.target);
    const phiBefore = _spherical.setFromVector3(_offset).phi;
    controls.update();
    _offset.copy(camera.position).sub(controls.target);
    _spherical.setFromVector3(_offset);
    if (Math.abs(_spherical.phi - phiBefore) > 0.008) userTilted.current = true;

    // Rigide ophanging: de camera hangt op een vaste afstand van zijn doelpunt,
    // dus een gedempt doelpunt is genoeg om de hele camera mee te nemen — en
    // het beeld kijkt gegarandeerd naar waar het over gaat.
    if (userTilted.current) {
      tiltPhi.current = _spherical.phi; // gebruiker bepaalt de hoek; wij volgen
    } else {
      damp(tiltPhi, 'current', tiltForZoom(cam.zoom, restZoom), 0.5, delta);
      _spherical.phi = tiltPhi.current;
    }
    damp(orbitSpeed, 'current', wantedOrbit, 0.9, delta);
    if (Math.abs(orbitSpeed.current) > 0.0005) {
      orbitTheta.current += orbitSpeed.current * delta;
      _spherical.theta = orbitTheta.current;
    } else {
      orbitTheta.current = _spherical.theta; // meelopen, zodat een rondje nooit springt
    }
    _spherical.radius = RIG_RADIUS;
    camera.position.copy(controls.target).add(_offset.setFromSpherical(_spherical));
    camera.lookAt(controls.target);

    controls.target.add(panelOffset.current);
    camera.position.add(panelOffset.current);
    // Drift verplaatst de hele rig (doel én camera): een verschuiving van
    // alleen het doelpunt zag je niet, want controls.update() had al gemikt.
    controls.target.add(driftOffset.current);
    camera.position.add(driftOffset.current);

    // Shake ná controls.update() als additieve offset.
    if (trauma.current > 0.005) {
      trauma.current = Math.max(0, trauma.current - delta * 1.4);
      const amount = trauma.current * trauma.current * 0.45;
      const t = clock.elapsedTime;
      shakeOffset.current.set(
        (Math.sin(t * 31.7) + Math.sin(t * 17.3)) * 0.5 * amount,
        0,
        (Math.sin(t * 27.1) + Math.sin(t * 13.9)) * 0.5 * amount,
      );
    } else {
      shakeOffset.current.set(0, 0, 0);
    }
    camera.position.add(shakeOffset.current);

    // De kaart bijwerken is geen animatie: ~7x/s is ruim genoeg om mee te
    // bewegen, en het scheelt de minimap 53 van de 60 hertekeningen.
    if (now - lastViewPublish.current > 140) {
      lastViewPublish.current = now;
      useAra.getState().setCameraView(groundFootprint(camera));
    }
  });

  return (
    <>
      <orthographicCamera />
      <MapControls
        ref={controlsRef}
        makeDefault={false}
        enableRotate
        enableDamping
        dampingFactor={0.08}
        minZoom={12}
        maxZoom={STREET_ZOOM}
        maxPolarAngle={Math.PI / 2.6}
        minPolarAngle={Math.PI / 5}
        screenSpacePanning={false}
        touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
        onStart={() => {
          const now = Date.now();
          lastInteraction.current = now;
          dragging.current = true;
          // Eén plek waar "de gebruiker stuurt" vandaan komt; de rondleiding
          // leest hetzelfde stempel en zet zichzelf uit.
          director.lastUserInput = now;
          focusZoom.current = null;
          goal.current = null;
          shot.current = null;
        }}
        onEnd={() => {
          const now = Date.now();
          lastInteraction.current = now;
          dragging.current = false;
          director.lastUserInput = now;
        }}
      />
    </>
  );
}

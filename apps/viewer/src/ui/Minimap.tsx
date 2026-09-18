import { useEffect, useRef } from 'react';
import { _roots } from '@react-three/fiber';
import * as THREE from 'three';
import {
  WORLD_HEX_RADIUS,
  axialToWorld,
  hexDisc,
  visibleInWorld,
  type SessionState,
  type WorldConfig,
  type WorldSnapshot,
} from '@ara/shared';
import { useAra, useViewSnapshot } from '../store.ts';
import { HEX_SPACING, projectPlacement, sessionPosition } from '../placements.ts';
import { STATUS_COLORS } from '../util.ts';

/** Halve breedte van de wereld in wereldeenheden; de hexschijf past hier net in. */
const EXTENT = 16;
/** Hoogstens tien keer per seconde tekenen: dit is een kaartje, geen animatie. */
const FRAME_MS = 100;

type Pt = [number, number];

/** Wereldcoördinaat → pixel op een kaartje van `size` bij `size`. */
function toMap(x: number, z: number, size: number): Pt {
  return [(x / EXTENT) * (size / 2) + size / 2, (z / EXTENT) * (size / 2) + size / 2];
}

/** Pixel op het kaartje → wereldcoördinaat (voor klikken en aanwijzen). */
function toWorld(px: number, py: number, size: number): Pt {
  return [(px / size - 0.5) * 2 * EXTENT, (py / size - 0.5) * 2 * EXTENT];
}

/**
 * Eén hex als pad, op zijn plek in de kaart. Pointy-top: de punten staan boven
 * en onder, dus de hoekpunten liggen op 90° + k·60°.
 */
function hexPath(path: Path2D, cx: number, cz: number, radius: number, size: number): void {
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (90 + 60 * k);
    const [x, y] = toMap(cx + Math.cos(a) * radius, cz + Math.sin(a) * radius, size);
    if (k === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
}

/**
 * De onderlaag — grond en districten — als plaatje.
 *
 * Die laag is ruim tweehonderd hexen en verandert alleen als de wereldkaart
 * zelf verandert, dus tekenen we hem één keer en zetten hem daarna als bitmap
 * neer. Deze machine rendert de wereld zonder GPU; een kaartje dat elke tel
 * tweehonderd paden opnieuw vult, haalt frames weg bij precies het beeld dat
 * het samenvat.
 */
interface WorldPaths {
  key: string;
  base: HTMLCanvasElement;
}

function buildPaths(world: WorldConfig, size: number, dpr: number): WorldPaths {
  const base = document.createElement('canvas');
  base.width = Math.round(size * dpr);
  base.height = Math.round(size * dpr);
  const ctx = base.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ground = new Path2D();
  // De grond is de hexschijf waar de wereld ook echt op staat — dezelfde
  // straal als de terreinschijf in de scene. Zo herken je de vorm terug:
  // een minimap die een vierkant toont van een wereld die rond is, is een
  // plaatje en geen kaart.
  for (const hex of hexDisc({ q: 0, r: 0 }, WORLD_HEX_RADIUS)) {
    const { x, z } = axialToWorld(hex);
    hexPath(ground, x * HEX_SPACING, z * HEX_SPACING, 0.98, size);
  }

  // Donker en vlak: alles wat er later overheen komt moet eruit springen.
  ctx.fillStyle = 'rgba(232, 234, 240, 0.07)';
  ctx.fill(ground);

  // Districten in hun takkleur — de vorm van de stad, niet één stip per tak.
  for (const district of world.districts) {
    const shape = new Path2D();
    for (const project of district.projects) {
      for (const hex of project.hexes) {
        const { x, z } = axialToWorld(hex);
        hexPath(shape, x * HEX_SPACING, z * HEX_SPACING, 0.92, size);
      }
    }
    ctx.fillStyle = `${district.venture.color}3d`;
    ctx.fill(shape);
    ctx.strokeStyle = `${district.venture.color}7a`;
    ctx.lineWidth = 0.6;
    ctx.stroke(shape);
  }

  return { key: `${world.generatedAt}:${size}:${dpr}`, base };
}

/**
 * De vier hoeken van het beeld, geprojecteerd op de grond (y=0), plus het punt
 * waar de camera naar kijkt.
 *
 * De camera leeft in de R3F-boom en de minimap is een DOM-buur daarvan, dus we
 * lezen hem uit de root-store van react-three-fiber. Dat is de enige verbinding
 * die er is zonder de scene zelf aan te passen — en zonder die verbinding weet
 * de kaart niet waar je staat, wat precies het onderdeel is dat hem van een
 * plaatje een navigatiemiddel maakt. Mislukt het lezen, dan tekenen we gewoon
 * geen uitsnede.
 */
const _dir = new THREE.Vector3();
const _corner = new THREE.Vector3();

function readView(): { corners: Pt[]; target: Pt } | null {
  try {
    let camera: THREE.Camera | null = null;
    for (const [canvas, root] of _roots) {
      if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) continue;
      // Het kantoor heeft zijn eigen canvas; die camera gaat niet over de wereld.
      if (canvas.closest('.office-overlay')) continue;
      camera = root.store.getState().camera;
      break;
    }
    if (!camera) return null;
    _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    if (Math.abs(_dir.y) < 1e-4) return null;
    const hit = (nx: number, ny: number): Pt => {
      _corner.set(nx, ny, -1).unproject(camera as THREE.Camera);
      const t = -_corner.y / _dir.y;
      return [_corner.x + _dir.x * t, _corner.z + _dir.z * t];
    };
    return {
      corners: [hit(-1, 1), hit(1, 1), hit(1, -1), hit(-1, -1)],
      target: hit(0, 0),
    };
  } catch {
    return null;
  }
}

/** Sessies per project, in dezelfde volgorde als de wereld ze neerzet. */
function sessionDots(
  world: WorldConfig,
  snapshot: WorldSnapshot,
): { session: SessionState; x: number; z: number }[] {
  const sessions = Object.values(snapshot.sessions).filter((s) => visibleInWorld(world, s.project));
  const byProject = new Map<string, SessionState[]>();
  for (const session of sessions) {
    const list = byProject.get(session.project) ?? [];
    list.push(session);
    byProject.set(session.project, list);
  }
  const out: { session: SessionState; x: number; z: number }[] = [];
  for (const list of byProject.values()) {
    list.sort((a, b) => a.startedAt - b.startedAt);
    list.forEach((session, index) => {
      const pos = sessionPosition(world, session, index);
      out.push({ session, x: pos.x, z: pos.z });
    });
  }
  return out;
}

/** Vraagt deze sessie aandacht? Die tekenen we bovenop, met een klopring. */
function needsAttention(session: SessionState): boolean {
  return session.status === 'needsHuman' || session.status === 'error';
}

/**
 * Navigatiekaartje: wereldvorm, districten in hun takkleur, waar de camera
 * staat en hoeveel je ervan ziet, en wat aandacht vraagt.
 *
 * Op de telefoon is dit het enige goedkope navigatiemiddel — slepen op een
 * klein vlak selecteert per ongeluk pods — dus moet hij klein én leesbaar
 * blijven: vormen, geen tekst.
 */
export function Minimap(): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = useAra((s) => s.world);
  const snapshot = useViewSnapshot();
  const select = useAra((s) => s.select);
  const flyTo = useAra((s) => s.flyTo);
  const selectedSessionId = useAra((s) => s.selectedSessionId);

  // De tekenlus leest alles uit refs: hij draait op rAF en mag niet elke
  // store-update een nieuwe lus opstarten.
  const worldRef = useRef(world);
  const snapRef = useRef(snapshot);
  const selectedRef = useRef(selectedSessionId);
  worldRef.current = world;
  snapRef.current = snapshot;
  selectedRef.current = selectedSessionId;

  // De lus start pas als er een wereld is: zonder wereld rendert dit component
  // niets en bestaat het canvas nog niet.
  const hasWorld = world !== null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let paths: WorldPaths | null = null;
    let raf = 0;
    let last = 0;
    let lastSig = '';
    let lastSnap: WorldSnapshot | null = null;

    const draw = (now: number): void => {
      raf = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      last = now;
      const current = worldRef.current;
      if (!current) return;

      // De CSS bepaalt de maat (148px, 104px op de telefoon). Meten in plaats
      // van aannemen: anders tekent het kaartje op de telefoon een uitsnede
      // van zichzelf.
      const size = Math.round(canvas.getBoundingClientRect().width) || 148;
      const dpr = window.devicePixelRatio || 1;
      const snap = snapRef.current;
      const view = readView();
      // Alleen opnieuw tekenen als er iets ánders te zien is. Deze machine
      // rendert de wereld al zonder GPU; een kaartje dat zestien keer per
      // seconde hetzelfde plaatje opnieuw zet, haalt fps weg bij de wereld.
      // Klopt er iets (wacht-op-jou, storing), dán moet de lus wél doorlopen.
      const alert = snap.counters.needsHuman > 0 ||
        Object.values(snap.sessions).some((s) => s.status === 'error' && !s.endedAt);
      const sig = [
        size,
        current.generatedAt,
        selectedRef.current,
        view ? view.corners.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join('|') : 'x',
      ].join('~');
      if (!alert && sig === lastSig && snap === lastSnap) return;
      lastSig = sig;
      lastSnap = snap;
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      // 1+2. Grond en districten: één keer getekend, daarna een bitmap.
      const key = `${current.generatedAt}:${size}:${dpr}`;
      if (!paths || paths.key !== key) paths = buildPaths(current, size, dpr);
      ctx.drawImage(paths.base, 0, 0, size, size);

      // 3. De hub in het midden.
      const [hx, hy] = toMap(0, 0, size);
      ctx.strokeStyle = 'rgba(232, 234, 240, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
      ctx.stroke();

      // 4. Wat je nú in beeld hebt. De sluier buiten de uitsnede vertelt in één
      //    oogopslag hoeveel wereld je niet ziet; een los kadertje leest pas
      //    als je ernaar zoekt.
      if (view) {
        const poly = view.corners.map(([x, z]) => toMap(x, z, size));
        const veil = new Path2D();
        veil.rect(0, 0, size, size);
        const shape = new Path2D();
        shape.moveTo(poly[0]![0], poly[0]![1]);
        for (const [x, y] of poly.slice(1)) shape.lineTo(x, y);
        shape.closePath();
        veil.addPath(shape);
        ctx.fillStyle = 'rgba(8, 10, 13, 0.55)';
        ctx.fill(veil, 'evenodd');
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)';
        ctx.lineWidth = 1.1;
        ctx.stroke(shape);
        // Het middelpunt van je blik: waar je camera op staat.
        const [tx, ty] = toMap(view.target[0], view.target[1], size);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.moveTo(tx - 3, ty);
        ctx.lineTo(tx + 3, ty);
        ctx.moveTo(tx, ty - 3);
        ctx.lineTo(tx, ty + 3);
        ctx.stroke();
      }

      // 5. Sessies. Rustige eerst, aandacht daarna bovenop — anders verdwijnt
      //    een escalatie onder een pod die het prima doet.
      const dots = sessionDots(current, snap);
      const pulse = 0.5 + 0.5 * Math.sin(now / 420);
      for (const pass of [0, 1]) {
        for (const { session, x, z } of dots) {
          if ((pass === 1) !== needsAttention(session)) continue;
          const [px, py] = toMap(x, z, size);
          const color = STATUS_COLORS[session.status] ?? '#8b95a5';
          if (pass === 1) {
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.25 + 0.55 * pulse;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(px, py, 4.5 + 2.5 * pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          // Donker randje: een blauwe stip op een geel district verdwijnt
          // zonder, en dit kaartje is te klein om iets te laten verdwijnen.
          const r = pass === 1 ? 3 : 2.2;
          ctx.fillStyle = 'rgba(8, 10, 13, 0.75)';
          ctx.beginPath();
          ctx.arc(px, py, r + 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
          if (session.sessionId === selectedRef.current) {
            // De gekozen sessie: een witte ring, zodat de kaart en het paneel
            // over hetzelfde ding gaan.
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [hasWorld]);

  if (!world) return null;

  /** Wat ligt er op deze plek? Sessie wint van district, district van niets. */
  const pick = (
    e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement },
  ): { session?: SessionState; project?: string; venture?: string } => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Rekenen met de gemeten doos, niet met een vast getal: op de telefoon
    // staat de kaart via CSS kleiner. Met een vaste maat lag de trefzone
    // buiten het kaartje en deed tikken niets.
    const [wx, wz] = toWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width);
    let best: { session: SessionState; d: number } | null = null;
    for (const { session, x, z } of sessionDots(world, snapshot)) {
      const d = Math.hypot(x - wx, z - wz);
      if (!best || d < best.d) best = { session, d };
    }
    if (best && best.d < 3.5) return { session: best.session, project: best.session.project };

    // Geen pod in de buurt: dan bedoel je het district. Daar springen we naar
    // de meest recente sessie van — een klik op een kaart hoort altijd ergens
    // heen te gaan, ook als je niet precies een stipje raakt.
    let nearest: { project: string; venture: string; d: number } | null = null;
    for (const district of world.districts) {
      for (const project of district.projects) {
        const c = axialToWorld(project.center);
        const d = Math.hypot(c.x * HEX_SPACING - wx, c.z * HEX_SPACING - wz);
        if (!nearest || d < nearest.d)
          nearest = { project: project.name, venture: district.venture.label, d };
      }
    }
    if (nearest && nearest.d < 3.2) return { project: nearest.project, venture: nearest.venture };
    if (best && best.d < 7) return { session: best.session, project: best.session.project };
    return {};
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const hit = pick(e);
    const target =
      hit.session ??
      // Een district zonder aangewezen pod: de laatst actieve sessie van dat
      // project is waar je naartoe wilt.
      (hit.project
        ? Object.values(snapshot.sessions)
            .filter((s) => s.project === hit.project)
            .sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0]
        : undefined);
    if (!target) return;
    select(target.sessionId);
    flyTo(target.sessionId);
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const hit = pick(e);
    const title = hit.session
      ? `${hit.session.project} — ${hit.session.message?.slice(0, 40) ?? hit.session.status}`
      : hit.project
        ? `${hit.project} (${hit.venture ?? ''})`
        : 'Kaart — tik om ergens heen te springen';
    if (e.currentTarget.title !== title) e.currentTarget.title = title;
  };

  // De weergavemaat staat in theme.css (klein op de telefoon); het canvas meet
  // zichzelf en tekent op die maat, dus schalen kost geen scherpte.
  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      title="Kaart — tik om ergens heen te springen"
      aria-label="Minimap van de wereld"
      onClick={onClick}
      onMouseMove={onMove}
    />
  );
}

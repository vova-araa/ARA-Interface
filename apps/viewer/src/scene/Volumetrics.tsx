import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { axialKey, axialToWorld, hexDisc, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { useAra } from '../store.ts';
import { useDaylight } from './daylight.ts';
import { buildRoads } from './roads.ts';

/**
 * Volumetrisch licht: zonnestralen overdag, lichtkegels in het donker.
 *
 * Waarom geometrie en geen extra post-pass: de EffectComposer draait op het
 * hele scherm, dus een god-ray-pass kost altijd een volledig beeldvlak aan
 * fill-rate — ook als er maar drie stralen te zien zijn. Kegels en quads
 * kosten alleen wat ze bedekken (grove schatting bij zoom 22: alle
 * lantaarnkegels samen ≈ een kwart beeldvlak, de stralen nog eens zoveel),
 * en ze zitten in de dieptebuffer: een straal achter een toren wordt
 * gewoon afgedekt in plaats van eroverheen te waaien.
 *
 * Alles hier is sfeer, geen informatie. Daarom is `perfLow` een harde uit:
 * doorzichtige, elkaar overlappende vlakken zijn precies wat een zwakke GPU
 * laat inzakken, en er gaat niets aan betekenis verloren als ze wegvallen.
 */

/* ------------------------------------------------------------------ shaders */

/**
 * Eén vertex-shader voor stralen én kegels. `USE_INSTANCING` zet three zelf
 * zodra het object een InstancedMesh is; we passen `instanceMatrix` daarom
 * met de hand toe, want een eigen ShaderMaterial krijgt de ingebouwde
 * project_vertex-chunk niet cadeau.
 */
const VERT = /* glsl */ `
  #ifdef USE_PARAMS_ATTR
  attribute vec2 aParams; // x = sterkte, y = fase
  #endif
  uniform float uStrength;
  varying vec2 vUv;
  varying float vStrength;
  varying float vPhase;
  varying vec3 vNormalView;

  void main() {
    vUv = uv;
    vStrength = uStrength;
    vPhase = 0.0;
    #ifdef USE_PARAMS_ATTR
    vStrength *= aParams.x;
    vPhase = aParams.y;
    #endif

    vec4 local = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    // Alleen geldig zolang de instantie uniform geschaald is — hier zijn het
    // verschuivingen (kegels) of een expliciet meegegeven basis (stralen).
    n = mat3(instanceMatrix) * n;
    #endif
    vNormalView = normalize(normalMatrix * n);
    gl_Position = projectionMatrix * modelViewMatrix * local;
  }
`;

/**
 * Straal: een quad die om zijn eigen as naar de camera draait. De radiale
 * uitdoving zit in de fragment-shader, want een straal heeft geen rand —
 * zodra je de rand ziet, zie je een vlak in plaats van licht.
 */
const SHAFT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  varying float vStrength;
  varying float vPhase;
  varying vec3 vNormalView;

  void main() {
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float body = pow(max(across, 0.0), 1.8);
    // vUv.y = 0 staat op de grond: daar zacht landen, en bovenin uitdoven
    // voordat de straal de lucht raakt (anders zie je waar hij ophoudt).
    float along = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.5, 1.05, vUv.y));
    // Trage stofdrift; deterministisch uit de klok, niet uit toeval.
    float drift = 0.86 + 0.14 * sin(vUv.y * 7.0 - uTime * 0.35 + vPhase);
    float a = body * along * drift * uOpacity * vStrength;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

/**
 * Kegel: holle mantel, dubbelzijdig en additief, zodat voor- en achterkant
 * samen dichtheid opbouwen. Helder waar de mantel de camera recht aankijkt,
 * weg bij de silhouetrand — dat leest als een volume in plaats van als een
 * papieren hoedje.
 */
const CONE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uInvert; // 1.0 = helder onderaan (vlam), 0.0 = helder bovenaan (lamp)
  varying vec2 vUv;
  varying float vStrength;
  varying vec3 vNormalView;

  void main() {
    // De wereldcamera is orthografisch: de kijkrichting is voor elk fragment
    // (0,0,1) in view-ruimte. Geen deling door vViewPos nodig.
    float facing = abs(normalize(vNormalView).z);
    float body = pow(facing, 0.85);
    float t = mix(vUv.y, 1.0 - vUv.y, uInvert);
    // Licht dooft uit met de afstand tot de bron — kwadratisch genoeg om de
    // kegel niet als een scherpe koker op de grond te laten eindigen.
    float fall = pow(clamp(t, 0.0, 1.0), 1.7);
    float a = body * fall * uOpacity * vStrength;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

function makeGlowMaterial(fragment: string, withParams: boolean): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    uColor: { value: new THREE.Color('#ffffff') },
    uOpacity: { value: 0 },
    uStrength: { value: 1 },
    uTime: { value: 0 },
    uInvert: { value: 0 },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: fragment,
    defines: withParams ? { USE_PARAMS_ATTR: '' } : {},
    transparent: true,
    // Additief: licht telt op bij wat er al staat, het bedekt het niet.
    blending: THREE.AdditiveBlending,
    // Wél diepte lezen (een straal achter een toren hoort onzichtbaar te zijn),
    // niet schrijven (anders dekken de vlakken elkaar af).
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/* ------------------------------------------------------------------ stralen */

/** Zolang hij hoog genoeg is: verder dan de wereldrand hoeft de straal niet. */
const SHAFT_LENGTH = 22;
const MAX_SHAFTS = 6;

interface Shaft {
  x: number;
  y: number;
  z: number;
  width: number;
  strength: number;
  phase: number;
}

/**
 * Landingsplekken van de stralen: de harten van de districten plus de hub.
 * Daar staat de bebouwing, en een god ray leest alleen als je ziet waar hij
 * tússen valt. Volgorde en spreiding komen uit `stableHash` — dezelfde wereld
 * geeft altijd dezelfde stralen, ook na een herlaad.
 */
function shaftsFor(world: WorldConfig | null): Shaft[] {
  const spots: { key: string; x: number; z: number }[] = [{ key: 'hub', x: 0, z: 0 }];
  for (const district of world?.districts ?? []) {
    const hexes = district.projects.flatMap((project) => project.hexes);
    if (hexes.length === 0) continue;
    const centre = {
      q: Math.round(hexes.reduce((sum, h) => sum + h.q, 0) / hexes.length),
      r: Math.round(hexes.reduce((sum, h) => sum + h.r, 0) / hexes.length),
    };
    const { x, z } = axialToWorld(centre);
    spots.push({ key: district.venture.id, x: x * HEX_SPACING, z: z * HEX_SPACING });
  }

  return spots.slice(0, MAX_SHAFTS).map((spot) => {
    const h = stableHash(`shaft:${spot.key}`);
    return {
      // Naast het hart, niet erop: een straal die precies op een dak valt is
      // een spot, geen zonnestraal tussen de gebouwen door.
      x: spot.x + (((h % 100) / 100) * 2 - 1) * 1.6,
      y: 0.2,
      z: spot.z + ((((h >> 7) % 100) / 100) * 2 - 1) * 1.6,
      width: 1.3 + ((h >> 13) % 100) / 100,
      strength: 0.55 + ((h >> 19) % 100) / 200,
      phase: ((h >> 3) % 628) / 100,
    };
  });
}

/** Hoeveel de stralen aanstaan per dagdeel; 's nachts is er geen zon. */
const SHAFT_BY_PERIOD: Record<'night' | 'dawn' | 'day' | 'dusk', number> = {
  night: 0,
  dawn: 0.9,
  day: 1,
  dusk: 0.85,
};

/** Terugvalrichting als er (nog) geen richtingslicht in de scene staat. */
const FALLBACK_SUN = new THREE.Vector3(18, 26, 10).normalize();

function SunShafts({ world }: { world: WorldConfig | null }): JSX.Element | null {
  const daylight = useDaylight();
  const scene = useThree((s) => s.scene);
  const shafts = useMemo(() => shaftsFor(world), [world]);
  const material = useMemo(() => makeGlowMaterial(SHAFT_FRAG, true), []);
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const params = new Float32Array(MAX_SHAFTS * 2);
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 2));
    return geo;
  }, []);
  const mesh = useRef<THREE.InstancedMesh | null>(null);
  const sunLight = useRef<THREE.DirectionalLight | null>(null);

  // Werkvectoren buiten de frame-lus: per frame nieuwe Vector3'en maken is
  // afval voor de GC in de warmste lus die er is.
  const temp = useMemo(
    () => ({
      sun: new THREE.Vector3(),
      view: new THREE.Vector3(),
      side: new THREE.Vector3(),
      depth: new THREE.Vector3(),
      x: new THREE.Vector3(),
      y: new THREE.Vector3(),
      matrix: new THREE.Matrix4(),
    }),
    [],
  );

  useEffect(() => () => {
    material.dispose();
    geometry.dispose();
  }, [material, geometry]);

  useEffect(() => {
    const attr = geometry.getAttribute('aParams') as THREE.InstancedBufferAttribute;
    shafts.forEach((shaft, i) => {
      attr.setXY(i, shaft.strength, shaft.phase);
    });
    attr.needsUpdate = true;
  }, [geometry, shafts]);

  useEffect(() => {
    material.uniforms.uColor!.value.set(daylight.lightColor);
    // Sterker licht = zichtbaarder stof; de bovengrens houdt de dageraad
    // ervan een mistbank te worden.
    material.uniforms.uOpacity!.value =
      0.15 * SHAFT_BY_PERIOD[daylight.period] * Math.min(1.3, daylight.directional);
  }, [material, daylight]);

  useFrame(({ clock, camera }) => {
    const m = mesh.current;
    // Uit is uit: 's nachts geen zoekactie en geen matrices.
    if (!m || SHAFT_BY_PERIOD[daylight.period] === 0) return;
    material.uniforms.uTime!.value = clock.elapsedTime;

    // De zon staat in Scene.tsx (SunRig) en beweegt met de klok. We lezen het
    // licht uit de scene in plaats van die formule hier na te bouwen: een
    // tweede zonneformule loopt gegarandeerd een keer uit de pas met de eerste.
    if (!sunLight.current || !sunLight.current.parent) {
      sunLight.current = null;
      scene.traverse((obj) => {
        if (!sunLight.current && (obj as THREE.DirectionalLight).isDirectionalLight) {
          sunLight.current = obj as THREE.DirectionalLight;
        }
      });
    }
    const light = sunLight.current;
    if (light) temp.sun.copy(light.position).normalize();
    else temp.sun.copy(FALLBACK_SUN);
    if (temp.sun.lengthSq() < 1e-6) temp.sun.copy(FALLBACK_SUN);

    // Om de eigen as naar de camera draaien: de breedte staat haaks op zowel
    // de straal als de kijkrichting. Onder de ortho-camera is die kijkrichting
    // voor het hele beeld dezelfde, dus dit klopt overal even goed.
    camera.getWorldDirection(temp.view);
    temp.side.crossVectors(temp.sun, temp.view);
    if (temp.side.lengthSq() < 1e-6) temp.side.set(1, 0, 0);
    temp.side.normalize();
    temp.depth.crossVectors(temp.side, temp.sun).normalize();

    for (let i = 0; i < shafts.length; i += 1) {
      const shaft = shafts[i]!;
      temp.x.copy(temp.side).multiplyScalar(shaft.width);
      temp.y.copy(temp.sun).multiplyScalar(SHAFT_LENGTH);
      temp.matrix.makeBasis(temp.x, temp.y, temp.depth);
      temp.matrix.setPosition(
        shaft.x + temp.sun.x * (SHAFT_LENGTH / 2),
        shaft.y + temp.sun.y * (SHAFT_LENGTH / 2),
        shaft.z + temp.sun.z * (SHAFT_LENGTH / 2),
      );
      m.setMatrixAt(i, temp.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  if (shafts.length === 0 || SHAFT_BY_PERIOD[daylight.period] === 0) return null;

  return (
    <instancedMesh
      ref={mesh}
      key={`shafts-${shafts.length}`}
      args={[geometry, material, shafts.length]}
      // De matrices draaien elk frame mee met camera en zon; een bolhull die
      // elk frame herberekend moet worden kost meer dan hij bespaart.
      frustumCulled={false}
      renderOrder={4}
    />
  );
}

/* ------------------------------------------------------------- lichtkegels */

/*
 * Vanaf hier staat een kopie van de lantaarnafleiding uit StreetLights.tsx.
 * ---> Deze twee moeten gelijk blijven. <---
 * Staat er hier één constante anders, dan hangt de kegel naast de paal, en dat
 * is precies het soort fout dat je pas 's nachts op een telefoon ziet.
 * StreetLights exporteert `lampsFor` niet, en dat bestand is hier niet van ons;
 * de bron van waarheid blijft daar. Wijzigt daar iets aan LAKE/ROAD_TOP/
 * PLATFORM_TOP/LAMP_HEIGHT of aan de pleinformule, dan hier mee.
 */
const LAKE_CENTER = { q: -2, r: 6 };
const LAKE_RADIUS = 2;
const PLATFORM_TOP = 0.31;
const ROAD_TOP = 0.2;
const LAMP_HEIGHT = 1.12;
/** Zelfde golf als de lampen: de kegel gaat aan met zijn eigen paal, niet ervoor. */
const STAGGER = 0.9;
/** Zelfde demping als de lampekop (3τ ≈ 1s). */
const TAU = 0.33;

interface ConeAnchor {
  x: number;
  y: number;
  z: number;
  delay: number;
}

function conesFor(world: WorldConfig | null): ConeAnchor[] {
  if (!world) return [];
  const out: ConeAnchor[] = [];

  const claimed = new Set<string>();
  for (const district of world.districts) {
    for (const project of district.projects) {
      for (const hex of project.hexes) claimed.add(axialKey(hex));
    }
  }
  const lake = new Set(hexDisc(LAKE_CENTER, LAKE_RADIUS).map(axialKey));
  const net = buildRoads(world, { claimed, lake });

  for (const key of [...net.tiles].sort()) {
    const [qs, rs] = key.split(',');
    const q = Number(qs);
    const r = Number(rs);
    if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
    const { x, z } = axialToWorld({ q, r });
    const cx = x * HEX_SPACING;
    const cz = z * HEX_SPACING;
    const len = Math.hypot(cx, cz);
    if (len < 0.5) continue;
    const px = -cz / len;
    const pz = cx / len;
    // Altijd beide bermen: de kegels bestaan alleen als perfLow uit staat, en
    // dán zet StreetLights ook zijn dichte stand aan (dense = !perfLow).
    for (const side of [-1, 1]) {
      out.push({
        x: cx + px * 0.62 * side,
        y: ROAD_TOP + LAMP_HEIGHT,
        z: cz + pz * 0.62 * side,
        delay: ((stableHash(`lamp:${key}:${side}`) % 100) / 100) * STAGGER,
      });
    }
  }

  for (const district of world.districts) {
    const hexes = district.projects.flatMap((project) => project.hexes);
    if (hexes.length === 0) continue;
    const centre = {
      q: Math.round(hexes.reduce((sum, h) => sum + h.q, 0) / hexes.length),
      r: Math.round(hexes.reduce((sum, h) => sum + h.r, 0) / hexes.length),
    };
    const { x, z } = axialToWorld(centre);
    const count = 4;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + 0.4;
      out.push({
        x: x * HEX_SPACING + Math.cos(angle) * 0.72,
        y: PLATFORM_TOP + LAMP_HEIGHT,
        z: z * HEX_SPACING + Math.sin(angle) * 0.72,
        delay: ((stableHash(`plein:${district.venture.id}:${i}`) % 100) / 100) * STAGGER,
      });
    }
  }

  return out;
}

const CONE_HEIGHT = 1.35;
const CONE_RADIUS = 0.52;
const LAMP_CONE_COLOR = '#ffd79a';

function LampCones({ world }: { world: WorldConfig | null }): JSX.Element | null {
  const daylight = useDaylight();
  const anchors = useMemo(() => conesFor(world), [world]);
  const material = useMemo(() => makeGlowMaterial(CONE_FRAG, true), []);
  const geometry = useMemo(
    () =>
      // openEnded: geen deksel en geen bodem — een dichte bodem tekent een
      // schijf op de grond en dat is precies het papieren-hoedje-effect.
      new THREE.CylinderGeometry(0.05, CONE_RADIUS, CONE_HEIGHT, 8, 1, true),
    [],
  );
  const levels = useRef(new Float32Array(0));
  /** Seconden sinds de schakelaar omging; draagt de per-lamp vertraging. */
  const since = useRef(Number.POSITIVE_INFINITY);

  // Zelfde schakelaar als StreetLights: schemer en nacht branden.
  const on = daylight.period === 'night' || daylight.period === 'dusk';
  const wasOn = useRef(on);
  /**
   * Overdag horen de kegels uit de boom te zijn: een mantel met sterkte 0 kost
   * nog steeds een draw-call en een volledige rasterisatie. Maar pas nádat hij
   * is uitgedoofd — daarom een state en niet meteen `!on`.
   */
  const [alive, setAlive] = useState(on);

  useEffect(() => {
    if (wasOn.current === on) return;
    wasOn.current = on;
    since.current = 0;
    if (on) setAlive(true);
  }, [on]);

  useEffect(() => () => {
    material.dispose();
    geometry.dispose();
  }, [material, geometry]);

  useEffect(() => {
    material.uniforms.uColor!.value.set(LAMP_CONE_COLOR);
    material.uniforms.uOpacity!.value = 0.19;
    material.uniforms.uInvert!.value = 0; // helder bij de kop, weg bij de grond
  }, [material]);

  useEffect(() => {
    const params = new Float32Array(anchors.length * 2);
    // Staat de wereld bij een herbouw al lang in het donker, dan hoort het
    // licht er meteen te zijn en niet nóg een keer aan te floepen.
    if (on) for (let i = 0; i < anchors.length; i += 1) params[i * 2] = 1;
    levels.current = new Float32Array(anchors.length);
    if (on) levels.current.fill(1);
    geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 2));
    // `on` staat er bewust niet bij: dit is de opbouw, de overgang doet
    // useFrame. Zou hij er wel staan, dan sprong het licht bij elke
    // dagdeelwissel hard om in plaats van te dempen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, geometry]);

  /**
   * Matrices in een ref-callback en niet in een effect: de mesh verdwijnt bij
   * dageraad uit de boom en komt bij schemer als een níeuw object terug. Een
   * effect op [anchors] draait dan niet opnieuw en de kegels zouden allemaal
   * in de oorsprong staan.
   */
  const setCones = (m: THREE.InstancedMesh | null): void => {
    if (!m) return;
    const matrix = new THREE.Matrix4();
    anchors.forEach((anchor, i) => {
      // Kegelmiddelpunt: de top (smalle kant) zit onder de lampekop.
      matrix.makeTranslation(anchor.x, anchor.y - CONE_HEIGHT / 2, anchor.z);
      m.setMatrixAt(i, matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  };

  useFrame((_, delta) => {
    const attr = geometry.getAttribute('aParams') as THREE.InstancedBufferAttribute | undefined;
    if (!attr || levels.current.length !== anchors.length) return;
    const step = Math.min(delta, 0.25);
    since.current += step;
    const k = 1 - Math.exp(-step / TAU);
    const target = on ? 1 : 0;

    let moved = false;
    let lit = false;
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i]!;
      const level = levels.current[i] ?? 0;
      if (level > 0.004) lit = true;
      if (since.current < anchor.delay) continue;
      const diff = target - level;
      if (Math.abs(diff) < 0.002) {
        if (level === target) continue;
        levels.current[i] = target;
      } else {
        levels.current[i] = level + diff * k;
      }
      attr.setX(i, levels.current[i] ?? 0);
      moved = true;
    }
    if (moved) attr.needsUpdate = true;
    // Uitgedoofd en de schakelaar staat uit ⇒ weg ermee tot het weer schemert.
    if (!on && !lit && alive) setAlive(false);
  });

  if (anchors.length === 0 || !alive) return null;

  return (
    <instancedMesh
      ref={setCones}
      key={`cones-${anchors.length}`}
      args={[geometry, material, anchors.length]}
      renderOrder={4}
    />
  );
}

/* ------------------------------------------------------- kegel op de vlam */

/** Zelfde plek als de eeuwige vlam in AmbientLife.tsx (voet + vlamhoogte). */
const FLAME_AT = { x: 1.1, y: 0.42 + 0.3, z: -1.1 };
const FLAME_CONE_HEIGHT = 1.7;

function FlameCone(): JSX.Element | null {
  const daylight = useDaylight();
  const material = useMemo(() => makeGlowMaterial(CONE_FRAG, false), []);
  const geometry = useMemo(
    // Omgekeerd aan de lantaarnkegel: smal bij de vlam, wijd naar boven —
    // warmte die opstijgt in plaats van licht dat neervalt.
    () => new THREE.CylinderGeometry(0.62, 0.1, FLAME_CONE_HEIGHT, 10, 1, true),
    [],
  );
  const warm = daylight.period === 'night' || daylight.period === 'dusk';

  useEffect(() => () => {
    material.dispose();
    geometry.dispose();
  }, [material, geometry]);

  useEffect(() => {
    material.uniforms.uColor!.value.set('#ff9a3d');
    material.uniforms.uOpacity!.value = daylight.period === 'night' ? 0.3 : 0.22;
    material.uniforms.uInvert!.value = 1; // helder onderaan, bij de vlam
  }, [material, daylight]);

  useFrame(({ clock }) => {
    // Zelfde flikkerformule als de vlam zelf in AmbientLife: twee sinussen,
    // geen toeval — de kegel moet met dezelfde hartslag ademen als het vuur.
    const t = clock.elapsedTime;
    material.uniforms.uStrength!.value =
      0.85 + Math.sin(t * 11) * 0.1 + Math.sin(t * 23) * 0.05;
  });

  if (!warm) return null;

  return (
    <mesh
      position={[FLAME_AT.x, FLAME_AT.y + FLAME_CONE_HEIGHT / 2, FLAME_AT.z]}
      geometry={geometry}
      material={material}
      renderOrder={4}
    />
  );
}

/* -------------------------------------------------------------------- root */

export function Volumetrics({ world }: { world: WorldConfig | null }): JSX.Element | null {
  const perfLow = useAra((s) => s.perfLow);
  // Hooks eerst, uitschakelen daarna: de sub-componenten dragen hun eigen
  // useFrame, dus `perfLow` haalt ze werkelijk uit de render-lus.
  if (perfLow) return null;

  return (
    <group>
      <SunShafts world={world} />
      <LampCones world={world} />
      <FlameCone />
    </group>
  );
}

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { axialToWorld, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { useAra } from '../store.ts';
import { stylize } from './stylize.ts';
import { groundTop } from './terrain.ts';
import { applyWind } from './wind.ts';

/**
 * Armeense herkenningspunten: de Cascade met terrassen en beelden, Moeder
 * Armenië, khachkars met echt kruissnijwerk, een kerk met kegeltamboer op een
 * kruisvormige plattegrond, het Republiekplein met een fonteinrij en
 * tuff-gevels met bogen, abrikozen- en granaatappelbomen — plus het
 * vak-specifieke gebouw per district.
 *
 * Twee regels bepalen de vorm van dit bestand.
 *
 * 1. **Het silhouet doet het werk.** Je kijkt van bovenaf onder een
 *    ortho-camera op zoom 22: één wereldeenheid is ~22 pixels. Alles hier
 *    bestaat omdat het de omtrek of de kleurvlek verandert. Wat op die afstand
 *    onder een pixel zakt is bewust weggelaten — losse abrikozen aan een boom,
 *    voegen tussen de traptreden, ramen in een gevel. Die kosten driehoeken en
 *    leveren grijs op.
 * 2. **Eén tekenopdracht per soort.** Elk herkenningspunt is één samengevoegde
 *    geometrie met de kleuren in de hoekpunten gebakken (zie `part`), en alles
 *    wat vaker voorkomt staat in een InstancedMesh. Een khachkar-tuin van
 *    dertien stenen kost daardoor evenveel als één khachkar. Dat is ook de
 *    reden dat het kruissnijwerk er wél in mag: het is gratis mee-instanceerd.
 *
 * De hoogte komt uit `groundTop` en niet uit een vast getal: de hub en de
 * districtcentra liggen op terrein met reliëf (0,38–0,59), dus alles wat hier
 * op 0,3 stond stond tot een kwart eenheid in de grond.
 */

// ── Tuff: het roze/oker zandsteen waar Yerevan van gebouwd is. Eén palet voor
// alles wat steen is, zodat plein, kerk, khachkar en trap dezelfde steengroeve
// delen en de hub als één stad leest in plaats van als losse objecten.
const TUFF_ROSE = '#c98268';
const TUFF_PINK = '#e0a88c';
const TUFF_CREAM = '#eed6b8';
const TUFF_OCHRE = '#c08b4f';
const TUFF_DEEP = '#a05f49';
const TUFF_SHADE = '#7d4638';
const BASALT = '#413a42';
const SLATE = '#6b5c55';
const PATINA = '#6c7a68';
const STEEL = '#c9c2b8';
const WATER = '#7fb8d6';
const BARK = '#7a5230';
const LEAF = '#6aa84f';
const LEAF_DEEP = '#4a7a3a';
const APRICOT = '#e8a13f';
const POME = '#b32b2b';

/**
 * Eén materiaal voor al het steen. De kleur zit in de hoekpunten, dus een kerk,
 * een khachkar en een fontein delen dezelfde shader, hetzelfde materiaal en
 * daarmee dezelfde korrel — en `stylize` geeft ze gratis de poreuze tuff-textuur
 * die de grond en de panden ook hebben.
 */
const STONE_MATERIAL = stylize(
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
  {
    rim: '#ffd9b0',
    rimStrength: 0.3,
    shadowTint: '#5b3f66',
    shadowStrength: 0.26,
    grain: 0.13,
    mottle: 0.09,
    roughVary: 0.1,
  },
);

/** Goud/brons houdt een eigen materiaal: metalness is een uniform, geen hoekpuntkleur. */
const GOLD_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  metalness: 0.75,
  roughness: 0.25,
});

/**
 * Bladerdak met GPU-wind (zelfde bron als wind.ts). Vlakke facetten: een
 * gladde bol leest op deze afstand als een biljartbal, facetten lezen als blad.
 */
const CANOPY_MATERIAL = applyWind(
  new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
  0.055,
  0,
);

const glow = (color: string, intensity = 0.4): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });

const GLOW_WARM = glow('#ffd98a', 0.35);
const GLOW_GOLD = glow('#ffd75e', 0.5);
const GLOW_PINK = glow('#ff3fa4', 0.35);
const GLOW_ORANGE = glow('#ff8a3d', 0.4);
const GLOW_VIOLET = glow('#9b5cff', 0.25);
const GLOW_SPOT = new THREE.MeshStandardMaterial({
  color: '#2a2f3a',
  emissive: '#fff3d6',
  emissiveIntensity: 0.6,
});

// ── Geometrie-gereedschap ────────────────────────────────────────────────────

const box = (w: number, h: number, d: number): THREE.BufferGeometry =>
  new THREE.BoxGeometry(w, h, d);
const cyl = (top: number, bottom: number, h: number, seg = 8): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(top, bottom, h, seg);
const cone = (r: number, h: number, seg = 8): THREE.BufferGeometry =>
  new THREE.ConeGeometry(r, h, seg);
const ball = (r: number, w = 6, h = 4): THREE.BufferGeometry =>
  new THREE.SphereGeometry(r, w, h);
/** Halve torus in het XY-vlak: precies een boog, en indexed zodat hij mee kan mergen. */
const arch = (r: number, tube: number): THREE.BufferGeometry =>
  new THREE.TorusGeometry(r, tube, 4, 6, Math.PI);

/**
 * Zet een onderdeel op zijn plek en bakt zijn kleur in de hoekpunten. Dát is de
 * truc waarmee één mesh meerdere kleuren kan hebben: zonder hoekpuntkleuren zou
 * elke kleur een eigen materiaal en dus een eigen tekenopdracht kosten.
 */
function part(
  geo: THREE.BufferGeometry,
  color: string,
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  geo.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  const tint = new THREE.Color(color);
  const count = geo.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geo = mergeGeometries(parts, false);
  // mergeGeometries geeft null als de attributen niet gelijk zijn; dat is een
  // programmeerfout hier en geen toestand om stil doorheen te lopen.
  if (!geo) throw new Error('Landmarks: geometrieën met ongelijke attributen');
  geo.computeBoundingSphere();
  return geo;
}

/** −0,5…0,5, deterministisch. Math.random zou de wereld bij elke render verzetten. */
function jitter(key: string): number {
  return (stableHash(key) % 1000) / 1000 - 0.5;
}

/**
 * Welke tegel staat onder dit wereldpunt. Inverse van `axialToWorld` plus
 * kubus-afronding: zonder die afronding springt een object bij een tegelgrens
 * naar de verkeerde buur en zweeft of zakt het weg.
 */
function hexAt(x: number, z: number): { q: number; r: number } {
  const r = z / HEX_SPACING / 1.5;
  const q = x / HEX_SPACING / Math.sqrt(3) - r / 2;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/** De hoogte waarop iets op dit wereldpunt staat. */
const groundAt = (x: number, z: number): number => groundTop(hexAt(x, z));

// ── De herkenningspunten zelf ────────────────────────────────────────────────

/**
 * Khachkar: rechtopstaande kruissteen. Het kruis ligt in reliëf op de
 * voorplaat, met uitlopende armuiteinden en een rozet eronder — dat is wat een
 * khachkar onderscheidt van een grafsteen. De plaat helt licht achterover
 * (zie de plaatsing) zodat dat vlak onder deze camera licht vangt in plaats van
 * als een streep te verdwijnen.
 */
const FACE = 0.085;
const KHACHKAR_GEO = merge([
  part(box(0.68, 0.13, 0.42), TUFF_OCHRE, [0, 0.065, 0]),
  part(box(0.52, 0.94, 0.15), TUFF_ROSE, [0, 0.6, 0]),
  part(box(0.58, 0.09, 0.2), TUFF_CREAM, [0, 1.11, 0]),
  part(box(0.09, 0.6, 0.05), TUFF_CREAM, [0, 0.62, FACE]),
  part(box(0.36, 0.09, 0.05), TUFF_CREAM, [0, 0.78, FACE]),
  part(box(0.15, 0.055, 0.045), TUFF_CREAM, [0, 0.925, FACE]),
  part(box(0.055, 0.15, 0.045), TUFF_CREAM, [-0.185, 0.78, FACE]),
  part(box(0.055, 0.15, 0.045), TUFF_CREAM, [0.185, 0.78, FACE]),
  part(box(0.15, 0.055, 0.045), TUFF_CREAM, [0, 0.345, FACE]),
  part(cyl(0.11, 0.11, 0.05, 8), TUFF_CREAM, [0, 0.255, FACE - 0.01], [Math.PI / 2, 0, 0]),
  part(box(0.045, 0.94, 0.06), TUFF_SHADE, [-0.238, 0.6, FACE - 0.02]),
  part(box(0.045, 0.94, 0.06), TUFF_SHADE, [0.238, 0.6, FACE - 0.02]),
]);

/**
 * De Cascade: zes terrassen die naar achteren oplopen, met een trap in het
 * midden en balustrades langs de flanken. Elk terras is één blok dat tot 0,5
 * onder nul doorloopt — het terrein onder de hub verloopt met ~0,1 per tegel en
 * een monument van drie eenheden diep kan dat niet volgen; een voet die
 * doorloopt is beter dan een monument dat aan één kant zweeft.
 */
const TERRACES = 6;
const RISE = 0.3;
const RUN = 0.52;
const CASCADE_TOP = TERRACES * RISE;
const CASCADE_DEPTH = TERRACES * RUN;
const terraceWidth = (i: number): number => 3.1 - i * 0.3;

const CASCADE_GEO = merge([
  ...Array.from({ length: TERRACES }, (_, i) => {
    const w = terraceWidth(i);
    const top = (i + 1) * RISE;
    const z = -i * RUN - RUN / 2;
    const parts = [
      part(box(w, top + 0.5, RUN), i % 2 ? TUFF_PINK : TUFF_CREAM, [0, (top - 0.5) / 2, z]),
      part(box(0.18, 0.22, RUN), TUFF_OCHRE, [-(w / 2 - 0.09), top + 0.11, z]),
      part(box(0.18, 0.22, RUN), TUFF_OCHRE, [w / 2 - 0.09, top + 0.11, z]),
    ];
    // Vier treden per terras. Meer treden zijn op deze zoom één grijze wig.
    for (let k = 0; k < 4; k += 1) {
      parts.push(
        part(box(1.1, RISE / 4 + 0.02, 0.1), TUFF_CREAM, [
          0,
          i * RISE + (k + 0.5) * (RISE / 4),
          -i * RUN + 0.36 - k * 0.09,
        ]),
      );
    }
    return parts;
  }).flat(),
  // Het plateau bovenaan draagt Moeder Armenië en de vlag.
  part(box(2.0, CASCADE_TOP + 0.5, 1.2), TUFF_CREAM, [
    0,
    (CASCADE_TOP - 0.5) / 2,
    -CASCADE_DEPTH - 0.6,
  ]),
]);

/**
 * Moeder Armenië: sokkel van tuff, figuur in bronspatina, zwaard horizontaal
 * voor zich. Het zwaard is het enige dat haar op afstand herkenbaar maakt —
 * een verticale figuur zonder dat is een paal.
 */
const MOTHER_GEO = merge([
  part(box(1.0, 0.75, 0.9), TUFF_CREAM, [0, 0.375, 0]),
  part(box(1.12, 0.1, 1.02), TUFF_OCHRE, [0, 0.78, 0]),
  part(cyl(0.17, 0.34, 0.95, 8), PATINA, [0, 1.31, 0]),
  part(box(0.34, 0.4, 0.24), PATINA, [0, 1.95, 0]),
  part(box(0.54, 0.52, 0.09), PATINA, [0, 1.9, -0.13]),
  part(box(0.52, 0.09, 0.1), PATINA, [0, 1.92, 0.14]),
  part(ball(0.12, 8, 6), PATINA, [0, 2.26, 0]),
  part(box(0.05, 1.05, 0.035), STEEL, [0, 1.86, 0.22], [0, 0, Math.PI / 2]),
]);

/**
 * Armeense kerk: kruisvormige plattegrond, zadeldaken op de armen en een
 * achthoekige tamboer met kegeldak op de kruising. Die kegel is het hele punt —
 * het is de vorm die van bovenaf meteen "Armeens" zegt, en een koepel niet.
 */
const CHURCH_GEO = merge([
  part(box(1.5, 0.5, 1.2), TUFF_OCHRE, [0, -0.13, 0]),
  part(box(1.25, 0.62, 0.62), TUFF_PINK, [0, 0.43, 0]),
  part(box(0.6, 0.62, 1.15), TUFF_PINK, [0, 0.43, 0]),
  part(cyl(0.31, 0.31, 0.62, 8), TUFF_PINK, [-0.6, 0.43, 0]),
  part(box(1.28, 0.44, 0.44), SLATE, [0, 0.74, 0], [Math.PI / 4, 0, 0]),
  part(box(0.44, 0.44, 1.18), SLATE, [0, 0.74, 0], [0, 0, Math.PI / 4]),
  part(cyl(0.27, 0.29, 0.5, 8), TUFF_CREAM, [0, 1.05, 0]),
  // Boognissen in de tamboer: vier donkere streepjes die de achthoek verraden.
  ...[0, 1, 2, 3].map((k) =>
    part(box(0.08, 0.26, 0.08), TUFF_SHADE, [
      Math.cos((k * Math.PI) / 2) * 0.28,
      1.05,
      Math.sin((k * Math.PI) / 2) * 0.28,
    ]),
  ),
  part(cone(0.38, 0.5, 8), SLATE, [0, 1.55, 0]),
  part(box(0.04, 0.24, 0.04), STEEL, [0, 1.92, 0]),
  part(box(0.15, 0.04, 0.04), STEEL, [0, 1.95, 0]),
  part(box(0.2, 0.32, 0.06), TUFF_SHADE, [0.63, 0.28, 0]),
]);

/**
 * Tuff-gevel met drie bogen: het Republiekplein-motief. Zuilen, bogen en
 * kroonlijst in lichte tuff, de wand erachter in rose — het contrast tussen die
 * twee is wat de bogen op afstand leesbaar houdt.
 */
const ARCADE_GEO = merge([
  part(box(1.86, 0.62, 0.56), TUFF_OCHRE, [0, -0.2, 0]),
  part(box(1.72, 0.85, 0.16), TUFF_ROSE, [0, 0.53, -0.16]),
  ...[-0.72, -0.24, 0.24, 0.72].map((x) =>
    part(cyl(0.075, 0.085, 0.72, 6), TUFF_CREAM, [x, 0.47, 0.12]),
  ),
  ...[-0.48, 0, 0.48].map((x) => part(arch(0.24, 0.055), TUFF_CREAM, [x, 0.83, 0.12])),
  part(box(1.86, 0.13, 0.62), TUFF_CREAM, [0, 1.0, 0]),
  part(box(1.7, 0.1, 0.5), TUFF_DEEP, [0, 1.1, 0]),
]);

/** Fontein: bekken, waterspiegel, schaal en één straal. */
const FOUNTAIN_GEO = merge([
  part(cyl(0.34, 0.36, 0.16, 10), TUFF_CREAM, [0, 0.08, 0]),
  part(cyl(0.28, 0.28, 0.03, 10), WATER, [0, 0.15, 0]),
  part(cyl(0.07, 0.1, 0.24, 8), TUFF_OCHRE, [0, 0.28, 0]),
  part(cyl(0.16, 0.1, 0.05, 10), TUFF_CREAM, [0, 0.42, 0]),
  part(cyl(0.02, 0.035, 0.3, 5), '#cfe6f2', [0, 0.6, 0]),
]);

/** Beeld op een sokkel, zoals ze langs de Cascade staan. */
const STATUE_GEO = merge([
  part(box(0.26, 0.42, 0.26), TUFF_CREAM, [0, 0.21, 0]),
  part(box(0.3, 0.05, 0.3), TUFF_OCHRE, [0, 0.44, 0]),
  part(cyl(0.075, 0.11, 0.34, 6), BASALT, [0, 0.64, 0]),
  part(box(0.22, 0.09, 0.12), BASALT, [0, 0.8, 0]),
  part(ball(0.065, 6, 5), BASALT, [0, 0.89, 0]),
]);

/**
 * Abrikozenboom. De losse vruchten van de vorige versie zijn eruit: een bol van
 * 0,06 is op standaard-zoom ruim een pixel en kostte 40 driehoeken per stuk.
 * Eén oranje tros aan de rand van de kruin doet hetzelfde werk in het silhouet.
 */
const APRICOT_GEO = merge([
  part(cyl(0.05, 0.085, 0.62, 6), BARK, [0, 0.31, 0]),
  part(ball(0.34, 7, 5), LEAF, [0, 0.86, 0]),
  part(ball(0.24, 6, 4), LEAF_DEEP, [0.2, 0.7, -0.14]),
  part(ball(0.12, 5, 4), APRICOT, [-0.19, 0.8, 0.16]),
]);

/** Granaatappel: lager, donkerder blad, twee rode trossen. */
const POME_GEO = merge([
  part(cyl(0.045, 0.075, 0.44, 6), BARK, [0, 0.22, 0]),
  part(ball(0.3, 7, 5), LEAF_DEEP, [0, 0.66, 0]),
  part(ball(0.2, 6, 4), LEAF, [-0.18, 0.55, 0.15]),
  part(ball(0.1, 5, 4), POME, [0.21, 0.63, 0.1]),
  part(ball(0.085, 5, 4), '#8e2020', [-0.08, 0.8, -0.16]),
]);

// ── Vak-specifieke gebouwen per district ────────────────────────────────────
// Dezelfde maten en silhouetten als voorheen — alleen samengevoegd tot één
// geometrie per soort en op tuff gezet waar het pand eerder wit-grijs was.
// Wat licht geeft blijft een eigen mesh: emissive is een uniform en kan niet in
// een hoekpuntkleur.

const DEPOT_GEO = merge([
  part(box(1.24, 0.12, 0.94), TUFF_OCHRE, [0, 0.06, 0]),
  part(box(1.1, 0.6, 0.8), TUFF_CREAM, [0, 0.42, 0]),
  part(box(1.2, 0.16, 0.9), '#f5c518', [0, 0.8, 0]),
  part(box(0.5, 0.34, 0.3), '#4da3ff', [0.75, 0.29, 0.15]),
  part(box(0.16, 0.26, 0.28), '#dfe8f2', [0.98, 0.29, 0.15]),
]);

const WAREHOUSE_GEO = merge([
  part(box(1.34, 0.12, 1.04), TUFF_OCHRE, [0, 0.06, 0]),
  part(box(1.2, 0.7, 0.9), TUFF_PINK, [0, 0.47, 0]),
  part(box(0.42, 0.5, 0.02), '#9aa5b1', [0, 0.4, 0.46]),
  part(box(0.68, 0.68, 0.95), TUFF_OCHRE, [0, 0.94, 0], [0, 0, Math.PI / 4]),
  part(box(0.42, 0.3, 0.26), '#ffd75e', [0.85, 0.3, 0]),
]);
const WAREHOUSE_GLOW_GEO = merge(
  [-0.4, 0.4].map((x) => part(box(0.16, 0.14, 0.02), '#ffd98a', [x, 0.64, 0.46])),
);

const BILLBOARD_GEO = merge([
  part(cyl(0.05, 0.05, 1, 6), SLATE, [0, 0.5, 0]),
  part(box(0.16, 0.16, 0.3), BASALT, [0.4, 0.24, 0.3], [0.4, 0.6, 0]),
]);
const BILLBOARD_PANEL_GEO = merge([part(box(1.2, 0.66, 0.08), '#ff3fa4', [0, 1.15, 0])]);
const BILLBOARD_SPOT_GEO = merge(
  [-0.45, 0, 0.45].map((x) => part(cone(0.05, 0.1, 6), '#fff3d6', [x, 1.55, 0.08], [0.6, 0, 0])),
);

const STAGE_GEO = merge([
  part(cyl(0.7, 0.75, 0.3, 12), '#3b3347', [0, 0.15, 0]),
  part(box(0.28, 0.3, 0.28), '#7c4dff', [0.25, 0.45, 0.1]),
  ...[-0.62, 0.62].flatMap((x) => [
    part(box(0.16, 0.3, 0.14), '#1e1a26', [x, 0.3, 0.25]),
    part(cyl(0.05, 0.05, 0.01, 10), '#4a4453', [x, 0.34, 0.325], [Math.PI / 2, 0, 0]),
  ]),
]);
const STAGE_ARC_GEO = merge([
  part(new THREE.TorusGeometry(0.55, 0.05, 8, 12, Math.PI), '#ff8a3d', [0, 0.75, -0.3]),
]);

const MIC_GEO = merge([
  part(box(0.36, 0.1, 0.36), TUFF_OCHRE, [0, 0.05, 0]),
  part(cyl(0.09, 0.14, 0.7, 8), '#5b4a6b', [0, 0.4, 0]),
]);
const MIC_HEAD_GEO = merge([part(ball(0.22, 10, 8), '#9b5cff', [0, 0.9, 0])]);

const OBELISK_GEO = merge([
  part(cyl(0.09, 0.2, 1.6, 4), '#d4af37', [0, 0.8, 0]),
]);
const OBELISK_TIP_GEO = merge([part(cone(0.13, 0.24, 4), '#ffd75e', [0, 1.72, 0])]);

const DISTRICT_GEO: Record<string, THREE.BufferGeometry> = {
  'truck-depot': DEPOT_GEO,
  warehouse: WAREHOUSE_GEO,
  billboard: BILLBOARD_GEO,
  stage: STAGE_GEO,
  'mic-statue': MIC_GEO,
  obelisk: OBELISK_GEO,
};

/** Wat licht geeft bij dit gebouw; los omdat emissive niet in hoekpunten past. */
function DistrictGlow({ kind }: { kind: string }): JSX.Element | null {
  switch (kind) {
    case 'warehouse':
      return <mesh geometry={WAREHOUSE_GLOW_GEO} material={GLOW_WARM} dispose={null} />;
    case 'billboard':
      return (
        <>
          <mesh geometry={BILLBOARD_PANEL_GEO} material={GLOW_PINK} castShadow dispose={null} />
          <mesh geometry={BILLBOARD_SPOT_GEO} material={GLOW_SPOT} dispose={null} />
        </>
      );
    case 'stage':
      return <mesh geometry={STAGE_ARC_GEO} material={GLOW_ORANGE} dispose={null} />;
    case 'mic-statue':
      return <mesh geometry={MIC_HEAD_GEO} material={GLOW_VIOLET} dispose={null} />;
    case 'obelisk':
      return <mesh geometry={OBELISK_TIP_GEO} material={GLOW_GOLD} dispose={null} />;
    default:
      return null;
  }
}

/** Wapperende Armeense driekleur op het plateau van de Cascade. */
function ArmenianFlag(): JSX.Element {
  const flag = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (flag.current) {
      flag.current.rotation.y = Math.sin(clock.elapsedTime * 2.2) * 0.25;
      flag.current.scale.x = 1 + Math.sin(clock.elapsedTime * 4.5) * 0.06;
    }
  });
  return (
    <group>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.022, 0.028, 1.1, 6]} />
        <meshStandardMaterial color="#d8d3cc" metalness={0.4} />
      </mesh>
      <group ref={flag} position={[0.26, 0.92, 0]}>
        {(['#d90012', '#0033a0', '#f2a800'] as const).map((color, i) => (
          <mesh key={color} position={[0, 0.1 - i * 0.1, 0]}>
            <planeGeometry args={[0.5, 0.1]} />
            <meshStandardMaterial color={color} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ── Indeling van de wereld ──────────────────────────────────────────────────

interface Piece {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tilt: number;
  scale: number;
  tint: THREE.Color;
}

interface Field {
  khachkars: Piece[];
  statues: Piece[];
  fountains: Piece[];
  arcades: Piece[];
  churches: Piece[];
  apricots: Piece[];
  pomes: Piece[];
}

/**
 * De hub staat schuin: de standaardcamera kijkt vanaf +x/+z, dus een kwartslag
 * zet de trap van de kijker af en het plein ervoor. Zonder die draai kijk je
 * tegen de zijkant van de terrassen aan en verdwijnt de hele trappenpartij.
 */
const HUB_YAW = Math.PI / 4;
const HUB_COS = Math.cos(HUB_YAW);
const HUB_SIN = Math.sin(HUB_YAW);
const hubX = (lx: number, lz: number): number => lx * HUB_COS + lz * HUB_SIN;
const hubZ = (lx: number, lz: number): number => -lx * HUB_SIN + lz * HUB_COS;

/** Een stuk op hubcoördinaten, met de grond eronder opgezocht. */
function hubPiece(
  key: string,
  lx: number,
  lz: number,
  opts: { lift?: number; yaw?: number; tilt?: number; scale?: number } = {},
): Piece {
  const x = hubX(lx, lz);
  const z = hubZ(lx, lz);
  const shade = 0.88 + ((stableHash(key) % 120) / 1000);
  return {
    x,
    y: (opts.lift ?? 0) + groundAt(x, z),
    z,
    yaw: HUB_YAW + (opts.yaw ?? 0),
    tilt: opts.tilt ?? 0,
    scale: opts.scale ?? 1,
    // Lichte verwering per exemplaar: twintig identieke stenen lezen als een
    // kopieerfout, twintig licht verschillende als een steengroeve.
    tint: new THREE.Color(shade + 0.06, shade, shade - 0.03),
  };
}

/** Khachkars staan op een rij langs de trap, met hun snijwerk naar de kijker. */
const HUB_KHACHKARS: [number, number][] = [
  [-2.15, 0.35],
  [-2.15, -0.3],
  [-2.15, -0.95],
  [-2.15, -1.6],
  [-2.15, -2.25],
  [2.15, 0.15],
  [2.15, -0.5],
  [2.15, -1.15],
];

const HUB_TREES: { at: [number, number]; pome?: boolean }[] = [
  { at: [-3.05, 1.5] },
  { at: [3.0, 1.2] },
  { at: [-2.6, -2.9], pome: true },
  { at: [2.6, -2.75], pome: true },
  { at: [-3.5, 2.5], pome: true },
  { at: [3.45, 2.4], pome: true },
  { at: [-1.4, 4.2] },
  { at: [1.45, 4.25] },
  { at: [-2.5, 4.0], pome: true },
  { at: [2.55, 4.05], pome: true },
  { at: [-4.0, 0.2] },
  { at: [3.95, -0.4] },
];

function buildField(world: WorldConfig | null, perfLow: boolean): Field {
  const field: Field = {
    khachkars: [],
    statues: [],
    fountains: [],
    arcades: [],
    churches: [],
    apricots: [],
    pomes: [],
  };

  // ── Hub: Cascade, Republiekplein, kerk en tuin ──
  for (const [i, [lx, lz]] of HUB_KHACHKARS.entries()) {
    if (perfLow && i % 2 === 1) continue;
    field.khachkars.push(
      hubPiece(`hub-kh-${i}`, lx, lz, {
        yaw: jitter(`hub-kh-yaw-${i}`) * 0.3,
        // Achterover: een verticaal vlak vangt onder deze camera nauwelijks
        // licht, een helling van ~10° laat het snijwerk juist oplichten.
        tilt: -0.16,
        scale: 0.9 + jitter(`hub-kh-s-${i}`) * 0.18,
      }),
    );
  }

  // Beelden op de balustrades, om de twee terrassen. Elk terras bezetten maakt
  // er een hek van; om en om leest als een reeks.
  if (!perfLow) {
    for (const i of [0, 2, 4]) {
      const w = terraceWidth(i);
      const lift = (i + 1) * RISE + 0.22;
      const lz = -i * RUN - RUN / 2;
      field.statues.push(hubPiece(`stat-l-${i}`, -(w / 2 - 0.09), lz, { lift, scale: 0.78 }));
      field.statues.push(hubPiece(`stat-r-${i}`, w / 2 - 0.09, lz, { lift, scale: 0.78 }));
    }
  }

  // Fonteinrij op het plein: zeven kleine op een lijn, één grote erachter.
  for (let k = 0; k < 7; k += 1) {
    field.fountains.push(hubPiece(`fnt-${k}`, -1.8 + k * 0.6, 1.7, { scale: 0.92 }));
  }
  field.fountains.push(hubPiece('fnt-big', 0, 2.75, { scale: 1.5 }));

  // Tuff-gevels: drie aan de achterkant van het plein, twee opzij, twee
  // flankerend bij de voet van de trap.
  for (const [k, lx] of [-1.85, 0, 1.85].entries()) {
    field.arcades.push(hubPiece(`arc-b-${k}`, lx, 3.55, { yaw: Math.PI }));
  }
  field.arcades.push(hubPiece('arc-l', -3.05, 1.7, { yaw: Math.PI / 2 }));
  field.arcades.push(hubPiece('arc-r', 3.05, 1.7, { yaw: -Math.PI / 2 }));
  if (!perfLow) {
    field.arcades.push(hubPiece('arc-cl', -2.45, -0.75, { yaw: Math.PI / 2 }));
    field.arcades.push(hubPiece('arc-cr', 2.45, -0.75, { yaw: -Math.PI / 2 }));
  }

  field.churches.push(hubPiece('church', -3.5, -1.4, { yaw: 0.55, scale: 1.15 }));
  field.churches.push(hubPiece('chapel', 3.4, -1.8, { yaw: -0.7, scale: 0.7 }));

  for (const [i, tree] of HUB_TREES.entries()) {
    if (perfLow && tree.pome) continue;
    const piece = hubPiece(`hub-tree-${i}`, tree.at[0], tree.at[1], {
      yaw: jitter(`hub-tree-yaw-${i}`) * 3,
      scale: 0.85 + jitter(`hub-tree-s-${i}`) * 0.3,
    });
    (tree.pome ? field.pomes : field.apricots).push(piece);
  }

  // ── Districten: een khachkar en wat boomgaard bij het vak-gebouw ──
  for (const district of world?.districts ?? []) {
    const { x, z } = axialToWorld(district.center);
    const cx = x * HEX_SPACING;
    const cz = z * HEX_SPACING;
    const id = district.venture.id;
    const spot = (lx: number, lz: number, key: string, scale: number): Piece => {
      const px = cx + lx;
      const pz = cz + lz;
      const shade = 0.88 + ((stableHash(key) % 120) / 1000);
      return {
        x: px,
        y: groundAt(px, pz),
        z: pz,
        // Naar de kijker toe: de hele wereld wordt vanuit +x/+z bekeken.
        yaw: HUB_YAW + jitter(`${key}-yaw`) * 0.5,
        tilt: 0,
        scale,
        tint: new THREE.Color(shade + 0.06, shade, shade - 0.03),
      };
    };
    const kh = spot(-1.05, 0.85, `${id}-kh`, 0.85);
    kh.tilt = -0.16;
    field.khachkars.push(kh);
    field.apricots.push(spot(0.95, -0.65, `${id}-ap`, 0.85));
    field.apricots.push(spot(-0.6, -1.05, `${id}-ap2`, 0.7));
    if (!perfLow) field.pomes.push(spot(1.15, 0.75, `${id}-po`, 0.8));
  }

  return field;
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const pos = new THREE.Vector3();
const scale = new THREE.Vector3();

/**
 * Matrices en kleuren eenmalig wegschrijven. `count` blijft minimaal 1, anders
 * staat er een los exemplaar op de oorsprong zodra een soort niet voorkomt.
 */
function place(items: Piece[]): (mesh: THREE.InstancedMesh | null) => void {
  return (mesh) => {
    if (!mesh) return;
    items.forEach((item, i) => {
      euler.set(item.tilt, item.yaw, 0, 'YXZ');
      quat.setFromEuler(euler);
      pos.set(item.x, item.y, item.z);
      scale.setScalar(item.scale);
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, item.tint);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
}

/** Eén soort herkenningspunt: alle exemplaren in één tekenopdracht. */
function Instanced({
  items,
  geometry,
  material,
  shadows,
  name,
}: {
  items: Piece[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  shadows: boolean;
  name: string;
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <instancedMesh
      key={`${name}-${items.length}`}
      args={[undefined, undefined, items.length]}
      ref={place(items)}
      castShadow={shadows}
      receiveShadow={shadows}
    >
      <primitive object={geometry} attach="geometry" dispose={null} />
      <primitive object={material} attach="material" dispose={null} />
    </instancedMesh>
  );
}

export function Landmarks({ world }: { world: WorldConfig | null }): JSX.Element {
  const perfLow = useAra((s) => s.perfLow);
  const field = useMemo(() => buildField(world, perfLow), [world, perfLow]);
  const districts = useMemo(() => {
    if (!world) return [];
    return world.districts.map((district) => {
      const { x, z } = axialToWorld(district.center);
      return {
        key: district.venture.id,
        kind: district.venture.landmark,
        position: new THREE.Vector3(
          x * HEX_SPACING,
          groundTop(district.center),
          z * HEX_SPACING,
        ),
      };
    });
  }, [world]);

  const hubY = groundAt(0, 0);
  const shadows = !perfLow;

  return (
    <group>
      {/* De Cascade en wat erbovenop staat vormen samen één bouwwerk; ze delen
          daarom één draaiing en één grondhoogte. */}
      <group position={[0, hubY, 0]} rotation={[0, HUB_YAW, 0]}>
        <mesh
          geometry={CASCADE_GEO}
          material={STONE_MATERIAL}
          castShadow={shadows}
          receiveShadow={shadows}
          dispose={null}
        />
        <mesh
          geometry={MOTHER_GEO}
          material={STONE_MATERIAL}
          position={[0, CASCADE_TOP, -CASCADE_DEPTH - 0.6]}
          castShadow={shadows}
          dispose={null}
        />
        <group position={[-0.85, CASCADE_TOP, -CASCADE_DEPTH - 0.35]}>
          <ArmenianFlag />
        </group>
      </group>

      <Instanced name="khachkar" items={field.khachkars} geometry={KHACHKAR_GEO} material={STONE_MATERIAL} shadows={shadows} />
      <Instanced name="church" items={field.churches} geometry={CHURCH_GEO} material={STONE_MATERIAL} shadows={shadows} />
      <Instanced name="arcade" items={field.arcades} geometry={ARCADE_GEO} material={STONE_MATERIAL} shadows={shadows} />
      <Instanced name="fountain" items={field.fountains} geometry={FOUNTAIN_GEO} material={STONE_MATERIAL} shadows={shadows} />
      <Instanced name="statue" items={field.statues} geometry={STATUE_GEO} material={STONE_MATERIAL} shadows={shadows} />
      <Instanced name="apricot" items={field.apricots} geometry={APRICOT_GEO} material={CANOPY_MATERIAL} shadows={shadows} />
      <Instanced name="pome" items={field.pomes} geometry={POME_GEO} material={CANOPY_MATERIAL} shadows={shadows} />

      {districts.map(({ key, kind, position }) => {
        const geometry = DISTRICT_GEO[kind];
        return (
          <group key={key} position={position}>
            {geometry && (
              <mesh
                geometry={geometry}
                material={kind === 'obelisk' ? GOLD_MATERIAL : STONE_MATERIAL}
                castShadow={shadows}
                receiveShadow={shadows}
                dispose={null}
              />
            )}
            <DistrictGlow kind={kind} />
          </group>
        );
      })}
    </group>
  );
}

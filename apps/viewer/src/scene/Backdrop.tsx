import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stableHash } from '@ara/shared';
import { useDaylight } from './daylight.ts';

/**
 * Ararat, de hemelkoepel en de wolken.
 *
 * **Waarom de bergen zijn zoals ze zijn.** Twee fouten, in deze volgorde.
 *
 * De eerste was de *vorm*: gladde kegels met één vlakke kleur en hun voet boven
 * de horizon. Dat leest onder deze camera als een paarse schijf. Daarvoor zijn
 * `peak()` en het horizonvlak gemaakt — geribde flanken, een holle helling, een
 * gekartelde sneeuwgrens, het licht in de hoekpunten gebakken, en de voet onder
 * y = −8,6 zodat alleen het silhouet erboven overblijft.
 *
 * De tweede was de *plek*, en die bleef staan toen de vorm al klopte. Een berg
 * die verder naar achteren staat, komt in beeld omhoog: 0,44 eenheid per
 * eenheid diepte (zie `placeSummit`). Masis stond 27 eenheden achter de wereld
 * en 19,6 hoog, en dus kwam zijn top negen eenheden boven de bovenrand uit. Op
 * het scherm bleef er één vlak stuk flank over — geen top, geen sneeuwgrens,
 * geen silhouet. Precies wat de eigenaar zag, en precies wat een mooiere kegel
 * niet oplost.
 *
 * Daarom staat elke top hier in beeldtermen beschreven (`r`, `u`) en rekent
 * `placeSummit` de wereldplek erbij. Wat je opgeeft is wat je ziet.
 *
 * De hele massief (Masis, Sis, het zadel ertussen en de keten eromheen) is één
 * samengevoegde geometrie met hoekpuntkleuren: één tekenopdracht voor alle
 * bergen samen.
 */

// ── Bergbouw ────────────────────────────────────────────────────────────────

/** Zon van de scene, genormaliseerd — zie `directionalLight` in Scene.tsx. */
const SUN = new THREE.Vector3(18, 26, 10).normalize();

const ROCK_LIT = new THREE.Color('#8d84b4');
const ROCK_DARK = new THREE.Color('#463f68');
const SNOW_LIT = new THREE.Color('#fbf7ff');
const SNOW_DARK = new THREE.Color('#c3c4e6');
/** De verre keten verdwijnt in de lucht; dat is wat afstand doet. */
const HAZE = new THREE.Color('#b9b4d6');

interface PeakSpec {
  x: number;
  z: number;
  /** Hoogte van de voet; onder -8,6 zit hij achter het horizonvlak. */
  base: number;
  height: number;
  radius: number;
  /** Deel van de hoogte waarboven sneeuw ligt; 1 = geen sneeuw. */
  snow: number;
  /** Vaste sleutel voor de ribben — nooit Math.random, de berg mag niet schuiven. */
  seed: string;
  segments?: number;
  rings?: number;
  /** 0 = scherpe berg vlakbij, 1 = volledig in de nevel opgelost. */
  haze?: number;
  /** De top helt opzij; een perfect symmetrische kegel leest als een hoed. */
  lean?: number;
  /** Bak licht en schaduw in de hoekpunten (voor een `basic` materiaal). */
  shade?: boolean;
}

/** −0,5…0,5, deterministisch. */
function jitter(key: string): number {
  return (stableHash(key) % 1000) / 1000 - 0.5;
}

/**
 * Eén piek: een kegel met geribde flanken, een holle helling en een gekartelde
 * sneeuwgrens, met de kleuren per facet in de hoekpunten gebakken.
 */
function peak(spec: PeakSpec): THREE.BufferGeometry {
  const segments = spec.segments ?? 9;
  const rings = spec.rings ?? 4;
  const haze = spec.haze ?? 0;
  const lean = spec.lean ?? 0;
  // Open onderkant: de voet zit onder de horizon, dus een bodemvlak zou alleen
  // driehoeken kosten die niemand ooit ziet.
  const geo = new THREE.ConeGeometry(1, 1, segments, rings, true);

  const position = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const r1 = jitter(`${spec.seed}:r1`) * Math.PI;
  const r2 = jitter(`${spec.seed}:r2`) * Math.PI;
  for (let i = 0; i < position.count; i += 1) {
    // De kegel loopt van y=-0,5 (voet) tot y=+0,5 (top).
    const h = position.getY(i) + 0.5;
    // De hoek komt uit de uv en niet uit x/z: in de topring is x=z=0 en zou de
    // richting daar onbepaald zijn — dan klapt de top dicht tot een punt.
    const theta = uv.getX(i) * Math.PI * 2;
    // Ribben: drie grote graten met een fijnere er overheen. Dat is wat een
    // berg een silhouet geeft; een gladde kegel houdt een cirkelomtrek.
    const ridge =
      1 + Math.sin(theta * 3 + r1) * 0.17 + Math.sin(theta * 7 + r2) * 0.08;
    // Holle flank: onderaan breed uitlopend, bovenin steil. Een rechte kegel
    // is een tent, een holle helling is een berg.
    const radius = Math.pow(1 - h, 1.3) * ridge * spec.radius;
    position.setX(i, Math.sin(theta) * radius + h * h * lean);
    position.setZ(i, Math.cos(theta) * radius);
    position.setY(i, h * spec.height);
  }

  // Per facet kleuren: daarvoor moet elke driehoek eigen hoekpunten hebben.
  const flat = geo.toNonIndexed();
  geo.dispose();
  flat.computeVertexNormals();
  const p = flat.attributes.position as THREE.BufferAttribute;
  const n = flat.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const color = new THREE.Color();
  const normal = new THREE.Vector3();
  for (let tri = 0; tri < p.count; tri += 3) {
    // Facetnormaal: het gemiddelde van de drie is hier de normaal zelf, want na
    // toNonIndexed deelt niets meer een hoekpunt.
    normal.set(0, 0, 0);
    let y = 0;
    let theta = 0;
    for (let k = 0; k < 3; k += 1) {
      normal.x += n.getX(tri + k);
      normal.y += n.getY(tri + k);
      normal.z += n.getZ(tri + k);
      y += p.getY(tri + k) / 3;
      theta += Math.atan2(p.getX(tri + k), p.getZ(tri + k)) / 3;
    }
    normal.normalize();
    const h = y / spec.height;
    // Gekartelde sneeuwgrens: een rechte lijn rond een berg leest als een
    // streep verf. De grens golft per richting.
    const line = spec.snow + Math.sin(theta * 4 + r1) * 0.07 + Math.sin(theta * 9 + r2) * 0.03;
    const snowy = h > line;
    const light = THREE.MathUtils.clamp(normal.dot(SUN) * 0.5 + 0.5, 0, 1);
    const lit = spec.shade === false ? 0.72 : Math.pow(light, 1.35);
    color.copy(snowy ? SNOW_DARK : ROCK_DARK).lerp(snowy ? SNOW_LIT : ROCK_LIT, lit);
    if (haze > 0) color.lerp(HAZE, haze);
    for (let k = 0; k < 3; k += 1) {
      colors[(tri + k) * 3] = color.r;
      colors[(tri + k) * 3 + 1] = color.g;
      colors[(tri + k) * 3 + 2] = color.b;
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.translate(spec.x, spec.base, spec.z);
  return flat;
}

function massif(specs: PeakSpec[]): THREE.BufferGeometry {
  const geo = mergeGeometries(specs.map(peak), false);
  if (!geo) throw new Error('Backdrop: geometrieën met ongelijke attributen');
  geo.computeBoundingSphere();
  return geo;
}

/** Hoogte van het horizonvlak; alles wat hieronder begint is verborgen. */
const HORIZON_Y = -8.6;

/**
 * Waar een top op het scherm uitkomt, terugvertaald naar wereldcoördinaten.
 *
 * Onder de ortho-camera (positie 14,16,14, kijkend naar de oorsprong) projecteert
 * een wereldpunt op
 *
 *     r = 0,7071·(x − z)                 — naar rechts, in wereldeenheden
 *     u = −0,4445·(x + z) + 0,7780·y     — omhoog, in wereldeenheden
 *
 * De rustzoom is `min(breedte, hoogte) / 27,2`, dus op 1440×900 is het halve
 * beeld 21,8 breed en **13,6 hoog**.
 *
 * Dat tweede getal is waar de vorige versie op stukliep. Masis stond 19,6 hoog
 * met zijn voet 27 eenheden achter de wereld; die top komt uit op u = 23,5 —
 * ruim negen eenheden bóven de bovenrand. Je zag dus de flank en nooit de top,
 * en een flank zonder top is precies wat de eigenaar beschreef: een paarse muur
 * naast de wereld. Slanker maken hielp niet, want de fout zat niet in de vorm
 * maar in de plek: elke eenheid die een berg verder naar achteren gaat, duwt
 * hem 0,44 eenheid omhoog in beeld.
 *
 * Daarom wordt een berg hier neergezet op de plek waar zijn **top** hoort te
 * staan, en niet op een plek waarvan je maar moet afwachten wat ervan te zien
 * is. `lean` verschuift de top in lokale x, dus die wordt er meteen af gerekend.
 */
const P_R = 0.70711;
const P_S = -0.44450;
const P_Y = 0.77796;

function placeSummit(r: number, u: number, base: number, height: number, lean: number): {
  x: number;
  z: number;
} {
  const d = r / P_R; // x − z
  const s = (u - P_Y * (base + height)) / P_S; // x + z
  return { x: (s + d) / 2 - lean, z: (s - d) / 2 };
}

/** Een top, beschreven in beeldtermen; de wereldplek volgt eruit. */
interface Placed extends Omit<PeakSpec, 'x' | 'z'> {
  /** Waar de top hoort te staan: naar rechts en omhoog, in wereldeenheden. */
  r: number;
  u: number;
}

function placed(specs: Placed[]): THREE.BufferGeometry {
  return massif(
    specs.map(({ r, u, ...rest }) => ({
      ...rest,
      ...placeSummit(r, u, rest.base, rest.height, rest.lean ?? 0),
    })),
  );
}

/** Hoogste top die nog vrij van de bovenbalk blijft (48 px ≈ 1,45 eenheid). */
const SKY_TOP = 11.4;

/**
 * Masis (5137 m) en Sis (3896 m) met het zadel ertussen, plus een keten die om
 * de hele horizon doorloopt. De dubbele top ís Ararat: één piek is zomaar een
 * berg.
 *
 * De toppen staan links van het midden, want dáár is lucht: de wereldschijf
 * komt in het midden tot u ≈ 9,6 en bij r = −10 nog maar tot 6,8. Van Masis is
 * daardoor ruim vier eenheden silhouet te zien in plaats van een strook flank.
 * De verre keten loopt door tot achter de rechterhelft, zodat de bergen áchter
 * de wereld staan in plaats van ernaast.
 *
 * Alle `snow`-grenzen liggen nu onder de horizonlijn van de wereldschijf: de
 * sneeuwgrens moet zichtbaar zijn, anders is hij er niet.
 */
const ARARAT_GEO = placed([
  // Masis — de grote, links. Top op 11,4: net onder de bovenbalk.
  { r: -10.5, u: SKY_TOP, base: HORIZON_Y - 1.2, height: 8.2, radius: 6.6, snow: 0.42, seed: 'masis', segments: 11, rings: 5, lean: 0.7 },
  // Het zadel: laag en breed, zodat de twee toppen één massief vormen.
  { r: -7.2, u: 9.4, base: HORIZON_Y - 1.2, height: 5.2, radius: 4.6, snow: 0.72, seed: 'zadel', segments: 8, rings: 3, lean: -0.35 },
  // Sis — de kleine, rechts van Masis en iets naar voren.
  { r: -4.0, u: 10.3, base: HORIZON_Y - 1.2, height: 6.4, radius: 4.4, snow: 0.5, seed: 'sis', segments: 9, rings: 4, lean: -0.55 },
  // Keten: diepte naast en achter de hoofdtoppen, oplopend in de nevel.
  { r: -17.5, u: 9.6, base: HORIZON_Y - 1.2, height: 5.6, radius: 6.2, snow: 0.66, seed: 'keten-a', segments: 7, rings: 3, haze: 0.45, lean: 0.8 },
  { r: -21.0, u: 8.8, base: HORIZON_Y - 1.2, height: 4.8, radius: 6.0, snow: 0.8, seed: 'keten-b', segments: 7, rings: 2, haze: 0.62 },
  { r: 3.0, u: 9.2, base: HORIZON_Y - 1.2, height: 5.0, radius: 5.8, snow: 0.74, seed: 'keten-c', segments: 7, rings: 3, haze: 0.58, lean: -0.6 },
  { r: 10.5, u: 10.2, base: HORIZON_Y - 1.2, height: 6.0, radius: 7.0, snow: 0.6, seed: 'keten-d', segments: 8, rings: 3, haze: 0.4, lean: 0.5 },
  { r: 18.0, u: 9.2, base: HORIZON_Y - 1.2, height: 4.6, radius: 6.2, snow: 0.78, seed: 'keten-e', segments: 6, rings: 2, haze: 0.68, lean: -0.9 },
]);

/**
 * Basic en niet lit: deze bergen staan buiten het bereik van de schaduwkaart en
 * ver buiten de wereld. Hun licht zit in de hoekpunten. De materiaalkleur is de
 * enige knop die het dagdeel nog draait — één uniform voor de hele massief.
 */
const ARARAT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });

/** Klein-Ararat draagt de Ark en staat in de wereld zelf, dus wél belicht. */
const LITTLE_GEO = massif([
  { x: 0, z: 0, base: 0, height: 5.6, radius: 1.95, snow: 0.55, seed: 'sis-klein', segments: 9, rings: 4, lean: 0.25, shade: false },
]);
const LITTLE_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.92,
});

/** Tint per dagdeel: overdag onaangeroerd, 's nachts een blauwe schaduw. */
const TINTS: Record<string, string> = {
  day: '#ffffff',
  dawn: '#ffd7c0',
  dusk: '#e8bcc6',
  night: '#5b6194',
};

/** De Ark van Noach op de sneeuwgrens, met een witte duif die rondjes vliegt. */
function NoahsArk(): JSX.Element {
  const dove = useRef<THREE.Group>(null);
  const wingL = useRef<THREE.Mesh>(null);
  const wingR = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.5;
    if (dove.current) {
      dove.current.position.set(
        Math.cos(t) * 1.5,
        // Boven de ark, niet erdoorheen: de berg is hoger dan hij was.
        3.9 + Math.sin(t * 1.7) * 0.3,
        Math.sin(t) * 1.5,
      );
      dove.current.rotation.y = -t - Math.PI / 2;
    }
    // Twee vleugels die tegen elkaar in slaan. Eén balk die om de vliegrichting
    // rolt ziet eruit als een vogel die scheef hangt, niet als een die vliegt —
    // dezelfde fout die de zwerm in Doves.tsx had.
    const beat = Math.sin(clock.elapsedTime * 9) * 0.6;
    if (wingL.current) wingL.current.rotation.z = -beat;
    if (wingR.current) wingR.current.rotation.z = beat;
  });

  return (
    <group>
      {/* Ark op de sneeuwgrens: romp, dek en hut */}
      {/* De hoogte volgt de helling: bij y=2,6 is de berg hier 0,86 breed, dus
          een ark met zijn hart op 0,74 van de as ligt half ingegraven op de
          flank in plaats van ernaast te zweven of erin te verdwijnen. */}
      <group position={[0.55, 2.62, 0.5]} rotation={[0, 0.8, -0.12]} scale={0.62}>
        <mesh>
          <boxGeometry args={[2.3, 0.55, 0.95]} />
          <meshBasicMaterial color="#7a4a2b" fog={false} />
        </mesh>
        <mesh position={[0, 0.34, 0]}>
          <boxGeometry args={[2.42, 0.14, 1.06]} />
          <meshBasicMaterial color="#5c3820" fog={false} />
        </mesh>
        <mesh position={[0, 0.62, 0]}>
          <boxGeometry args={[1.25, 0.5, 0.65]} />
          <meshBasicMaterial color="#8a5a35" fog={false} />
        </mesh>
        <mesh position={[0, 0.94, 0]}>
          <boxGeometry args={[1.4, 0.14, 0.8]} />
          <meshBasicMaterial color="#5c3820" fog={false} />
        </mesh>
        {/* raampje dat warm licht geeft */}
        <mesh position={[0, 0.62, 0.34]}>
          <boxGeometry args={[0.22, 0.22, 0.02]} />
          <meshBasicMaterial color="#ffd98a" fog={false} />
        </mesh>
      </group>
      {/* De duif */}
      <group ref={dove} scale={0.35}>
        <mesh>
          <sphereGeometry args={[0.16, 8, 6]} />
          <meshBasicMaterial color="#ffffff" fog={false} />
        </mesh>
        <mesh ref={wingL} position={[-0.02, 0, 0]}>
          <boxGeometry args={[0.42, 0.03, 0.2]} />
          <meshBasicMaterial color="#f2f2f2" fog={false} />
        </mesh>
        <mesh ref={wingR} position={[0.02, 0, 0]}>
          <boxGeometry args={[0.42, 0.03, 0.2]} />
          <meshBasicMaterial color="#f2f2f2" fog={false} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Ararat silhouette (Masis + Sis), day/night sky dome and drifting clouds.
 * All procedural, cartoon-flat materials so the orthographic camera can't
 * catch them unlit.
 */
export function Backdrop(): JSX.Element {
  const cloudsRef = useRef<THREE.Group>(null);
  const daylight = useDaylight();

  const skyMaterial = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, daylight.stops[0]);
    gradient.addColorStop(0.55, daylight.stops[1]);
    gradient.addColorStop(0.82, daylight.stops[2]);
    gradient.addColorStop(1, daylight.stops[3]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
  }, [daylight.stops]);

  // Eén uniform voor de hele massief; geen nieuw materiaal per dagdeel, anders
  // staan er aan het eind van de dag vier in het geheugen.
  useEffect(() => {
    ARARAT_MAT.color.set(TINTS[daylight.period] ?? '#ffffff');
  }, [daylight.period]);

  const clouds = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        angle: (i / 8) * Math.PI * 2,
        radius: 16 + (i % 4) * 4,
        y: 7 + (i % 5) * 1.2,
        scale: 0.9 + (i % 3) * 0.5,
        speed: 0.006 + (i % 3) * 0.004,
      })),
    [],
  );

  useFrame((_, delta) => {
    cloudsRef.current?.children.forEach((cloud, i) => {
      const c = clouds[i]!;
      c.angle += c.speed * delta * 10;
      cloud.position.set(Math.cos(c.angle) * c.radius, c.y, Math.sin(c.angle) * c.radius);
    });
  });

  return (
    <group>
      {/* Upper-hemisphere sky dome only; below horizon the scene bg shows. */}
      <mesh material={skyMaterial} renderOrder={-10}>
        <sphereGeometry args={[80, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {/* Het vlak onder de horizon. Dit stond op een vast roze (#b98d84) en
          dat viel nooit op zolang de camera ver ingezoomd stond — je zag het
          niet. Zodra de wereld in beeld past vult deze schijf van straal 80 het
          hele frame, en dan is een vaste kleur een roze leegte die niets met
          het dagdeel te maken heeft. Nu volgt hij de horizonkleur van hetzelfde
          palet als de koepel, dus de twee sluiten op elkaar aan.

          Hij doet nog iets tweedes: hij snijdt de voet van de bergen af. Die
          staan er met hun grondvlak onder, dus je ziet alleen het silhouet dat
          erboven uitkomt — een berg die opkomt tegen de vlakte in plaats van
          een kegel die ernaast zweeft. */}
      <mesh position={[0, HORIZON_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-9}>
        <circleGeometry args={[120, 48]} />
        <meshBasicMaterial color={daylight.stops[3]} fog={false} />
      </mesh>

      {/* Ararat: één massief, één tekenopdracht. Geen groepsverschuiving meer —
          elke top staat al op zijn eigen wereldplek, uitgerekend uit waar zijn
          punt in beeld hoort te komen (zie `placeSummit`). Een offset hier zou
          die rekensom stilletjes ongedaan maken. */}
      <mesh geometry={ARARAT_GEO} material={ARARAT_MAT} dispose={null} />

      {/* Klein-Ararat aan de zuidwestrand: altijd in beeld, met de Ark erop */}
      <group position={[-7.2, -0.2, 12]}>
        <mesh geometry={LITTLE_GEO} material={LITTLE_MAT} dispose={null} castShadow />
        <NoahsArk />
      </group>

      <group ref={cloudsRef}>
        {clouds.map((cloud, i) => (
          <group key={i} scale={[cloud.scale, cloud.scale * 0.5, cloud.scale]}>
            <mesh>
              <sphereGeometry args={[1, 8, 6]} />
              <meshBasicMaterial color="#fbeee6" transparent opacity={0.85} fog={false} depthWrite={false} />
            </mesh>
            <mesh position={[1.1, 0.1, 0.2]} scale={0.7}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshBasicMaterial color="#fbeee6" transparent opacity={0.8} fog={false} depthWrite={false} />
            </mesh>
            <mesh position={[-1, 0, -0.1]} scale={0.6}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshBasicMaterial color="#fff6ef" transparent opacity={0.8} fog={false} depthWrite={false} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

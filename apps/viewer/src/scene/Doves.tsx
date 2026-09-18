import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stableHash } from '@ara/shared';
import { useAra } from '../store.ts';

/**
 * Een duivenzwerm boven de wereld.
 *
 * Geen boids met echte buur-regels: dat kost rekentijd per vogel per frame en
 * het is op deze afstand niet te zien. In plaats daarvan volgt elke duif
 * hetzelfde traag drijvende zwaartepunt met zijn eigen vaste afwijking erop.
 * Dat leest van bovenaf als een zwerm — samenhangend, maar niet als een
 * starre formatie, omdat elke vogel zijn eigen fase heeft.
 *
 * Bij een selectie schrikken ze op: het zwaartepunt schiet omhoog en de zwerm
 * waaiert uit, en zakt daarna in een paar seconden terug. Dat is het enige
 * moment waarop ze ergens op reageren, en het maakt een klik voelbaar.
 *
 * **Waarom de vleugels in twee instanced meshes zitten.** Ze zaten in één
 * balk die om de vliegrichting rolde. Dat is geen vleugelslag maar een
 * dwarsrol: op een screenshot staat de vogel dan tot 49° scheef en leest hij
 * als een glitch, niet als een zwevende duif. Een vleugelslag is symmetrisch —
 * beide vleugels gaan tegelijk omhoog en omlaag — en dat kan alleen als links
 * en rechts hun eigen matrix hebben. Eén tekenopdracht extra (drie in totaal),
 * en de vogel vliegt weer waterpas.
 *
 * Schuin gaat hij alleen nog in een bocht, en dan naar binnen zoals een vogel
 * dat doet: de helling komt uit de gemeten draaisnelheid van de zwerm en is
 * klein genoeg (max ~0,2 rad) om als vliegen te lezen in plaats van als fout.
 */

const COUNT = 22;

/** Vleugel vanaf de schouder naar buiten: de matrix draait hem om zijn wortel. */
function wing(side: 1 | -1): THREE.BufferGeometry {
  const span = 0.3;
  const geo = new THREE.BoxGeometry(span, 0.011, 0.085);
  // Het scharnier ligt in de oorsprong, niet in het midden van de balk —
  // anders zwaait de vleugel dwars door het lijf heen.
  geo.translate((span / 2) * side, 0, 0);
  return geo;
}
const WING_L_GEO = wing(-1);
const WING_R_GEO = wing(1);

/**
 * Romp met staart. Een bol alleen is op deze afstand een stip; de staart geeft
 * de richting weg en dát maakt er een vogel van. Eén samengevoegde geometrie,
 * dus nog steeds één tekenopdracht.
 */
const BODY_GEO = (() => {
  const torso = new THREE.SphereGeometry(0.055, 6, 5);
  torso.scale(0.8, 0.8, 1.5); // langgerekt in de vliegrichting (+z)
  const tail = new THREE.ConeGeometry(0.045, 0.16, 4);
  // Kegel wijst standaard omhoog; kantel hem naar achteren (-z).
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0, -0.12);
  const head = new THREE.SphereGeometry(0.032, 5, 4);
  head.translate(0, 0.012, 0.075);
  const geo = mergeGeometries([torso, tail, head], false);
  if (!geo) throw new Error('Doves: geometrieën met ongelijke attributen');
  return geo;
})();

const BIRD_MAT = new THREE.MeshStandardMaterial({
  color: '#f4f2ee',
  roughness: 0.8,
  // Ze vliegen hoog en vangen daar meer licht dan de grond eronder.
  emissive: '#6a7590',
  emissiveIntensity: 0.25,
});

interface Bird {
  /** Vaste afwijking ten opzichte van het zwaartepunt van de zwerm. */
  dx: number;
  dy: number;
  dz: number;
  phase: number;
  flap: number;
}

/** 0…1, deterministisch — twee schermen tonen dezelfde zwerm. */
function rnd(key: string): number {
  return (stableHash(key) % 1000) / 1000;
}

export function Doves(): JSX.Element | null {
  const perfLow = useAra((s) => s.perfLow);
  const selected = useAra((s) => s.selectedSessionId);

  const birds = useMemo(
    (): Bird[] =>
      Array.from({ length: COUNT }, (_, i) => {
        // Gouden hoek: verdeelt de vogels over de zwerm zonder ringen of
        // klonten, wat je met een gelijkmatige hoek wél krijgt.
        const angle = i * 2.399963;
        const radius = 0.6 + Math.sqrt(i / COUNT) * 3.4;
        return {
          dx: Math.cos(angle) * radius,
          dy: (rnd(`dove:${i}:y`) - 0.5) * 1.5,
          dz: Math.sin(angle) * radius * 0.8,
          phase: (i / COUNT) * Math.PI * 2,
          // Niet elke duif slaat even snel; een zwerm die in de maat klapt
          // leest als één object.
          flap: 7.5 + rnd(`dove:${i}:flap`) * 3.5,
        };
      }),
    [],
  );

  const bodies = useRef<THREE.InstancedMesh>(null);
  const wingsL = useRef<THREE.InstancedMesh>(null);
  const wingsR = useRef<THREE.InstancedMesh>(null);
  const startle = useRef(0);
  const lastSelected = useRef<string | null>(null);
  /** Vorige koers + de gedempte helling die eruit volgt (voor de bocht). */
  const lastHeading = useRef(0);
  const bank = useRef(0);

  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  // 'YXZ': eerst rollen in het lichaamsassenstelsel, dan de neus omhoog, dan
  // de koers. In de standaardvolgorde rolt de vogel om de wereld-as en gaat
  // hij in een bocht dwars hangen.
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);

  useFrame(({ clock }, delta) => {
    const body = bodies.current;
    const left = wingsL.current;
    const right = wingsR.current;
    if (!body || !left || !right) return;

    if (selected !== lastSelected.current) {
      lastSelected.current = selected;
      if (selected) startle.current = 1;
    }
    startle.current = Math.max(0, startle.current - delta * 0.45);
    const shock = startle.current * startle.current;

    // Zwaartepunt: een traag, onregelmatig rondje boven de wereld. Twee
    // frequenties die niet op elkaar delen, anders herhaalt de baan zichtbaar.
    const t = clock.elapsedTime * 0.055;
    const cx = Math.cos(t) * 7.5 + Math.cos(t * 2.3) * 1.8;
    const cz = Math.sin(t * 0.85) * 6.5 + Math.sin(t * 1.9) * 1.4;
    const cy = 6.4 + Math.sin(t * 1.4) * 0.7 + shock * 3.2;
    // Bij schrik waaieren ze uit en trekken daarna weer samen.
    const spread = 1 + shock * 1.5;

    // Koers uit de afgeleide van diezelfde baan; de hele zwerm draait samen,
    // wat het zwerm-gevoel doet.
    const vx = -Math.sin(t) - Math.sin(t * 2.3) * 2.3 * 1.8 / 7.5;
    const vz = Math.cos(t * 0.85) * 0.85 + Math.cos(t * 1.9) * 1.9 * 1.4 / 6.5;
    const heading = Math.atan2(vx, vz);

    // Draaisnelheid → helling naar binnen. Het verschil van twee hoeken via
    // atan2(sin, cos), anders springt hij een halve slag bij ±π.
    const dh = Math.atan2(
      Math.sin(heading - lastHeading.current),
      Math.cos(heading - lastHeading.current),
    );
    lastHeading.current = heading;
    const target = THREE.MathUtils.clamp((delta > 0 ? dh / delta : 0) * 0.9, -0.2, 0.2);
    // Dempen: een helling die per frame uit een deling volgt, tikt.
    bank.current += (target - bank.current) * Math.min(1, delta * 4);

    // De neus volgt het klimmen en dalen van de zwerm — klein, want een duif
    // die 30° omhoog wijst leest weer als een fout.
    const pitch = THREE.MathUtils.clamp(-Math.cos(t * 1.4) * 0.7 * 1.4 * 0.055 * 1.2, -0.18, 0.18);

    for (let i = 0; i < birds.length; i += 1) {
      const bird = birds[i]!;
      const wobble = Math.sin(clock.elapsedTime * 0.7 + bird.phase) * 0.35;
      const x = cx + bird.dx * spread + wobble;
      const y = cy + bird.dy * spread + Math.sin(clock.elapsedTime * 1.1 + bird.phase) * 0.18;
      const z = cz + bird.dz * spread + Math.cos(clock.elapsedTime * 0.6 + bird.phase) * 0.35;

      pos.set(x, y, z);
      euler.set(pitch, heading, bank.current);
      quat.setFromEuler(euler);
      matrix.compose(pos, quat, one);
      body.setMatrixAt(i, matrix);

      // Vleugelslag: sneller bij schrik, want dat is wat opvliegen is. Omhoog
      // verder dan omlaag (0,95 / 0,45), zoals een duif die zichzelf optilt.
      const beat = Math.sin(clock.elapsedTime * bird.flap * (1 + shock * 1.4) + bird.phase);
      const swing = beat > 0 ? beat * 0.95 : beat * 0.45;
      euler.set(pitch, heading, bank.current + swing);
      quat.setFromEuler(euler);
      matrix.compose(pos, quat, one);
      right.setMatrixAt(i, matrix);
      euler.set(pitch, heading, bank.current - swing);
      quat.setFromEuler(euler);
      matrix.compose(pos, quat, one);
      left.setMatrixAt(i, matrix);
    }

    for (const mesh of [body, left, right]) {
      mesh.instanceMatrix.needsUpdate = true;
      // Zonder dit blijft de bounding sphere op de eerste frame staan en
      // verdwijnt de zwerm zodra hij er buiten vliegt.
      mesh.computeBoundingSphere();
    }
  });

  if (perfLow) return null;

  return (
    <group>
      <instancedMesh ref={bodies} args={[BODY_GEO, BIRD_MAT, COUNT]} />
      <instancedMesh ref={wingsL} args={[WING_L_GEO, BIRD_MAT, COUNT]} />
      <instancedMesh ref={wingsR} args={[WING_R_GEO, BIRD_MAT, COUNT]} />
    </group>
  );
}

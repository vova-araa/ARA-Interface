import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
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
 */

const COUNT = 22;
const WING_GEO = new THREE.BoxGeometry(0.34, 0.012, 0.09);
const BODY_GEO = new THREE.SphereGeometry(0.055, 6, 5);
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
          dy: ((i % 5) - 2) * 0.32,
          dz: Math.sin(angle) * radius * 0.8,
          phase: (i / COUNT) * Math.PI * 2,
          flap: 8 + (i % 4) * 1.6,
        };
      }),
    [],
  );

  const bodies = useRef<THREE.InstancedMesh>(null);
  const wings = useRef<THREE.InstancedMesh>(null);
  const startle = useRef(0);
  const lastSelected = useRef<string | null>(null);

  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);

  useFrame(({ clock }, delta) => {
    const body = bodies.current;
    const wing = wings.current;
    if (!body || !wing) return;

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

    birds.forEach((bird, i) => {
      const wobble = Math.sin(clock.elapsedTime * 0.7 + bird.phase) * 0.35;
      const x = cx + bird.dx * spread + wobble;
      const y = cy + bird.dy * spread + Math.sin(clock.elapsedTime * 1.1 + bird.phase) * 0.18;
      const z = cz + bird.dz * spread + Math.cos(clock.elapsedTime * 0.6 + bird.phase) * 0.35;
      // Neus in de vliegrichting van het zwaartepunt: de hele zwerm draait dan
      // samen, wat het zwerm-gevoel doet.
      const heading = Math.atan2(Math.cos(t) * 0.85, -Math.sin(t));

      pos.set(x, y, z);
      euler.set(0, heading, 0);
      quat.setFromEuler(euler);
      matrix.compose(pos, quat, one);
      body.setMatrixAt(i, matrix);

      // Vleugelslag: sneller bij schrik, want dat is wat opvliegen is.
      const beat = Math.sin(clock.elapsedTime * bird.flap * (1 + shock * 1.4) + bird.phase);
      euler.set(0, heading, beat * 0.85);
      quat.setFromEuler(euler);
      matrix.compose(pos, quat, one);
      wing.setMatrixAt(i, matrix);
    });

    body.instanceMatrix.needsUpdate = true;
    wing.instanceMatrix.needsUpdate = true;
    // Zonder dit blijft de bounding sphere op de eerste frame staan en verdwijnt
    // de zwerm zodra hij er buiten vliegt.
    body.computeBoundingSphere();
    wing.computeBoundingSphere();
  });

  if (perfLow) return null;

  return (
    <group>
      <instancedMesh ref={bodies} args={[BODY_GEO, BIRD_MAT, COUNT]} />
      <instancedMesh ref={wings} args={[WING_GEO, BIRD_MAT, COUNT]} />
    </group>
  );
}

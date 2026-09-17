import { useMemo } from 'react';
import * as THREE from 'three';
import { axialToWorld, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { stylize } from './stylize.ts';

/**
 * De bebouwing van een district.
 *
 * Tot nu toe had elke district-hex ~40% kans op één los propje, en verder
 * niets. Daardoor las een district als een verlicht platform met een huisje
 * erop in plaats van als een stuk stad. Hier staat de bebouwing zelf: twee tot
 * vier panden per hex, in hoogte en breedte uiteenlopend, getint naar de kleur
 * van de tak.
 *
 * Alles is geïnstanceerd. Drie instanced meshes (romp, dak, ramen) dragen de
 * hele stad, dus ~170 panden kosten drie draw calls in plaats van vijfhonderd.
 * De meting die hieraan voorafging: de wereld zat op ~300 draw calls en 31k
 * driehoeken — daar is ruimte zat, maar niet als je het per pand weggooit.
 *
 * Deterministisch uit de hash van project + hex: dezelfde wereld ziet er bij
 * elke herstart hetzelfde uit, anders verspringt je stad bij elke refresh.
 */

const STONE = new THREE.Color('#e8d9c4'); // tuff-pleister
const ROOF = new THREE.Color('#8f5b4a');

const BODY_MAT = stylize(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), {
  rimStrength: 0.4,
  shadowStrength: 0.3,
});
const ROOF_MAT = stylize(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 }), {
  rimStrength: 0.45,
  shadowStrength: 0.3,
});

interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  body: THREE.Color;
  roof: THREE.Color;
}

function buildingsFor(world: WorldConfig | null): Building[] {
  if (!world) return [];
  const out: Building[] = [];
  for (const district of world.districts) {
    const venture = new THREE.Color(district.venture.color);
    for (const project of district.projects) {
      for (const hex of project.hexes) {
        const base = stableHash(`${project.name}:blk:${hex.q},${hex.r}`);
        const { x, z } = axialToWorld(hex);
        const cx = x * HEX_SPACING;
        const cz = z * HEX_SPACING;
        // Twee tot vier panden per hex. Meer wordt een kluwen op deze schaal;
        // minder leest weer als een leeg platform.
        const count = 2 + (base % 3);
        for (let i = 0; i < count; i += 1) {
          const seed = stableHash(`${project.name}:${hex.q},${hex.r}:${i}`);
          // Rond het midden van de tegel, binnen de hex-straal (0.98) met
          // marge, zodat er niets over de rand van het platform hangt.
          const angle = ((seed % 628) / 100) + i * 2.1;
          const radius = 0.16 + ((seed >> 3) % 40) / 100;
          const h = 0.34 + ((seed >> 7) % 100) / 100;
          out.push({
            x: cx + Math.cos(angle) * radius,
            z: cz + Math.sin(angle) * radius,
            w: 0.3 + ((seed >> 11) % 22) / 100,
            d: 0.28 + ((seed >> 13) % 20) / 100,
            h,
            rot: ((seed >> 17) % 628) / 100,
            // De takkleur zit erin, niet erop: een pand dat volledig de
            // ventures-kleur krijgt schreeuwt, een pand met een vleugje ervan
            // hoort bij zijn buurt.
            body: STONE.clone().lerp(venture, 0.1 + ((seed >> 19) % 22) / 100),
            roof: ROOF.clone().lerp(venture, 0.2 + ((seed >> 23) % 30) / 100),
          });
        }
      }
    }
  }
  return out;
}

export function Blocks({ world }: { world: WorldConfig | null }): JSX.Element {
  const buildings = useMemo(() => buildingsFor(world), [world]);
  const count = Math.max(1, buildings.length);

  const place = (
    pick: (b: Building) => { y: number; scale: THREE.Vector3; color: THREE.Color },
  ): ((mesh: THREE.InstancedMesh | null) => void) => (mesh) => {
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    buildings.forEach((b, i) => {
      const { y, scale, color } = pick(b);
      quat.setFromEuler(new THREE.Euler(0, b.rot, 0));
      pos.set(b.x, y, b.z);
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  return (
    <group>
      {/* Romp. De district-platforms staan met hun bovenkant op 0.31, dus daar
          begint een pand — niet op 0, want dan zakt de halve stad weg. */}
      <instancedMesh
        key={`body-${buildings.length}`}
        args={[undefined, undefined, count]}
        castShadow
        receiveShadow
        material={BODY_MAT}
        ref={place((b) => ({
          y: 0.31 + b.h / 2,
          scale: new THREE.Vector3(b.w, b.h, b.d),
          color: b.body,
        }))}
      >
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>

      {/* Dak: een piramide op vier zijden, iets breder dan de romp zodat er een
          overstek is. Zonder dat overstek ziet een blokje er niet uit als een
          huis maar als een blokje. */}
      <instancedMesh
        key={`roof-${buildings.length}`}
        args={[undefined, undefined, count]}
        castShadow
        material={ROOF_MAT}
        ref={place((b) => ({
          y: 0.31 + b.h + 0.09,
          scale: new THREE.Vector3(b.w * 0.82, 0.19, b.d * 0.82),
          color: b.roof,
        }))}
      >
        <coneGeometry args={[1, 1, 4]} />
      </instancedMesh>
    </group>
  );
}

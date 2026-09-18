import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { damp } from 'maath/easing';
import * as THREE from 'three';
import { axialToWorld, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { useAra } from '../store.ts';
import { stylize } from './stylize.ts';
import {
  FLOOR_H,
  PLOTS_PER_HEX,
  SILENT,
  floorsFor,
  growthByProject,
  plotThreshold,
  presenceOf,
  weedsOf,
  type Growth,
} from './growth.ts';

/**
 * De bebouwing van een district — en daarmee het dashboard.
 *
 * De hexen liggen vast, de stad erop niet: elke hex heeft vijf percelen, en
 * hoeveel ervan bebouwd zijn, hoe hoog en hoe fris volgt uit de activiteit van
 * het project (zie `growth.ts`). Een project waar sessies draaien bouwt uit;
 * een project dat zwijgt houdt één pand over, krijgt lagere daken, dooft in
 * kleur en ziet zijn lege percelen dichtgroeien. Eén blik op de skyline
 * vertelt waar het gebeurt.
 *
 * Alles is geïnstanceerd. Drie instanced meshes (romp, dak, onkruid) dragen de
 * hele stad. Belangrijker nog: het aantal instances ligt vast bij het laden en
 * verandert nooit — groei zit in de matrix, niet in het aantal. Een pand dat
 * er "niet" is staat op schaal nul. Zo kost een bouwende stad exact evenveel
 * draw calls als een stilstaande, en hoeft er nooit een buffer opnieuw.
 *
 * De vorm van elk perceel komt uit de hash van project + hex + index: dezelfde
 * wereld met dezelfde activiteit geeft dezelfde stad, ook na een herstart.
 */

const STONE = new THREE.Color('#e8d9c4'); // tuff-pleister
const ROOF = new THREE.Color('#8f5b4a');
/** Waar alle kleur heen kruipt als er niets meer gebeurt: stof, geen kleur. */
const DUST = new THREE.Color('#8e897c');
const ROOF_DUST = new THREE.Color('#6b5750');

const ROOF_H_FRESH = 0.19;
/** Een vervallen dak zakt in: dat leest van bovenaf sneller dan kleurverlies. */
const ROOF_H_WORN = 0.1;
/** Traagheid van de groei in seconden: de stad mag niet tikken per sessie. */
const GROW_SMOOTH = 2.2;
/** Peilfrequentie. Vaker heeft geen zin — groei loopt toch over seconden. */
const SAMPLE_S = 0.5;

const BODY_MAT = withFloors(
  stylize(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), {
    rimStrength: 0.4,
    shadowStrength: 0.3,
  }),
);
const ROOF_MAT = stylize(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 }), {
  rimStrength: 0.45,
  shadowStrength: 0.3,
});
const WEED_MAT = stylize(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), {
  rimStrength: 0.25,
  shadowStrength: 0.2,
});

/**
 * Raamstroken per verdieping, in de shader op wereldhoogte in plaats van op de
 * UV van het blokje. Dat is geen truc maar de kern: een instance wordt in Y
 * geschaald, dus een textuur zou met het pand mee uitrekken en een toren zou
 * dezelfde vier ramen krijgen als een schuur. Op wereldhoogte liggen de
 * verdiepingen van de hele stad op één lijn, en groeit er bij elke nieuwe
 * verdieping vanzelf een strook bij. Kost geen draw call en geen attribuut.
 */
function withFloors<T extends THREE.MeshStandardMaterial>(material: T): T {
  const inner = material.onBeforeCompile.bind(material);
  const innerKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    inner(shader, renderer);
    shader.vertexShader =
      'varying float vFloorY;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  {
    vec4 araLocal = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      araLocal = instanceMatrix * araLocal;
    #endif
    vFloorY = (modelMatrix * araLocal).y;
  }`,
      );
    shader.fragmentShader =
      'varying float vFloorY;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    // 0.31 is de bovenkant van het district-platform: daar begint verdieping 1.
    float band = fract(max(vFloorY - 0.31, 0.0) / ${FLOOR_H.toFixed(3)});
    float win = smoothstep(0.26, 0.36, band) * (1.0 - smoothstep(0.60, 0.70, band));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.6, win * 0.85);
  }`,
      );
  };
  material.customProgramCacheKey = () => `${innerKey()}-floors`;
  return material;
}

/**
 * Een perceel: de plek en de vorm liggen vast, de opbouw erop niet. Ook de
 * twee uitersten van de kleur staan hier al klaar, zodat er per frame niets
 * meer gealloceerd hoeft te worden.
 */
interface Plot {
  project: string;
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  /** Vanaf welke activiteitsscore hier gebouwd wordt. */
  threshold: number;
  /** 0..1 — hoe graag dit perceel de lucht in gaat als het druk wordt. */
  tower: number;
  body: THREE.Color;
  bodyWorn: THREE.Color;
  roof: THREE.Color;
  roofWorn: THREE.Color;
  weed: THREE.Color;
  weedSize: number;
}

function plotsFor(world: WorldConfig | null): Plot[] {
  if (!world) return [];
  const out: Plot[] = [];
  for (const district of world.districts) {
    const venture = new THREE.Color(district.venture.color);
    for (const project of district.projects) {
      for (const hex of project.hexes) {
        const { x, z } = axialToWorld(hex);
        const cx = x * HEX_SPACING;
        const cz = z * HEX_SPACING;
        for (let i = 0; i < PLOTS_PER_HEX; i += 1) {
          const seed = stableHash(`${project.name}:${hex.q},${hex.r}:${i}`);
          // Rond het midden van de tegel, binnen de hex-straal (0.98) met
          // marge, zodat er niets over de rand van het platform hangt.
          const angle = ((seed % 628) / 100) + i * 2.1;
          const radius = 0.16 + ((seed >> 3) % 40) / 100;
          const tower = ((seed >> 7) % 100) / 100;
          const body = STONE.clone().lerp(venture, 0.1 + ((seed >> 19) % 22) / 100);
          const roof = ROOF.clone().lerp(venture, 0.2 + ((seed >> 23) % 30) / 100);
          out.push({
            project: project.name,
            x: cx + Math.cos(angle) * radius,
            z: cz + Math.sin(angle) * radius,
            // Een toren staat op een kleinere voet, anders wordt het een muur.
            w: (0.3 + ((seed >> 11) % 22) / 100) * (1 - tower * 0.25),
            d: (0.28 + ((seed >> 13) % 20) / 100) * (1 - tower * 0.25),
            rot: ((seed >> 17) % 628) / 100,
            threshold: plotThreshold(i, (((seed >> 5) % 100) / 1000) - 0.05),
            tower,
            // De takkleur zit erin, niet erop: een pand dat volledig de
            // ventures-kleur krijgt schreeuwt, een pand met een vleugje ervan
            // hoort bij zijn buurt.
            body,
            bodyWorn: body.clone().lerp(DUST, 0.62),
            roof,
            roofWorn: roof.clone().lerp(ROOF_DUST, 0.7),
            weed: new THREE.Color('#7d9147').lerp(new THREE.Color('#b0a94e'), ((seed >> 9) % 60) / 100),
            weedSize: 0.16 + ((seed >> 15) % 16) / 100,
          });
        }
      }
    }
  }
  return out;
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const pos = new THREE.Vector3();
const scale = new THREE.Vector3();
const tint = new THREE.Color();

export function Blocks({ world }: { world: WorldConfig | null }): JSX.Element {
  const plots = useMemo(() => plotsFor(world), [world]);
  const count = Math.max(1, plots.length);
  const perfLow = useAra((s) => s.perfLow);

  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const roofRef = useRef<THREE.InstancedMesh>(null);
  const weedRef = useRef<THREE.InstancedMesh>(null);
  /** Waar de stad naartoe wil (uit de sessies) en waar ze nu staat (gedempt). */
  const target = useRef(new Map<string, Growth>());
  const shown = useRef(new Map<string, Growth>());
  const sinceSample = useRef(SAMPLE_S);
  const redraw = useRef(true);

  const projects = useMemo(
    () => (world ? world.districts.flatMap((d) => d.projects.map((p) => p.name)) : []),
    [world],
  );

  // Verse buffers staan leeg en de damping is dan allang uitgewerkt, dus een
  // nieuwe wereld of een net ingeschakelde onkruidlaag moet zelf om een
  // plaatsing vragen — anders blijft er een onzichtbare stad staan.
  useEffect(() => {
    redraw.current = true;
    sinceSample.current = SAMPLE_S;
  }, [plots, perfLow]);

  useFrame((_, delta) => {
    sinceSample.current += delta;
    if (sinceSample.current >= SAMPLE_S) {
      sinceSample.current = 0;
      // Niet via een selector: de snapshot verandert bij élk event, en een
      // re-render zou alle instances opnieuw plaatsen voor een getal dat toch
      // pas over seconden zichtbaar wordt. De replay-snapshot wint, zodat de
      // stad tijdens het terugscrubben het verleden laat zien.
      const store = useAra.getState();
      const snap = store.replaySnapshot ?? store.snapshot;
      const growth = growthByProject(snap.sessions, snap.now);
      for (const project of projects) target.current.set(project, growth.get(project) ?? SILENT);
    }

    let moving = false;
    for (const [project, want] of target.current) {
      let now = shown.current.get(project);
      if (!now) {
        // Eerste keer: meteen op zijn plek. Een stad die bij elke refresh
        // opnieuw opbouwt is leuk voor één keer en daarna vertraging.
        now = { score: want.score, idle: want.idle };
        shown.current.set(project, now);
        moving = true;
        continue;
      }
      const a = damp(now, 'score', want.score, GROW_SMOOTH, delta);
      const b = damp(now, 'idle', want.idle, GROW_SMOOTH, delta);
      if (a || b) moving = true;
    }
    if (!moving && !redraw.current) return;

    const body = bodyRef.current;
    const roofs = roofRef.current;
    const weeds = weedRef.current;
    if (!body || !roofs) return;
    redraw.current = false;

    plots.forEach((plot, i) => {
      const g = shown.current.get(plot.project) ?? SILENT;
      const presence = presenceOf(g.score, plot.threshold);
      const h = floorsFor(g.score, plot.tower) * FLOOR_H * presence;
      euler.set(0, plot.rot, 0);
      quat.setFromEuler(euler);

      // De district-platforms staan met hun bovenkant op 0.31, dus daar begint
      // een pand — niet op 0, want dan zakt de halve stad weg.
      pos.set(plot.x, 0.31 + h / 2, plot.z);
      scale.set(plot.w * presence, h, plot.d * presence);
      matrix.compose(pos, quat, scale);
      body.setMatrixAt(i, matrix);
      body.setColorAt(i, tint.copy(plot.body).lerp(plot.bodyWorn, g.idle));

      // Dak: een piramide op vier zijden, iets breder dan de romp zodat er een
      // overstek is. Zonder dat overstek ziet een blokje er niet uit als een
      // huis maar als een blokje.
      const roofH = (ROOF_H_FRESH + (ROOF_H_WORN - ROOF_H_FRESH) * g.idle) * presence;
      pos.set(plot.x, 0.31 + h + roofH / 2 - 0.005, plot.z);
      scale.set(plot.w * 0.82 * presence, roofH, plot.d * 0.82 * presence);
      matrix.compose(pos, quat, scale);
      roofs.setMatrixAt(i, matrix);
      roofs.setColorAt(i, tint.copy(plot.roof).lerp(plot.roofWorn, g.idle));

      if (!weeds) return;
      // Onkruid staat op het perceel dat er niet (meer) is: waar een pand
      // wegvalt komt precies daar de begroeiing terug.
      const wild = weedsOf(presence, g.idle);
      const wh = plot.weedSize * wild;
      pos.set(plot.x, 0.31 + wh / 2, plot.z);
      scale.set(0.13 * wild, wh, 0.13 * wild);
      matrix.compose(pos, quat, scale);
      weeds.setMatrixAt(i, matrix);
      weeds.setColorAt(i, plot.weed);
    });

    for (const mesh of [body, roofs, weeds]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  });

  // De key hangt aan het aantal percelen: alleen een andere wereld mag de
  // buffers opnieuw laten aanmaken, groei nooit.
  return (
    <group>
      <instancedMesh
        key={`body-${plots.length}`}
        ref={bodyRef}
        args={[undefined, undefined, count]}
        castShadow
        receiveShadow
        material={BODY_MAT}
      >
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>

      <instancedMesh
        key={`roof-${plots.length}`}
        ref={roofRef}
        args={[undefined, undefined, count]}
        castShadow
        material={ROOF_MAT}
      >
        <coneGeometry args={[1, 1, 4]} />
      </instancedMesh>

      {/* Verwildering is sier: bij een zwak apparaat vertelt de skyline het
          verhaal ook zonder, en dit is de laag die niets toevoegt aan wat je
          van veraf ziet. */}
      {!perfLow && (
        <instancedMesh
          key={`weeds-${plots.length}`}
          ref={weedRef}
          args={[undefined, undefined, count]}
          material={WEED_MAT}
        >
          <coneGeometry args={[1, 1, 5]} />
        </instancedMesh>
      )}
    </group>
  );
}

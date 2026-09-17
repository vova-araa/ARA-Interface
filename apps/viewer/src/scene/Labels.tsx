import { useMemo } from 'react';
import * as THREE from 'three';
import { axialToWorld, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { useAra } from '../store.ts';

const textureCache = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>();

/** Crisp text label as a canvas sprite — no external fonts, ortho-safe. */
function textTexture(text: string, accent: string): { texture: THREE.CanvasTexture; aspect: number } {
  const key = `${text}|${accent}`;
  let cached = textureCache.get(key);
  if (cached) return cached;

  // Groter en met een echte rand: op een Retina-scherm onder een ortho-camera
  // was 26px met 78% dekking een grijze veeg zodra er een gebouw achter stond.
  const dpr = 3;
  const fontSize = 34;
  const padX = 22;
  const height = 56;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `600 ${fontSize}px -apple-system, sans-serif`;
  const width = Math.ceil(measure.measureText(text).width) + padX * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, height - 2, 12);
  ctx.fillStyle = 'rgba(10, 12, 16, 0.92)';
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Donkere schaduw onder de letters: houdt ze leesbaar boven een lichte
  // gevel én boven een donkere heuvel, zonder een tweede tekstlaag.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#f4f6fa';
  ctx.fillText(text, width / 2, height / 2 + 1);
  ctx.shadowBlur = 0;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  cached = { texture, aspect: width / height };
  textureCache.set(key, cached);
  return cached;
}

function Label({
  text,
  accent,
  position,
  height,
  onClick,
}: {
  text: string;
  accent: string;
  position: [number, number, number];
  height: number;
  onClick?: () => void;
}): JSX.Element {
  const { texture, aspect } = useMemo(() => textTexture(text, accent), [text, accent]);
  return (
    <sprite
      position={position}
      renderOrder={20}
      scale={[aspect * height, height, 1]}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      onPointerOver={onClick ? () => (document.body.style.cursor = 'pointer') : undefined}
      onPointerOut={onClick ? () => (document.body.style.cursor = 'default') : undefined}
    >
      {/* Altijd bovenop: een label dat je achter een dak vandaan moet zoeken
          is geen label. renderOrder houdt ze onderling in de juiste volgorde. */}
      <spriteMaterial map={texture} transparent depthWrite={false} depthTest={false} />
    </sprite>
  );
}

/** Venture name above each district landmark, project names above clusters.
 *  LOD: projectlabels verdwijnen wanneer ver uitgezoomd (venture-labels blijven). */
export function Labels({ world }: { world: WorldConfig }): JSX.Element {
  const lodFar = useAra((s) => s.lodFar);
  const openOffice = useAra((s) => s.openOffice);
  const labels = useMemo(() => {
    const out: {
      key: string;
      text: string;
      accent: string;
      pos: [number, number, number];
      h: number;
      project?: string;
    }[] = [];
    for (const district of world.districts) {
      const c = axialToWorld(district.center);
      const projects = district.projects;
      // Projectlabels van één district liggen dicht bij elkaar en botsten
      // daardoor tot één zwarte veeg. Ze krijgen elk hun eigen hoogte — een
      // trapje in plaats van een stapel. Dat werkt onder een ortho-camera
      // beter dan horizontaal uitwijken, want horizontaal schuiven maakt niet
      // meer duidelijk bij welk cluster een naam hoort.
      const step = 0.46;
      projects.forEach((project, i) => {
        const p = axialToWorld(project.center);
        out.push({
          key: `p-${project.name}`,
          text: project.name,
          accent: district.venture.color,
          pos: [p.x * HEX_SPACING, 1.65 + i * step, p.z * HEX_SPACING],
          h: 0.46,
          project: project.name,
        });
      });
      // De taknaam gaat boven het hoogste projectlabel uit, wat het ook is.
      out.push({
        key: `v-${district.venture.id}`,
        text: district.venture.label,
        accent: district.venture.color,
        pos: [c.x * HEX_SPACING, 1.65 + Math.max(1, projects.length) * step + 0.5, c.z * HEX_SPACING],
        h: 0.72,
      });
    }
    return out;
  }, [world]);

  return (
    <group>
      {labels
        .filter((label) => !lodFar || label.key.startsWith('v-'))
        .map((label) => (
          <Label
            key={label.key}
            text={label.text}
            accent={label.accent}
            position={label.pos}
            height={label.h}
            onClick={label.project ? () => openOffice(label.project!) : undefined}
          />
        ))}
    </group>
  );
}

import { useMemo } from 'react';
import * as THREE from 'three';
import { axialToWorld, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';

const textureCache = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>();

/** Crisp text label as a canvas sprite — no external fonts, ortho-safe. */
function textTexture(text: string, accent: string): { texture: THREE.CanvasTexture; aspect: number } {
  const key = `${text}|${accent}`;
  let cached = textureCache.get(key);
  if (cached) return cached;

  const dpr = 2;
  const fontSize = 26;
  const padX = 18;
  const height = 44;
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
  ctx.fillStyle = 'rgba(13, 15, 18, 0.78)';
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8eaf0';
  ctx.fillText(text, width / 2, height / 2 + 1);

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
}: {
  text: string;
  accent: string;
  position: [number, number, number];
  height: number;
}): JSX.Element {
  const { texture, aspect } = useMemo(() => textTexture(text, accent), [text, accent]);
  return (
    <sprite position={position} scale={[aspect * height, height, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

/** Venture name above each district landmark, project names above clusters. */
export function Labels({ world }: { world: WorldConfig }): JSX.Element {
  const labels = useMemo(() => {
    const out: { key: string; text: string; accent: string; pos: [number, number, number]; h: number }[] = [];
    for (const district of world.districts) {
      const c = axialToWorld(district.center);
      out.push({
        key: `v-${district.venture.id}`,
        text: district.venture.label,
        accent: district.venture.color,
        pos: [c.x * HEX_SPACING, 2.6, c.z * HEX_SPACING],
        h: 0.62,
      });
      for (const project of district.projects) {
        const p = axialToWorld(project.center);
        out.push({
          key: `p-${project.name}`,
          text: project.name,
          accent: 'rgba(139, 149, 165, 0.6)',
          pos: [p.x * HEX_SPACING, 1.7, p.z * HEX_SPACING],
          h: 0.4,
        });
      }
    }
    return out;
  }, [world]);

  return (
    <group>
      {labels.map((label) => (
        <Label key={label.key} text={label.text} accent={label.accent} position={label.pos} height={label.h} />
      ))}
    </group>
  );
}

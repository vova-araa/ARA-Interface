import { useEffect, useRef } from 'react';
import { axialToWorld } from '@ara/shared';
import { useAra, useViewSnapshot } from '../store.ts';
import { HEX_SPACING, projectPlacement, sessionPosition } from '../placements.ts';
import { STATUS_COLORS } from '../util.ts';

const SIZE = 148;
const EXTENT = 16; // world units mapped to the map's half-size

function toMap(x: number, z: number): [number, number] {
  return [(x / EXTENT) * (SIZE / 2) + SIZE / 2, (z / EXTENT) * (SIZE / 2) + SIZE / 2];
}

/** Klikbare minimap: districten + pods; klik vliegt naar de dichtstbijzijnde sessie. */
export function Minimap(): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = useAra((s) => s.world);
  const snapshot = useViewSnapshot();
  const select = useAra((s) => s.select);
  const flyTo = useAra((s) => s.flyTo);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !world) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, SIZE, SIZE);
    // Districten als gekleurde stippen + zachte gloed
    for (const district of world.districts) {
      const c = axialToWorld(district.center);
      const [x, y] = toMap(c.x * HEX_SPACING, c.z * HEX_SPACING);
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = district.venture.color + '33';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = district.venture.color;
      ctx.fill();
    }
    // Hub
    const [hx, hy] = toMap(0, 0);
    ctx.strokeStyle = '#e8eaf0';
    ctx.strokeRect(hx - 2.5, hy - 2.5, 5, 5);

    // Pods per sessie, kleur = status
    const sessions = Object.values(snapshot.sessions);
    const byProject = new Map<string, typeof sessions>();
    for (const session of sessions) {
      const list = byProject.get(session.project) ?? [];
      list.push(session);
      byProject.set(session.project, list);
    }
    for (const list of byProject.values()) {
      list.sort((a, b) => a.startedAt - b.startedAt);
      list.forEach((session, index) => {
        const pos = sessionPosition(world, session, index);
        const [x, y] = toMap(pos.x, pos.z);
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = STATUS_COLORS[session.status] ?? '#8b95a5';
        ctx.fill();
        if (session.status === 'needsHuman') {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.strokeStyle = STATUS_COLORS.needsHuman!;
          ctx.stroke();
        }
      });
    }
  }, [world, snapshot]);

  if (!world) return null;

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = ((e.clientX - rect.left - SIZE / 2) / (SIZE / 2)) * EXTENT;
    const wz = ((e.clientY - rect.top - SIZE / 2) / (SIZE / 2)) * EXTENT;
    let best: { id: string; d: number } | null = null;
    const byProject = new Map<string, number>();
    for (const session of Object.values(snapshot.sessions)) {
      const index = byProject.get(session.project) ?? 0;
      byProject.set(session.project, index + 1);
      const pos = sessionPosition(world, session, index);
      const d = Math.hypot(pos.x - wx, pos.z - wz);
      if (!best || d < best.d) best = { id: session.sessionId, d };
    }
    // Geen sessies? Vlieg naar het dichtstbijzijnde district via een dummy select.
    if (best && best.d < 6) {
      select(best.id);
      flyTo(best.id);
    }
  };

  return <canvas ref={canvasRef} className="minimap" style={{ width: SIZE, height: SIZE }} onClick={onClick} />;
}
